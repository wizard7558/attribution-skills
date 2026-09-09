#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,cp,rm,chmod} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {FILES,DEFAULT_CAP,sha256,validDate,validateConfig,parseArgs,renderTemplate,captureTemplates,decodeRows,collectResults,createNativeTransport,exclusiveReport,executeJob,runChecks,command} from './run-export-checks.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const fixtureText=await readFile(join(root,'references/export-check-fixtures.json'),'utf8'),fixture=JSON.parse(fixtureText);
const config=validateConfig({sourceProject:'example-project',dataset:'analytics_test',start:'20260901',end:'20260903'});
const identity={projectId:'example-project',location:'US',jobId:'test_job'};
const field=(name,type,mode='NULLABLE',fields)=>({name,type,mode,...(fields?{fields}:{})});
const schema={fields:[field('integer','INTEGER'),field('decimal','NUMERIC'),field('wide','BIGNUMERIC'),field('time','TIMESTAMP'),field('nested','RECORD','NULLABLE',[field('label','STRING'),field('values','INTEGER','REPEATED')]),field('records','RECORD','REPEATED',[field('ok','BOOLEAN'),field('value','STRING')])]};
const row={f:[{v:'9223372036854775807'},{v:'99999999999999999999999999999.123456789'},{v:'0.00000000000000000000000000000000000001'},{v:'1788220800.000001'},{v:{f:[{v:null},{v:[{v:'9007199254740993'},{v:'1'}]}]}},{v:[{v:{f:[{v:'false'},{v:null}]}}]}]};
const decoded={integer:'9223372036854775807',decimal:'99999999999999999999999999999.123456789',wide:'0.00000000000000000000000000000000000001',time:'1788220800.000001',nested:{label:null,values:['9007199254740993','1']},records:[{ok:false,value:null}]};
const page=(rows=[],extra={})=>({jobReference:identity,jobComplete:true,totalRows:String(rows.length),schema,rows,...extra});
export async function offline(){
 let assertions=0;const check=fn=>{fn();assertions++;};const rejects=async(fn)=>{await assert.rejects(fn);assertions++;};
 for(const date of ['00010101','20000229','20240229','99991231'])check(()=>assert.ok(validDate(date)));
 for(const date of ['00000101','19000229','20260229','20261301','20260431','20260900','2026091','20260901\n','２０２６０９０１'])check(()=>assert.ok(!validDate(date)));
 for(const change of [{end:'20260831'},{sourceProject:'bad;project'},{sourceProject:'domain:project'},{sourceProject:'123456'},{dataset:'a` UNION SELECT'},{dataset:'a.b'},{dataset:'a'.repeat(1025)},{location:'US;echo'},{maximumBytesBilled:'0'},{maximumBytesBilled:'-1'},{maximumBytesBilled:'1.5'},{maximumBytesBilled:'1e9'},{maximumBytesBilled:'9223372036854775808'},{maximumBytesBilled:1}])check(()=>assert.throws(()=>validateConfig({...config,...change})));
 check(()=>assert.equal(validateConfig({...config,dataset:'1_valid',maximumBytesBilled:'1'}).maximumBytesBilled,'1'));
 check(()=>assert.equal(parseArgs(['example-project','data','20260901','20260903'],{MAX_BYTES:'10'}).config.maximumBytesBilled,'10'));
 for(const args of [['--synthetic'],['--synthetic','--billing-project','example-project','extra'],['example-project','data','20260901','20260903','--wat'],['example-project','data','20260901','20260903','--location','US','--location','EU']])check(()=>assert.throws(()=>parseArgs(args)));
 const templates=await captureTemplates(config);
 for(const t of templates){const source=await readFile(join(root,'references/sql',t.name),'utf8');let inverse=t.query.replaceAll('example-project.analytics_test',()=> 'PROJECT.analytics_PROPERTY_ID').replaceAll("'20260901' AND '20260903'",()=>"'YYYYMMDD' AND 'YYYYMMDD'").replaceAll("'20260901' AS start_suffix, '20260903' AS end_suffix",()=>"'YYYYMMDD' AS start_suffix, 'YYYYMMDD' AS end_suffix").replaceAll("PARSE_DATE('%Y%m%d','20260901'),PARSE_DATE('%Y%m%d','20260903')",()=>"PARSE_DATE('%Y%m%d','YYYYMMDD'),PARSE_DATE('%Y%m%d','YYYYMMDD')");check(()=>assert.equal(inverse,source));check(()=>assert.equal(t.sourceSha256,sha256(source)));check(()=>assert.ok(!t.query.includes('YYYYMMDD')));}
 check(()=>assert.throws(()=>renderTemplate('arbitrary.sql','',config)));check(()=>assert.throws(()=>renderTemplate('sessions.sql',"PROJECT.analytics_PROPERTY_ID 'YYYYMMDD' AND 'YYYYMMDD' other YYYYMMDD",config)));
 check(()=>assert.deepEqual(decodeRows(schema,[row]),[decoded]));
 let tokens=[];const result=await collectResults(async token=>{tokens.push(token);return token?page([row],{totalRows:'2'}):page([row],{totalRows:'2',pageToken:'second'});},identity);
 check(()=>assert.deepEqual(result.rows,[decoded,decoded]));check(()=>assert.deepEqual(tokens,[undefined,'second']));
 check(()=>assert.deepEqual((awaitable=>awaitable)(result.pages).length,2));
 const empty=await collectResults(async()=>page([]),identity);check(()=>assert.deepEqual(empty.rows,[]));
 for(const bad of [page([row],{totalRows:'2'}),page([],{jobComplete:false}),page([],{errors:[{message:'failure'}]}),page([],{jobReference:{...identity,jobId:'wrong'}}),page([],{totalRows:'-1'})])await rejects(()=>collectResults(async()=>bad,identity));
 await rejects(()=>collectResults(async()=>page([],{pageToken:'again'}),identity));await rejects(()=>collectResults(async()=>{throw new Error('HTTP failure');},identity));
 for(const bad of [{f:[]},{f:[...row.f.slice(0,4),{v:{f:[]} },row.f[5]]}])check(()=>assert.throws(()=>decodeRows(schema,[bad])));
 // Native transport is exercised against an explicitly mocked HTTP/command layer.
 const requests=[];const secret='offline-token-sentinel';const transport=createNativeTransport(config,{run:async(program,args)=>{requests.push({program,args});return {code:0,stdout:program==='gcloud'?secret:'queued',stderr:''};},fetchImpl:async(url,init)=>{requests.push({url:String(url),authorization:init.headers.Authorization});return {ok:true,status:200,text:async()=>JSON.stringify(page([]))};}});
 await transport.page({jobId:identity.jobId},'a+b&c');check(()=>assert.equal(requests[0].program,'gcloud'));check(()=>assert.ok(requests[1].url.startsWith('https://bigquery.googleapis.com/bigquery/v2/projects/example-project/queries/test_job?')));check(()=>assert.equal(new URL(requests[1].url).searchParams.get('pageToken'),'a+b&c'));check(()=>assert.equal(new URL(requests[1].url).searchParams.get('formatOptions.useInt64Timestamp'),'true'));
 const broken=createNativeTransport(config,{run:async()=>({code:0,stdout:secret,stderr:''}),fetchImpl:async()=>({ok:false,status:403,text:async()=>JSON.stringify({message:secret})})});
 try{await broken.page({jobId:'test_job'});}catch(e){check(()=>assert.ok(!JSON.stringify(e.rest).includes(secret)));}
 const dir=await mkdtemp(join(tmpdir(),'ga4-export-offline-'));
 try{
  const copy=join(dir,'copied');await mkdir(join(copy,'scripts'),{recursive:true});await mkdir(join(copy,'references/sql'),{recursive:true});
  for(const n of ['run_checks.sh','run-export-checks.mjs'])await cp(join(here,n),join(copy,'scripts',n));for(const n of FILES)await cp(join(root,'references/sql',n),join(copy,'references/sql',n));
  const cmd=await command('bash',[join(copy,'scripts/run_checks.sh'),'example-project','analytics_test','20260901','20260903','--render-only','--report',join(dir,'copy.json')]);check(()=>assert.equal(cmd.code,0,cmd.stderr));const copied=JSON.parse(await readFile(join(dir,'copy.json'),'utf8'));check(()=>assert.deepEqual(copied.templates,templates));check(()=>assert.equal(copied.sqlExecuted,false));
  // Public CLI startup failures under a deliberately isolated PATH; no real CLI or credentials.
  const bin=join(dir,'isolated-bin');await mkdir(bin);const originalPath=process.env.PATH;
  try{
   process.env.PATH=bin;
   for(const missing of ['bq','gcloud']){
    if(missing==='gcloud'){await writeFile(join(bin,'bq'),"#!/bin/sh\nprintf 'offline bq version\\n'\n");await chmod(join(bin,'bq'),0o755);}
    const out=join(dir,`public-missing-${missing}.json`);
    const cli=await command(process.execPath,[join(here,'run-export-checks.mjs'),'example-project','analytics_test','20260901','20260903','--report',out]);check(()=>assert.equal(cli.code,1));
    const retained=JSON.parse(await readFile(out,'utf8'));check(()=>assert.equal(retained.state,'incomplete'));check(()=>assert.equal(retained.startupError.code,'ENOENT'));check(()=>assert.ok(retained.startupError.message.includes(missing)));check(()=>assert.equal(retained.jobs.length,0));
   }
  }finally{if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;}
  let credentialCalls=0;
  await rejects(()=>runChecks({config:{...config,dataset:'bad`source'},report:join(dir,'invalid-before-auth.json')},{transport:{versions:async()=>{credentialCalls++;}}}));check(()=>assert.equal(credentialCalls,0));
  const startup=await runChecks({config,report:join(dir,'missing-cli.json')},{transport:{versions:async()=>{throw Object.assign(new Error('spawn bq ENOENT'),{code:'ENOENT'});}}});check(()=>assert.equal(startup.report.state,'incomplete'));check(()=>assert.equal(startup.report.startupError.code,'ENOENT'));check(()=>assert.equal(startup.report.jobs.length,0));
  const versionFailure=await runChecks({config,report:join(dir,'version-failed.json')},{transport:{versions:async()=>({bq:{code:1,stdout:'literal stdout',stderr:'literal stderr'}})}});check(()=>assert.equal(versionFailure.report.state,'incomplete'));check(()=>assert.equal(versionFailure.report.versions.bq.stderr,'literal stderr'));
  let submissions=0,observations=0;
  const mock={versions:async()=>({offline:true}),submit:async()=>{submissions++;return {code:0,stdout:'submitted',stderr:''};},metadata:async j=>{observations++;return {jobReference:{...identity,jobId:j.jobId},configuration:{query:{query:j.query,useLegacySql:false,useQueryCache:false,maximumBytesBilled:DEFAULT_CAP}},status:{state:'DONE'},statistics:{query:{totalBytesProcessed:'0',totalBytesBilled:'0'}}};},page:async j=>({...page([]),jobReference:{...identity,jobId:j.jobId}})};
  const first=await runChecks({config,report:join(dir,'first.json')},{transport:mock});check(()=>assert.equal(submissions,8));check(()=>assert.equal(first.report.state,'completed'));
  const saved=await readFile(first.path);const again=await runChecks({config,resumeReport:first.path,report:join(dir,'again.json')},{transport:mock});check(()=>assert.equal(submissions,8));check(()=>assert.equal(observations,16));check(()=>assert.deepEqual(first.report.jobs.map(j=>j.jobId),again.report.jobs.map(j=>j.jobId)));const stillSaved=await readFile(first.path);check(()=>assert.deepEqual(stillSaved,saved));
  await rejects(()=>runChecks({config:{...config,end:'20260904'},resumeReport:first.path,report:join(dir,'invalid.json')},{transport:mock}));
  await rejects(()=>runChecks({config,resumeReport:first.path,report:join(dir,'invalid2.json')},{transport:mock,wrapperHash:'changed'}));
  await writeFile(join(copy,'references/sql/sessions.sql'),(await readFile(join(copy,'references/sql/sessions.sql'),'utf8'))+'\n-- mutation\n');await rejects(()=>runChecks({config,resumeReport:first.path,report:join(dir,'invalid3.json')},{transport:mock,sqlDir:join(copy,'references/sql')}));
  let job={jobId:'test_job',query:'SELECT 1',querySha256:sha256('SELECT 1')};const uncertain={...mock,submit:async()=>{submissions++;return {code:1,stdout:'',stderr:'uncertain transport'};},metadata:async()=>{throw new Error('temporary observation failure');}};await executeJob(job,config,uncertain,async()=>{});check(()=>assert.equal(job.state,'retrieval_pending_or_failed'));const before=submissions;await executeJob(job,config,mock,async()=>{},{submit:false});check(()=>assert.equal(submissions,before));check(()=>assert.equal(job.state,'completed'));check(()=>assert.equal(job.attempts.length,2));
  await executeJob(job,config,{...mock,metadata:async()=>{throw new Error('HTTP 404 missing job');}},async()=>{},{submit:false});check(()=>assert.equal(submissions,before));check(()=>assert.equal(job.state,'retrieval_pending_or_failed'));
 }finally{await rm(dir,{recursive:true,force:true});}
 assert.deepEqual(Object.keys(fixture.expected),FILES);console.log(`PASS ${assertions} offline assertions: rendering, strict config, nested pagination, transport and same-job resume. NO SQL EXECUTED.`);return assertions;
}
const quote=s=>"'"+s.replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r')+"'";
function setupQuery(c){
 const select=`SELECT JSON_VALUE(e,'$.event_date') AS event_date,CAST(JSON_VALUE(e,'$.event_timestamp') AS INT64) AS event_timestamp,JSON_VALUE(e,'$.event_name') AS event_name,JSON_VALUE(e,'$.user_pseudo_id') AS user_pseudo_id,JSON_VALUE(e,'$.platform') AS platform,JSON_VALUE(e,'$.stream_id') AS stream_id,CAST(JSON_VALUE(e,'$.event_value_in_usd') AS FLOAT64) AS event_value_in_usd,
 ARRAY(SELECT AS STRUCT JSON_VALUE(p,'$.key') AS key,STRUCT(JSON_VALUE(p,'$.value.string_value') AS string_value,CAST(JSON_VALUE(p,'$.value.int_value') AS INT64) AS int_value,CAST(JSON_VALUE(p,'$.value.float_value') AS FLOAT64) AS float_value,CAST(JSON_VALUE(p,'$.value.double_value') AS FLOAT64) AS double_value) AS value FROM UNNEST(JSON_QUERY_ARRAY(e,'$.event_params')) p WITH OFFSET o ORDER BY o) AS event_params,
 STRUCT(CAST(NULL AS STRING) AS gclid,CAST(NULL AS STRING) AS dclid,CAST(NULL AS STRING) AS srsltid) AS collected_traffic_source,
 STRUCT(STRUCT(CAST(NULL AS STRING) AS source,CAST(NULL AS STRING) AS medium,CAST(NULL AS STRING) AS campaign_name,CAST(NULL AS STRING) AS default_channel_group) AS cross_channel_campaign,STRUCT(CAST(NULL AS STRING) AS source,CAST(NULL AS STRING) AS medium,CAST(NULL AS STRING) AS campaign_name) AS manual_campaign) AS session_traffic_source_last_click,
 STRUCT(JSON_VALUE(e,'$.transaction_id') AS transaction_id,CAST(JSON_VALUE(e,'$.revenue_usd') AS FLOAT64) AS purchase_revenue_in_usd,CAST(JSON_VALUE(e,'$.tax_usd') AS FLOAT64) AS tax_value_in_usd,CAST(JSON_VALUE(e,'$.shipping_usd') AS FLOAT64) AS shipping_value_in_usd,CAST(JSON_VALUE(e,'$.native_revenue') AS FLOAT64) AS purchase_revenue,CAST(JSON_VALUE(e,'$.total_item_quantity') AS INT64) AS total_item_quantity,CAST(JSON_VALUE(e,'$.unique_items') AS INT64) AS unique_items) AS ecommerce,
 ARRAY(SELECT AS STRUCT JSON_VALUE(i,'$.item_id') AS item_id,JSON_VALUE(i,'$.item_name') AS item_name,JSON_VALUE(i,'$.item_category') AS item_category,CAST(JSON_VALUE(i,'$.quantity') AS INT64) AS quantity,CAST(JSON_VALUE(i,'$.revenue_usd') AS FLOAT64) AS item_revenue_in_usd,CAST(JSON_VALUE(i,'$.native_revenue') AS FLOAT64) AS item_revenue FROM UNNEST(JSON_QUERY_ARRAY(e,'$.items')) i WITH OFFSET o ORDER BY o) AS items`;
 return fixture.tables.map(t=>`CREATE TABLE \`${c.sourceProject}.${c.dataset}.${t.name}\` AS ${select} FROM UNNEST(JSON_QUERY_ARRAY(${quote(JSON.stringify(t.events))})) e CROSS JOIN UNNEST(GENERATE_ARRAY(1,${t.repeat??1})) AS repetition;`).join('\n')+`\nSELECT 'created' AS setup_status;`;
}
function outputOf(job){const r=job.result;assert.ok(r);return r.parsedResultJson.length===1?r.parsedResultJson[0]:r.rows;}
function normalizeScope(value,c){return JSON.parse(JSON.stringify(value).replaceAll(`${c.sourceProject}.${c.dataset}`,'PROJECT.analytics_PROPERTY_ID'));}
function verifyTemplates(report,c){assert.equal(report.state,'completed');for(const job of report.jobs)assert.deepEqual(normalizeScope(outputOf(job),c),fixture.expected[job.name],job.name);}
export async function runSynthetic(options){
 const c=validateConfig({...options.config,dataset:'ga4_export_test_'+randomUUID().replaceAll('-',''),start:fixture.window.start,end:fixture.window.end});assert.equal(c.maximumBytesBilled,DEFAULT_CAP);
 const reportPath=resolve(options.report??join(homedir(),'Downloads',`ga4-export-synthetic-${Date.now()}.json`));
 const templates=await captureTemplates(c),sourceHashes=Object.fromEntries(templates.map(t=>[t.name,t.sourceSha256]));for(const n of ['run_checks.sh','run-export-checks.mjs','test-export-checks.mjs'])sourceHashes[n]=sha256(await readFile(join(here,n)));
 const report={version:1,startedAt:new Date().toISOString(),pid:process.pid,state:'running',config:c,sourceHashes,fixtureSha256:sha256(fixtureText),fixtureInput:fixture.tables,ownedDataset:c.dataset,jobs:[],commands:[],reports:[]};const save=await exclusiveReport(reportPath,report),transport=createNativeTransport(c);report.versions=await transport.versions();await save();
 const bq=async args=>{const result=await command('bq',[`--project_id=${c.billingProject}`,`--location=${c.location}`,'--format=json','--quiet',...args]);report.commands.push({args,result,at:new Date().toISOString()});await save();return result;};
 let owned=false;const copy=await mkdtemp(join(tmpdir(),'ga4-export-native-copy-'));
 const run=async(name,query,maximumBytesBilled=DEFAULT_CAP)=>{const job={name,jobId:'ga4_export_proof_'+randomUUID().replaceAll('-',''),query,querySha256:sha256(query),maximumBytesBilled};report.jobs.push(job);await save();console.log(`SUBMIT ${name} ${job.jobId}`);await executeJob(job,c,transport,save);return job;};
 try{
  const created=await bq(['mk','--dataset','--default_table_expiration=3600',`${c.sourceProject}:${c.dataset}`]);assert.equal(created.code,0,created.stderr+created.stdout);owned=true;report.datasetCreated=true;await save();
  const setup=await run('owned-table-setup',setupQuery(c));assert.equal(setup.state,'completed');assert.deepEqual(setup.result.rows,[{setup_status:'created'}]);
  const mainPath=reportPath.replace(/\.json$/,'')+'-templates.json';report.reports.push({kind:'templates',path:mainPath});await save();const main=await runChecks({config:c,report:mainPath});verifyTemplates(main.report,c);report.reports[0].sha256=sha256(await readFile(main.path));await save();
  await mkdir(join(copy,'scripts'),{recursive:true});await mkdir(join(copy,'references/sql'),{recursive:true});for(const n of ['run_checks.sh','run-export-checks.mjs'])await cp(join(here,n),join(copy,'scripts',n));for(const n of FILES)await cp(join(root,'references/sql',n),join(copy,'references/sql',n));
  const copyPath=reportPath.replace(/\.json$/,'')+'-copied.json';report.reports.push({kind:'copied',path:copyPath});await save();const copied=await command('bash',[join(copy,'scripts/run_checks.sh'),c.sourceProject,c.dataset,c.start,c.end,'--billing-project',c.billingProject,'--location',c.location,'--report',copyPath]);report.copiedCommand=copied;await save();assert.equal(copied.code,0,copied.stderr);const copiedReport=JSON.parse(await readFile(copyPath,'utf8'));verifyTemplates(copiedReport,c);assert.deepEqual(copiedReport.templates,main.report.templates);report.reports[1].sha256=sha256(await readFile(copyPath));await save();
  const columns='event_timestamp, TIMESTAMP_MICROS(event_timestamp) AS precise_timestamp';const from=` FROM \`${c.sourceProject}.${c.dataset}.events_*\``;const suffix=` WHERE _TABLE_SUFFIX BETWEEN '${c.start}' AND '${c.end}'`;const order=' ORDER BY event_timestamp';
  const filtered=await run('constant-suffix-pruning-probe',`SELECT ${columns}${from}${suffix}${order}`);assert.equal(filtered.state,'completed');assert.deepEqual(filtered.result.rows,fixture.probes.filtered_timestamps.map(x=>({event_timestamp:x,precise_timestamp:x})));
  const broad=await run('unrestricted-wildcard-pruning-and-pagination-probe',`SELECT ${columns}${from}${order}`);assert.equal(broad.state,'completed');const expected=fixture.probes.unrestricted_segments.flatMap(s=>Array.from({length:s.count},()=>({event_timestamp:s.timestamp,precise_timestamp:s.timestamp})));assert.deepEqual(broad.result.rows,expected);assert.equal(broad.result.totalRows,String(fixture.probes.unrestricted_rows));assert.ok(broad.result.pages.length>1);assert.ok(BigInt(filtered.totalBytesProcessed)>0n);assert.ok(BigInt(broad.totalBytesProcessed)>BigInt(filtered.totalBytesProcessed));report.pruning={filteredBytes:filtered.totalBytesProcessed,unrestrictedBytes:broad.totalBytesProcessed,actualPaginationPages:broad.result.pages.length,rows:broad.result.totalRows};await save();
  const original=main.report.templates.find(t=>t.name==='landing_pages.sql').query,mutant=original.replaceAll(suffix.trim(),()=> 'WHERE TRUE');assert.notEqual(mutant,original);const mutation=await run('removed-suffix-template-mutation',mutant);assert.equal(mutation.state,'completed');assert.throws(()=>assert.deepEqual(normalizeScope(outputOf(mutation),c),fixture.expected['landing_pages.sql']));mutation.verification='expected_output_rejection';
  const cap=await run('deliberate-one-byte-cap-rejection',`SELECT ${columns}${from}${order}`,'1');assert.equal(cap.state,'query_failed');assert.ok(/bytes|billing|limit/i.test(JSON.stringify(cap.metadata.status.errorResult)));cap.verification='expected_native_byte_cap_rejection';await save();
  // Read-only recheck each successful recorded handle; never submit another job.
  for(const entry of report.reports){const before=JSON.parse(await readFile(entry.path,'utf8'));const recheckPath=entry.path.replace(/\.json$/,'')+'-recheck.json';const rechecked=await runChecks({config:c,report:recheckPath,resumeReport:entry.path});verifyTemplates(rechecked.report,c);assert.deepEqual(rechecked.report.jobs.map(j=>j.jobId),before.jobs.map(j=>j.jobId));entry.recheck={path:recheckPath,sha256:sha256(await readFile(recheckPath))};await save();}
  for(const job of report.jobs.filter(j=>j.state==='completed')){const previous=structuredClone(job.result);await executeJob(job,c,transport,save,{submit:false});assert.equal(job.state,'completed');assert.deepEqual(job.result.rows,previous.rows);assert.equal(job.result.totalRows,previous.totalRows);}
  for(const t of templates)assert.equal(sha256(await readFile(join(root,'references/sql',t.name))),t.sourceSha256);
  report.state='passed';report.counts={templateJobs:8,copiedTemplateJobs:8,setupJobs:1,pruningProbeJobs:2,caughtTemplateMutants:1,enforcedByteCapFailures:1,totalNativeJobs:21,successfulReadOnlyRechecks:20};await save();
 }catch(e){report.state='failed';report.error=e.message;await save();throw e;}
 finally{
  if(owned){const deleted=await bq(['rm','--recursive','--force','--dataset',`${c.sourceProject}:${c.dataset}`]);const absent=await bq(['show','--dataset',`${c.sourceProject}:${c.dataset}`]);report.cleanup={deleteCode:deleted.code,absenceCode:absent.code,verifiedAbsent:deleted.code===0&&absent.code!==0&&/Not found|notFound/i.test(absent.stdout+absent.stderr)};if(!report.cleanup.verifiedAbsent){report.state='failed';report.cleanupError='Exact owned dataset absence not verified';}}
  await rm(copy,{recursive:true,force:true});report.completedAt=new Date().toISOString();await save();console.log(`${report.state}: ${reportPath}`);
 }
 if(report.state!=='passed')throw new Error('Synthetic proof or cleanup incomplete');return {path:reportPath,report};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length!==2)throw new Error('Offline test takes no arguments; native entrypoint is run_checks.sh --synthetic --billing-project PROJECT');await offline();}

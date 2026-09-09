import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
const fixturePath=new URL('../references/deleted-ad-coverage-fixtures.json',import.meta.url);
const fixtureText=await readFile(fixturePath,'utf8'),data=JSON.parse(fixtureText);
const names={deleted:'deleted-ad-coverage'};
for(const f of data.cases)f.check='deleted';
const sources=Object.fromEntries(await Promise.all(Object.entries(names).map(async([k,v])=>[k,await readFile(new URL('./'+v+'.sql',import.meta.url),'utf8')])));
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\0','\\x00')+"'";
function literal(v,t){
 if(v===null||v===undefined)return 'CAST(NULL AS '+t+')';
 if(t==='BOOL'&&typeof v==='boolean')return v?'TRUE':'FALSE';
 return 'CAST('+quote(v)+' AS '+t+')';
}
function table(name,rows,schema){
 const select=r=>'SELECT '+Object.entries(schema).map(([k,t])=>literal(r[k],t)+' AS '+k).join(', ');
 return 'CREATE OR REPLACE TEMP TABLE '+name+' AS\n'+(rows.length?rows.map(select).join('\nUNION ALL\n'):select({})+' FROM UNNEST(ARRAY<INT64>[])')+';';
}
function query(fixtures,kind,source=sources[kind]){
 const schemas=structuredClone(data.schemas),rows=Object.fromEntries(Object.keys(schemas).map(k=>[k,[]]));
 for(const f of fixtures){
  for(const [table,fields]of Object.entries(f.type_overrides??{}))Object.assign(schemas[table],fields);
  for(const c of f.input.configuration_rows??[f.input.configuration])rows.configuration_input.push({...c,invocation_key:f.id});
  for(const [name,key]of [['ad_input','ads'],['reference_input','reference'],['membership_input','membership']]){
   if(!schemas[name])continue;
   rows[name].push(...f.input[key].map(r=>({...r,invocation_key:f.id})));
  }
 }
 let result=source.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>Object.entries(schemas).map(([name,schema])=>table(name,rows[name],schema)).join('\n'));
 if(fixtures.length>1)result=result.replace(/-- BEGIN SINGLE INVOCATION[\s\S]*?-- END SINGLE INVOCATION/,'-- Independent synthetic fixture namespaces only.');
 return result;
}
const flags=process.argv.slice(2),option=(name,fallback)=>{const n=flags.indexOf(name);return n<0?fallback:flags[n+1];};
const successes=data.cases.filter(c=>c.expected),failures=data.cases.filter(c=>c.expectedError);
assert.equal(new Set(data.cases.map(c=>c.id)).size,data.cases.length);
for(const c of data.cases){assert.ok(c.check in sources);assert.ok(c.expected||c.expectedError);if(c.expected){assert.equal(c.expected.configuration.invocation_key,c.id);assert.ok(Array.isArray(c.expected.details));}}
for(const source of Object.values(sources))assert.ok(!/LANGUAGE\s+js/i.test(source));
if(!flags.includes('--live')){
 console.log('NO SQL EXECUTED: validated '+data.cases.length+' fixture definitions. Use --live --project YOUR_BILLING_PROJECT --integration.');
}else{
 const project=option('--project');assert.ok(project&&!project.startsWith('--'),'--live requires --project');
 const location=option('--location','US'),stamp=new Date().toISOString();
 const reportPath=option('--report',join(homedir(),'Downloads','attribution-deleted-ad-coverage-bigquery-evidence-'+stamp.replaceAll(/[^0-9]/g,'')+'.json'));
 const priorPath=option('--resume-report'),prior=priorPath?JSON.parse(await readFile(priorPath,'utf8')):null;
 if(prior){assert.equal(prior.project,project);assert.equal(prior.location,location);assert.notEqual(priorPath,reportPath);}
 const report={status:'running',startedAt:stamp,project,location,nodeVersion:process.version,sourceSha256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hash(v)])),fixtureSha256:hash(fixtureText),runnerSha256:hash(await readFile(new URL(import.meta.url))),maximumBytesBilledPerJob:1073741824,resumedFrom:priorPath??null,jobs:[]};
 let saves=Promise.resolve();
 async function save(){const snapshot=JSON.stringify(report,null,2)+'\n';saves=saves.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,snapshot);});await saves;}
 function command(args,input=''){return new Promise((resolve,reject)=>{const child=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
 const common=['--project_id='+project,'--location='+location,'--format=json','--quiet'];
 const parsedRows=text=>{const x=JSON.parse(text);return Array.isArray(x.at(-1))?x.at(-1):x;};
 async function run(label,sql,expectedError=null,parameters=[]){
  const found=prior?.jobs.find(j=>j.querySha256===hash(sql)&&JSON.stringify(j.parameters??[])===JSON.stringify(parameters)&&j.state==='DONE'&&(expectedError?j.actualError?.message?.includes(expectedError):j.actualError===null&&j.result));
  if(found){
   const record={...found,label,expectedError,priorExpectedError:found.expectedError,reusedFrom:priorPath};report.jobs.push(record);await save();
   if(expectedError){const fetched=await command([...common,'show','--job',record.jobId]);assert.equal(fetched.code,0,fetched.stderr);const job=JSON.parse(fetched.stdout);assert.equal(job.status.state,'DONE');assert.ok(job.status.errorResult?.message?.includes(expectedError));record.actualError=job.status.errorResult;record.verification='passed';record.readOnlyReverifiedAt=new Date().toISOString();await save();return {record,rows:null};}
   const fetched=await command([...common,'head','--job','--max_rows=10000',record.jobId]);assert.equal(fetched.code,0,fetched.stderr);
   record.result=parsedRows(fetched.stdout);record.readOnlyReverifiedAt=new Date().toISOString();await save();return {record,rows:record.result};
  }
  const jobId='attribution_deleted_'+label.replaceAll(/[^a-zA-Z0-9_]/g,'_')+'_'+randomUUID().replaceAll('-','');
  const record={label,jobId,querySha256:hash(sql),query:sql,parameters,expectedError,verification:'pending'};report.jobs.push(record);await save();
  console.log('SUBMIT '+label+' '+jobId);
  const response=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824','--job_id='+jobId,'--max_rows=10000',...parameters.map(p=>'--parameter='+p)],sql);
  const show=await command([...common,'show','--job',jobId]);assert.equal(show.code,0,show.stderr);const job=JSON.parse(show.stdout);
  Object.assign(record,{state:job.status?.state,actualError:job.status?.errorResult??null,jobReference:job.jobReference,queryParameters:job.configuration?.query?.queryParameters??[],totalBytesProcessed:job.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:job.statistics?.query?.totalBytesBilled??null,totalSlotMs:job.statistics?.totalSlotMs??null,maximumBytesBilled:job.configuration?.query?.maximumBytesBilled,useLegacySql:job.configuration?.query?.useLegacySql,useQueryCache:job.configuration?.query?.useQueryCache,stdout:response.stdout,stderr:response.stderr});
  await save();assert.equal(record.state,'DONE');assert.equal(String(record.maximumBytesBilled),'1073741824');assert.equal(record.useLegacySql,false);assert.equal(record.useQueryCache,false);
  if(expectedError){assert.notEqual(response.code,0);assert.ok(record.actualError?.message?.includes(expectedError),label+': '+JSON.stringify(record.actualError));record.verification='passed';await save();return {record,rows:null};}
  assert.equal(response.code,0,label+': '+response.stdout+'\n'+response.stderr);assert.equal(record.actualError,null);
  record.result=parsedRows(response.stdout);await save();return {record,rows:record.result};
 }
 async function verify(label,sql,fixtures){
  const runResult=await run(label,sql);assert.equal(runResult.rows.length,fixtures.length);
  for(const f of fixtures){const row=runResult.rows.find(r=>r.invocation_key===f.id);assert.ok(row,f.id+': missing finding');assert.deepEqual(JSON.parse(row.result_json),f.expected,f.id+': full literal finding');console.log('PASS '+f.id);}
  runResult.record.verification='passed';runResult.record.comparedFixtureIds=fixtures.map(f=>f.id);await save();return runResult;
 }
 try{
  report.bqVersion=(await command(['version'])).stdout.trim();await save();
  for(const kind of Object.keys(names)){
   const base=structuredClone(data.cases.find(c=>c.id===kind+'-baseline'));base.id='deleted-baseline';base.expected.configuration.invocation_key='deleted-baseline';
   await verify(kind+'_standalone',sources[kind],[base]);
   await verify(kind+'_full_goldens',query(successes.filter(c=>c.check===kind),kind),successes.filter(c=>c.check===kind));
  }
  for(let i=0;i<failures.length;i+=3){const results=await Promise.allSettled(failures.slice(i,i+3).map(f=>run(f.id,query([f],f.check),f.expectedError)));for(const result of results)if(result.status==='rejected')throw result.reason;}
  for(const kind of Object.keys(names)){
   const f=structuredClone(data.cases.find(c=>c.id===kind+'-baseline'));
   f.input.configuration_rows=[];await run(kind+'_missing_config',query([f],kind),'invalid configuration cardinality');
   f.input.configuration_rows=[f.input.configuration,f.input.configuration];await run(kind+'_duplicate_config',query([f],kind),'invalid configuration cardinality');
  }
  report.mutations=[];
  for(const [label,id,before,after] of [
   ['drop_campaign_only','campaign-only',' UNION DISTINCT SELECT invocation_key,pair_key,event_date,campaign_key,currency FROM reference_campaign;',';'],
   ['backfill_auto_exemption','backfill-gap',"WHEN IFNULL(x.has_gap,FALSE) THEN 'fail'","WHEN IFNULL(x.has_gap,FALSE) AND pair.ad_capture_mode!='historical_backfill' THEN 'fail'"]
  ]){
   assert.equal(sources.deleted.split(before).length,2);const f=data.cases.find(c=>c.id===id);
   const result=await run('mutation_'+label,query([f],'deleted',sources.deleted.replace(before,after)));
   const actual=JSON.parse(result.rows[0].result_json);assert.notDeepEqual(actual,f.expected);assert.equal(actual.status,'pass');result.record.verification='passed';report.mutations.push({name:label,status:'rejected',actual});await save();
  }
  if(flags.includes('--integration')){
   const producer=`CREATE TEMP TABLE hourly AS
    SELECT 'ad_export' AS source_system,'account-a' AS source_scope,'hour-1' AS fact_key,DATE '2026-01-01' AS event_date,'Campaign+A' AS campaign_key,NUMERIC '3' AS spend,'USD' AS currency,'known' AS spend_status,'Ad+A' AS ad_key
    UNION ALL SELECT 'ad_export','account-a','hour-2',DATE '2026-01-01','Campaign+A',NUMERIC '7','USD','known','Ad+B';
    CREATE TEMP TABLE campaign_daily AS SELECT 'campaign_export' AS source_system,source_scope,'daily-1' AS fact_key,event_date,campaign_key,SUM(spend) AS spend,currency,'known' AS spend_status FROM hourly GROUP BY source_scope,event_date,campaign_key,currency;
    SELECT TO_JSON_STRING(STRUCT(
     ARRAY(SELECT AS STRUCT source_system,source_scope,fact_key,event_date,campaign_key,CAST(spend AS STRING) AS spend,currency,spend_status,ad_key FROM hourly ORDER BY fact_key) AS ads,
     ARRAY(SELECT AS STRUCT source_system,source_scope,fact_key,event_date,campaign_key,CAST(spend AS STRING) AS spend,currency,spend_status FROM campaign_daily ORDER BY fact_key) AS reference
    )) AS result_json;`;
   const produced=await run('integration_native_producer',producer);assert.equal(produced.rows.length,1);const snapshot=JSON.parse(produced.rows[0].result_json);
   assert.deepEqual(snapshot,{ads:data.integration.passed.input.ads,reference:data.integration.passed.input.reference},'independent native producer golden');produced.record.verification='passed';await save();
   report.integration={producerJobId:produced.record.jobId,producerQuerySha256:hash(producer),snapshot,snapshotSha256:hash(JSON.stringify(snapshot)),cases:[]};await save();
   for(const [name,spec,ads]of [['actual',data.integration.passed,snapshot.ads],['corrupted',data.integration.corrupted,snapshot.ads.filter(r=>r.fact_key!=='hour-2')]]){
    const input={configuration:spec.input.configuration,membership:spec.input.membership,ads,reference:snapshot.reference};
    const f={id:spec.id,check:'deleted',input,expected:spec.expected};const checked=await verify('integration_'+name,query([f],'deleted'),[f]);
    report.integration.cases.push({name,consumerJobId:checked.record.jobId,consumerInput:input,consumerInputSha256:hash(JSON.stringify(input))});await save();
   }
   report.integration.status='passed';await save();
  }
  report.status='passed';report.completedAt=new Date().toISOString();report.counts={literalGoldens:successes.length,expectedFailures:failures.length+2,mutations:2,integrationCases:report.integration?.cases.length??0,jobs:report.jobs.length};await save();console.log('PASS '+JSON.stringify(report.counts)+' '+reportPath);
 }catch(error){report.status='failed';report.error=error.stack;await save();throw error;}
}

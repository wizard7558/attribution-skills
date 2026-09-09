import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
const fixturePath=new URL('../references/empty-column-fixtures.json',import.meta.url);
const fixtureText=await readFile(fixturePath,'utf8'),data=JSON.parse(fixtureText);
const names={empty:'empty-column-probe'};
const extractor=await readFile(new URL('./inspect-column-population.sql',import.meta.url),'utf8');
for(const f of data.cases)f.check='empty';
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
  for(const [name,key]of [['observation_input','observations'],['membership_input','membership']]){
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
 const reportPath=option('--report',join(homedir(),'Downloads','attribution-empty-columns-bigquery-evidence-'+stamp.replaceAll(/[^0-9]/g,'')+'.json'));
 const priorPath=option('--resume-report'),prior=priorPath?JSON.parse(await readFile(priorPath,'utf8')):null;
 if(prior){assert.equal(prior.project,project);assert.equal(prior.location,location);assert.notEqual(priorPath,reportPath);}
 const report={status:'running',startedAt:stamp,project,location,nodeVersion:process.version,extractorSha256:hash(extractor),sourceSha256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hash(v)])),fixtureSha256:hash(fixtureText),runnerSha256:hash(await readFile(new URL(import.meta.url))),maximumBytesBilledPerJob:1073741824,resumedFrom:priorPath??null,jobs:[]};
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
  const jobId='attribution_empty_columns_'+label.replaceAll(/[^a-zA-Z0-9_]/g,'_')+'_'+randomUUID().replaceAll('-','');
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
   const base=structuredClone(data.cases.find(c=>c.id===kind+'-baseline'));base.id='empty-baseline';base.expected.configuration.invocation_key='empty-baseline';
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
   ['null_to_zero','all-null',"WHEN o.non_null_count>0 THEN 'pass'","WHEN o.non_null_count>=0 THEN 'pass'"],
   ['absent_to_zero','column-absent',"WHEN o.non_null_count>0 THEN 'pass'","WHEN IFNULL(o.non_null_count,0)=0 THEN 'fail' WHEN o.non_null_count>0 THEN 'pass'"]
  ]){
   assert.equal(sources.empty.split(before).length,2);const f=data.cases.find(c=>c.id===id);
   const result=await run('mutation_'+label,query([f],'empty',sources.empty.replace(before,after)));
   const actual=JSON.parse(result.rows[0].result_json);assert.notDeepEqual(actual,f.expected);result.record.verification='passed';report.mutations.push({name:label,status:'rejected',actual});await save();
  }
  const params=(dataset,spec)=>['project:STRING:'+project,'dataset:STRING:'+dataset,'table_name:STRING:'+spec.table,'column_names:ARRAY<STRING>:'+JSON.stringify(spec.columns),
   'source_system:STRING:synthetic_crm','source_scope:STRING:crm-a','population_mode:STRING:'+spec.mode,'report_timezone:STRING:America/Los_Angeles',
   'start_date:DATE:'+(spec.mode==='report_window'?'2026-01-01':'NULL'),'end_date:DATE:'+(spec.mode==='report_window'?'2026-01-01':'NULL'),'date_column:STRING:'+(spec.date_column??'NULL')];
  await run('extractor_invalid_identifier',extractor,'invalid population identifiers',params('invalid.dataset',data.integration[0]));
  if(flags.includes('--integration')){
   const owner=randomUUID().replaceAll('-',''),dataset='attribution_skill_empty_'+owner,qualified=project+':'+dataset;
   report.integration={owner,dataset,qualifiedDataset:qualified,created:false,cleanup:null,cases:[]};await save();let owned=false;
   try{
    const creation=await command([...common,'mk','--dataset','--default_table_expiration=3600','--label=attribution_skill_owner:'+owner,qualified]);report.integration.creation=creation;await save();assert.equal(creation.code,0,'owned dataset creation failed; see private evidence');owned=true;report.integration.created=true;
    const inspected=await command([...common,'show','--dataset',qualified]);assert.equal(inspected.code,0);const metadata=JSON.parse(inspected.stdout);
    assert.equal(metadata.datasetReference.projectId,project);assert.equal(metadata.datasetReference.datasetId,dataset);assert.equal(metadata.labels.attribution_skill_owner,owner);assert.equal(String(metadata.defaultTableExpirationMs),'3600000');report.integration.creationMetadata=metadata;await save();
    const ident=n=>String.fromCharCode(96)+project+'.'+dataset+'.'+n+String.fromCharCode(96);
    const ddl='CREATE TABLE '+ident('population')+` AS
     SELECT DATE '2026-01-01' AS event_date,TIMESTAMP '2026-01-01 07:59:59+00' AS event_ts,DATETIME '2026-01-01 23:59:59' AS local_dt,CAST(NULL AS INT64) AS amount,CAST(NULL AS BOOL) AS flag,CAST(NULL AS STRING) AS text,CAST(NULL AS INT64) AS all_null,CAST(NULL AS JSON) AS json_cell,STRUCT(1 AS nested) AS complex
     UNION ALL SELECT DATE '2026-01-02',TIMESTAMP '2026-01-01 08:00:00+00',DATETIME '2026-01-02 00:00:00',0,FALSE,'',NULL,JSON 'null',STRUCT(2 AS nested)
     UNION ALL SELECT DATE '2026-01-01',TIMESTAMP '2026-01-02 08:00:00+00',DATETIME '2026-01-01 12:00:00',7,TRUE,'ok',NULL,JSON '{}',STRUCT(3 AS nested);
     CREATE TABLE `+ident('empty_table')+' (event_date DATE,amount INT64);';
    const created=await run('integration_create_tables',ddl);created.record.verification='passed';report.integration.creationJobId=created.record.jobId;await save();
    for(const spec of data.integration){
     const reusable=prior?.extractorSha256===hash(extractor)&&prior?.fixtureSha256===hash(fixtureText)?prior.integration?.cases.find(c=>c.id===spec.id):null;
     const snapshotDataset=reusable?.snapshot.dataset??dataset;
     const extracted=await run(spec.id+'_extract',extractor,null,params(snapshotDataset,spec));assert.equal(extracted.rows.length,1);const snapshot=JSON.parse(extracted.rows[0].result_json);
     assert.deepEqual(snapshot,{source_system:'synthetic_crm',source_scope:'crm-a',project,dataset:snapshotDataset,table_key:spec.table,population_mode:spec.mode,report_timezone:'America/Los_Angeles',observed_start:spec.mode==='report_window'?'2026-01-01':null,observed_end:spec.mode==='report_window'?'2026-01-01':null,membership:spec.expectedMembership,observations:spec.expectedObservations,diagnostics:spec.expectedDiagnostics},spec.id+': full independent extraction golden');
     extracted.record.verification='passed';await save();
     const input={configuration:spec.configuration,membership:snapshot.membership,observations:snapshot.observations};
     const f={id:spec.id,check:'empty',input,expected:spec.expected};const consumer=await verify(spec.id+'_check',query([f],'empty'),[f]);
     report.integration.cases.push({id:spec.id,extractorJobId:extracted.record.jobId,consumerJobId:consumer.record.jobId,snapshot,snapshotSha256:hash(JSON.stringify(snapshot)),consumerInput:input,consumerInputSha256:hash(JSON.stringify(input))});await save();
    }
    report.integration.status='passed';await save();
   }catch(error){report.integration.status='failed';report.integration.error=error.message;await save();throw error;}
   finally{
    if(owned){
     const check=await command([...common,'show','--dataset',qualified]);report.integration.cleanupOwnershipRead=check;await save();assert.equal(check.code,0,'cleanup ownership verification failed');
     const metadata=JSON.parse(check.stdout);assert.equal(metadata.datasetReference.projectId,project);assert.equal(metadata.datasetReference.datasetId,dataset);assert.equal(metadata.labels.attribution_skill_owner,owner);
     const deletion=await command([...common,'rm','--recursive','--force','--dataset',qualified]);report.integration.cleanup=deletion;await save();assert.equal(deletion.code,0,'owned cleanup failed');
     const absence=await command([...common,'show','--dataset',qualified]);report.integration.absence=absence;await save();assert.notEqual(absence.code,0);assert.match(absence.stdout+absence.stderr,/Not found/i);report.integration.verifiedAbsentAt=new Date().toISOString();await save();
    }
   }
  }
  report.status='passed';report.completedAt=new Date().toISOString();report.counts={literalGoldens:successes.length,expectedFailures:failures.length+3,mutations:2,integrationCases:report.integration?.cases.length??0,jobs:report.jobs.length};await save();console.log('PASS '+JSON.stringify(report.counts)+' '+reportPath);
 }catch(error){report.status='failed';report.error=error.stack;await save();throw error;}
}

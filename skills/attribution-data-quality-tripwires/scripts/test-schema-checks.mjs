import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
const fixturePath=new URL('../references/schema-fixtures.json',import.meta.url);
const fixtureText=await readFile(fixturePath,'utf8'),data=JSON.parse(fixtureText);
const names={schema:'no-pii-columns'};
const extractor=await readFile(new URL('./inspect-schema.sql',import.meta.url),'utf8');
for(const f of data.cases)f.check='schema';
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
  for(const [name,key]of [['column_input','columns'],['policy_input','policy'],['membership_input','membership']]){
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
 const reportPath=option('--report',join(homedir(),'Downloads','attribution-schema-bigquery-evidence-'+stamp.replaceAll(/[^0-9]/g,'')+'.json'));
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
  const jobId='attribution_schema_'+label.replaceAll(/[^a-zA-Z0-9_]/g,'_')+'_'+randomUUID().replaceAll('-','');
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
   const base=structuredClone(data.cases.find(c=>c.id===kind+'-baseline'));base.id='synthetic-check';base.expected.configuration.invocation_key='synthetic-check';
   await verify(kind+'_standalone',sources[kind],[base]);
   await verify(kind+'_full_goldens',query(successes.filter(c=>c.check===kind),kind),successes.filter(c=>c.check===kind));
  }
  for(let i=0;i<failures.length;i+=3){const results=await Promise.allSettled(failures.slice(i,i+3).map(f=>run(f.id,query([f],f.check),f.expectedError)));for(const result of results)if(result.status==='rejected')throw result.reason;}
  for(const kind of Object.keys(names)){
   const f=structuredClone(data.cases.find(c=>c.id===kind+'-baseline'));
   f.input.configuration_rows=[];await run(kind+'_missing_config',query([f],kind),'invalid configuration cardinality');
   f.input.configuration_rows=[f.input.configuration,f.input.configuration];await run(kind+'_duplicate_config',query([f],kind),'invalid configuration cardinality');
  }
  const nested=data.cases.find(c=>c.id==='nested-policy');
  const before='FROM selected_columns x JOIN policies p USING(invocation_key)';
  assert.equal(sources.schema.split(before).length,2);
  const mutated=sources.schema.replace(before,"FROM (SELECT * FROM selected_columns WHERE STRPOS(field_path,'.')=0) x JOIN policies p USING(invocation_key)");
  const mutation=await run('mutation_drop_nested',query([nested],'schema',mutated));
  const mutationActual=JSON.parse(mutation.rows[0].result_json);assert.equal(mutationActual.status,'pass');assert.notDeepEqual(mutationActual,nested.expected);mutation.record.verification='passed';report.mutations=[{name:'drop_nested_paths',status:'rejected',actual:mutationActual}];await save();
  const params=(p,d,system,scope,tables)=>['project:STRING:'+p,'dataset:STRING:'+d,'source_system:STRING:'+system,'source_scope:STRING:'+scope,'table_keys:ARRAY<STRING>:'+JSON.stringify(tables)];
  await run('extractor_invalid_project',extractor,'invalid metadata identifiers',params('bad.project','synthetic_dataset','synthetic_crm','crm-a',['safe_table']));
  await run('extractor_invalid_dataset',extractor,'invalid metadata identifiers',params(project,'bad;dataset','synthetic_crm','crm-a',['safe_table']));
  await run('extractor_invalid_tables',extractor,'invalid requested tables',params(project,'synthetic_dataset','synthetic_crm','crm-a',['bad.table']));
  if(flags.includes('--integration')){
   const owner=randomUUID().replaceAll('-',''),dataset='attribution_skill_schema_'+owner,qualified=project+':'+dataset;
   const spec=data.integration;
   report.integration={owner,dataset,qualifiedDataset:qualified,created:false,cleanup:null};await save();
   let owned=false;
   try{
    const creation=await command([...common,'mk','--dataset','--default_table_expiration=3600','--label=attribution_skill_owner:'+owner,qualified]);
    report.integration.creation=creation;await save();assert.equal(creation.code,0,'owned dataset creation failed; see private evidence');owned=true;report.integration.created=true;
    const inspected=await command([...common,'show','--dataset',qualified]);assert.equal(inspected.code,0);const metadata=JSON.parse(inspected.stdout);
    assert.equal(metadata.datasetReference.projectId,project);assert.equal(metadata.datasetReference.datasetId,dataset);assert.equal(metadata.labels.attribution_skill_owner,owner);assert.equal(String(metadata.defaultTableExpirationMs),'3600000');report.integration.creationMetadata=metadata;await save();
    const ident=n=>String.fromCharCode(96)+project+'.'+dataset+'.'+n+String.fromCharCode(96);
    const ddl="CREATE TABLE "+ident('clean_table')+" (lead_key STRING, stage_count INT64) AS SELECT 'synthetic-lead', 1;\n"+
     "CREATE TABLE "+ident('nested_table')+" (lead_key STRING, contact STRUCT<Email STRING, city STRING>) AS SELECT 'synthetic-lead', STRUCT('synthetic@example.invalid' AS Email, 'Synthetic' AS city);\n"+
     "CREATE TABLE "+ident('empty_table')+" (record_key STRING);";
    const created=await run('integration_create_tables',ddl);created.record.verification='passed';report.integration.creationJobId=created.record.jobId;await save();
    const extracted=await run('integration_inspect_schema',extractor,null,params(project,dataset,'synthetic_crm','crm-a',spec.tables));assert.equal(extracted.rows.length,1);
    const snapshot=JSON.parse(extracted.rows[0].result_json);
    assert.deepEqual(snapshot,{source_system:'synthetic_crm',source_scope:'crm-a',project,dataset,table_keys:spec.tables,membership:spec.expectedMembership,columns:spec.expectedColumns},'full independently authored metadata snapshot');
    extracted.record.verification='passed';report.integration.extractorJobId=extracted.record.jobId;report.integration.snapshot=snapshot;report.integration.snapshotSha256=hash(JSON.stringify(snapshot));await save();
    const input={configuration:structuredClone(spec.configuration),membership:snapshot.membership,columns:snapshot.columns,policy:structuredClone(spec.policy)};
    const f={id:'actual-schema',check:'schema',input,expected:spec.expected};
    const checked=await verify('integration_actual_schema_policy',query([f],'schema'),[f]);
    report.integration.consumerJobId=checked.record.jobId;report.integration.consumerInput=input;report.integration.consumerInputSha256=hash(JSON.stringify(input));report.integration.status='passed';await save();
   }catch(error){report.integration.status='failed';report.integration.error=error.message;await save();throw error;}
   finally{
    if(owned){
     const check=await command([...common,'show','--dataset',qualified]);report.integration.cleanupOwnershipRead=check;await save();assert.equal(check.code,0,'cleanup ownership verification failed');
     const metadata=JSON.parse(check.stdout);assert.equal(metadata.datasetReference.projectId,project);assert.equal(metadata.datasetReference.datasetId,dataset);assert.equal(metadata.labels.attribution_skill_owner,owner,'cleanup ownership mismatch');
     const removal=await command([...common,'rm','--dataset','--recursive','--force',qualified]);report.integration.cleanup={removal};await save();assert.equal(removal.code,0,'owned dataset cleanup failed');
     const absent=await command([...common,'show','--dataset',qualified]);report.integration.cleanup.absenceVerification=absent;assert.notEqual(absent.code,0);assert.match(absent.stdout+absent.stderr,/Not found|not found/);report.integration.cleanup.status='verified_absent';report.integration.cleanup.completedAt=new Date().toISOString();await save();
    }
   }
  }
  report.status='passed';report.completedAt=new Date().toISOString();report.counts={fullGoldenFixtures:successes.length,structuralFixtures:failures.length,configurationFailures:2,standaloneQueries:1,semanticMutations:1,extractorValidationFailures:3,integrationNativeJobs:report.integration?3:0};await save();
  const doc=new URL('../references/schema-contract.md',import.meta.url);const content=await readFile(doc,'utf8');
  const status='<!-- execution-status:start -->\nAuthenticated native BigQuery execution passed on '+report.completedAt.slice(0,10)+': '+successes.length+' full literal findings, '+failures.length+' structural cases, two configuration failures, three extractor parameter failures, one standalone example and one rejected nested-path mutation. '+(report.integration?'A newly owned disposable dataset supplied actual TABLES/COLUMNS/COLUMN_FIELD_PATHS metadata; its full snapshot and policy finding matched independent goldens, and ownership-checked cleanup verified the dataset absent. ':'Metadata integration was not requested. ')+'All query jobs confirmed Standard SQL, disabled cache and a 1 GiB cap. Full private hashes, results, metadata and cleanup proof remain in Downloads. This proves synthetic schema-name behavior only.\n<!-- execution-status:end -->';
  await writeFile(doc,content.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/,status));
  await writeFile(join(homedir(),'Downloads','attribution-schema-policy-guide.md'),(await readFile(doc,'utf8')));
  console.log('PASS '+JSON.stringify(report.counts)+' '+reportPath);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

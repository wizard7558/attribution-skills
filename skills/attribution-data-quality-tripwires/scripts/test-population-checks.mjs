import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
const fixturePath=new URL('../references/population-fixtures.json',import.meta.url);
const fixtureText=await readFile(fixturePath,'utf8'),data=JSON.parse(fixtureText);
const names={unmapped:'unmapped-share',match:'match-rate',primary:'primary-uniqueness',parity:'source-parity'};
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
 const schemas=structuredClone(data.schemas[kind]),rows=Object.fromEntries(Object.keys(schemas).map(k=>[k,[]]));
 for(const f of fixtures){
  for(const [table,fields]of Object.entries(f.type_overrides??{}))Object.assign(schemas[table],fields);
  for(const c of f.input.configuration_rows??[f.input.configuration])rows.configuration_input.push({...c,invocation_key:f.id});
  for(const [name,key]of [['source_input','source'],['reference_input','reference'],['observed_input','observed'],['membership_input','membership']]){
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
 const reportPath=option('--report',join(homedir(),'Downloads','attribution-population-bigquery-evidence-'+stamp.replaceAll(/[^0-9]/g,'')+'.json'));
 const priorPath=option('--resume-report'),prior=priorPath?JSON.parse(await readFile(priorPath,'utf8')):null;
 if(prior){assert.equal(prior.project,project);assert.equal(prior.location,location);assert.notEqual(priorPath,reportPath);}
 const report={status:'running',startedAt:stamp,project,location,nodeVersion:process.version,sourceSha256:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hash(v)])),fixtureSha256:hash(fixtureText),runnerSha256:hash(await readFile(new URL(import.meta.url))),maximumBytesBilledPerJob:1073741824,resumedFrom:priorPath??null,jobs:[]};
 let saves=Promise.resolve();
 async function save(){const snapshot=JSON.stringify(report,null,2)+'\n';saves=saves.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,snapshot);});await saves;}
 function command(args,input=''){return new Promise((resolve,reject)=>{const child=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
 const common=['--project_id='+project,'--location='+location,'--format=json','--quiet'];
 const parsedRows=text=>{const x=JSON.parse(text);return Array.isArray(x.at(-1))?x.at(-1):x;};
 async function run(label,sql,expectedError=null){
  const found=prior?.jobs.find(j=>j.querySha256===hash(sql)&&j.state==='DONE'&&(expectedError?j.actualError?.message?.includes(expectedError):j.actualError===null&&j.result));
  if(found){
   const record={...found,label,expectedError,priorExpectedError:found.expectedError,reusedFrom:priorPath};report.jobs.push(record);await save();
   if(expectedError){const fetched=await command([...common,'show','--job',record.jobId]);assert.equal(fetched.code,0,fetched.stderr);const job=JSON.parse(fetched.stdout);assert.equal(job.status.state,'DONE');assert.ok(job.status.errorResult?.message?.includes(expectedError));record.actualError=job.status.errorResult;record.verification='passed';record.readOnlyReverifiedAt=new Date().toISOString();await save();return {record,rows:null};}
   const fetched=await command([...common,'head','--job','--max_rows=10000',record.jobId]);assert.equal(fetched.code,0,fetched.stderr);
   record.result=parsedRows(fetched.stdout);record.readOnlyReverifiedAt=new Date().toISOString();await save();return {record,rows:record.result};
  }
  const jobId='attribution_population_'+label.replaceAll(/[^a-zA-Z0-9_]/g,'_')+'_'+randomUUID().replaceAll('-','');
  const record={label,jobId,querySha256:hash(sql),query:sql,expectedError,verification:'pending'};report.jobs.push(record);await save();
  console.log('SUBMIT '+label+' '+jobId);
  const response=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824','--job_id='+jobId,'--max_rows=10000'],sql);
  const show=await command([...common,'show','--job',jobId]);assert.equal(show.code,0,show.stderr);const job=JSON.parse(show.stdout);
  Object.assign(record,{state:job.status?.state,actualError:job.status?.errorResult??null,jobReference:job.jobReference,totalBytesProcessed:job.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:job.statistics?.query?.totalBytesBilled??null,totalSlotMs:job.statistics?.totalSlotMs??null,maximumBytesBilled:job.configuration?.query?.maximumBytesBilled,useLegacySql:job.configuration?.query?.useLegacySql,useQueryCache:job.configuration?.query?.useQueryCache,stdout:response.stdout,stderr:response.stderr});
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
  const mutations=[
   {kind:'unmapped',fixture:'unmapped-outside-threshold',before:'true_count>threshold*eligible_count',after:'true_count<threshold*eligible_count'},
   {kind:'primary',fixture:'primary-multiple-partial',before:'FROM selected_source GROUP BY 1,2,3,4,5,6;',after:'FROM selected_source WHERE FALSE GROUP BY 1,2,3,4,5,6;'}
  ];
  report.mutations=[];
  for(const m of mutations){const f=data.cases.find(c=>c.id===m.fixture);assert.equal(sources[m.kind].split(m.before).length,2);const result=await run('mutation_'+m.kind,query([f],m.kind,sources[m.kind].replace(m.before,m.after)));const actual=JSON.parse(result.rows[0].result_json);assert.notDeepEqual(actual,f.expected);assert.notEqual(actual.status,f.expected.status);result.record.verification='passed';report.mutations.push({check:m.kind,status:'rejected',fixture:m.fixture,actual});await save();}
  if(flags.includes('--integration')){
   const moduleUrl=new URL('../../crm-paid-attribution/scripts/attribute-leads.mjs',import.meta.url);
   const {attributeLeads,cleanClick}=await import(moduleUrl.href);
   const input=structuredClone(data.integration.input),before=JSON.stringify(input);
   const actual=attributeLeads(input.leads,input.options);assert.equal(JSON.stringify(input),before);
   const expectedProjection=data.integration.expectedProjection;
   assert.deepEqual(actual.map((r,i)=>Object.fromEntries(Object.keys(expectedProjection[i]).map(k=>[k,r[k]]))),expectedProjection,'independent actual CRM projection');
   report.integration={producerSourceSha256:hash(await readFile(moduleUrl)),taxonomySha256:hash(await readFile(new URL('../../crm-paid-attribution/scripts/channel-taxonomy.mjs',import.meta.url))),producerInput:input,producerInputSha256:hash(JSON.stringify(input)),producerResult:actual,producerResultSha256:hash(JSON.stringify(actual)),cases:[]};await save();
   const paid=new Set(['Paid Search','Paid Social','Paid Other']);
   const clicks=new Set(['dclid','gclid','gbraid','wbraid','msclkid','fbclid','ttclid','rdt_cid','li_fat_id','twclid','epik','sccid']);
   for(const kind of Object.keys(names)){
    const spec=data.integration[kind],configuration=structuredClone(spec.configuration),id=spec.expected.configuration.invocation_key;
    const payload={configuration,membership:structuredClone(spec.membership)};
    if(kind==='parity'){
     payload.reference=structuredClone(spec.reference);
     const counts=new Map();
     for(const row of actual){const key=JSON.stringify([row.source_system,row.source_scope]);counts.set(key,(counts.get(key)??0)+1);}
     payload.observed=[...counts].map(([key,count])=>{const[source_system,source_scope]=JSON.parse(key);return {source_system,source_scope,count,event_date:'2026-01-01',report_scope:configuration.report_scope,report_timezone:configuration.report_timezone,date_mode:configuration.date_mode,metric_name:configuration.metric_name};});
    }else payload.source=actual.map(row=>{
     const projected={source_system:row.source_system,source_scope:row.source_scope,record_key:row.lead_key,included:true};
     if(kind==='primary'){
      let group_key=null;
      if(clicks.has(row.match_key)&&['HIGH','LOW'].includes(row.confidence)){
       const raw=row.confidence==='HIGH'?row.raw_evidence.click_ids:row.raw_evidence.first_touch_click_ids;
       const cleaned=cleanClick(raw[row.match_key]);assert.ok(cleaned);
       group_key=JSON.stringify([row.match_key,cleaned]);
      }
      return {...projected,group_key,is_attribution_primary:row.is_attribution_primary};
     }
     return {...projected,eligible:kind==='unmapped'||paid.has(row.channel),meets_condition:kind==='unmapped'?['unmapped','unattributed'].includes(row.quality_status):row.ad_match_status==='matched'};
    });
    const fixture={id,check:kind,input:payload,expected:spec.expected};
    const checked=await verify('integration_'+kind,query([fixture],kind),[fixture]);report.integration.cases.push({check:kind,input:payload,inputSha256:hash(JSON.stringify(payload)),querySha256:checked.record.querySha256,jobId:checked.record.jobId});await save();
    if(kind==='primary'){
     const bad=structuredClone(fixture);bad.id+='-corrupted';bad.expected=spec.corruptedExpected;
     bad.input.source.find(r=>r.source_scope==='crm-a'&&r.record_key==='B').is_attribution_primary=true;
     const corrupted=await verify('integration_primary_corrupted',query([bad],kind),[bad]);report.integration.cases.push({check:'primary_corrupted',inputSha256:hash(JSON.stringify(bad.input)),querySha256:corrupted.record.querySha256,jobId:corrupted.record.jobId});await save();
    }
   }
  }
  report.status='passed';report.completedAt=new Date().toISOString();report.counts={fullGoldenFixtures:successes.length,structuralFixtures:failures.length,configurationFailures:8,standaloneQueries:4,semanticMutations:2,integrationCrmProducer:report.integration?1:0,integrationChecks:report.integration?5:0};await save();
  const doc=new URL('../references/population-contract.md',import.meta.url);const content=await readFile(doc,'utf8');
  const status='<!-- execution-status:start -->\nAuthenticated native BigQuery execution passed on '+report.completedAt.slice(0,10)+': '+successes.length+' full literal golden findings, '+failures.length+' structural fixtures, eight configuration failures, four standalone examples and two rejected native SQL mutations. '+(report.integration?'Actual CRM resolver output passed its independently authored projection and supplied both rates, primary uniqueness and source parity; a corrupted primary flag failed as expected. ':'Integration was not requested. ')+'All submitted jobs confirmed a 1 GiB cap, Standard SQL and disabled cache. Private source/query hashes, full results, job metadata, versions and bytes remain in Downloads evidence. This is synthetic correctness evidence, not a scale benchmark.\n<!-- execution-status:end -->';
  await writeFile(doc,content.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/,status));
  console.log('PASS '+JSON.stringify(report.counts)+' '+reportPath);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

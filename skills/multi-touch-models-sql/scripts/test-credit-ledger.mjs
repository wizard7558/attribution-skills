import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const sqlFile=new URL('../references/sql/credit_ledger.sql',import.meta.url);
let sql=await readFile(sqlFile,'utf8');
const fixtureText=await readFile(new URL('../references/ledger-fixtures.json',import.meta.url),'utf8');
const {cases,additional_checks:additionalChecks,failure_cases:failureCases}=JSON.parse(fixtureText);
const hash=(x)=>createHash('sha256').update(x).digest('hex');
const flags=process.argv.slice(2),option=(key,fallback)=>flags.includes(key)?flags[flags.indexOf(key)+1]:fallback;
const identity={source_system:'STRING',source_scope:'STRING'};
const subject={subject_source_system:'STRING',subject_source_scope:'STRING',subject_key:'STRING'};
const schemas={
 invocation_input:{invocation_key:'STRING',report_timezone:'STRING',report_start_date:'DATE',report_end_date:'DATE',as_of:'TIMESTAMP',requested_lookback_days:'INT64',min_lookback_days:'INT64',max_lookback_days:'INT64',half_life_days:'FLOAT64',conversion_window_mode:'STRING'},
 touch_input:{invocation_key:'STRING',...identity,touch_key:'STRING',visitor_key:'STRING',occurred_at:'TIMESTAMP',channel:'STRING',taxonomy_version:'STRING',...subject},
 conversion_input:{invocation_key:'STRING',...identity,conversion_key:'STRING',occurred_at:'TIMESTAMP',...subject,value:'NUMERIC',currency:'STRING',value_status:'STRING'}
};
const quote=(x)=>`'${String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n')}'`;
function table(name,rows,overrides={}){
 const select=(r)=>`SELECT ${Object.entries({...schemas[name],...overrides}).map(([k,t])=>`CAST(${r[k]==null?'NULL':quote(r[k])} AS ${t}) AS ${k}`).join(', ')}`;
 return `CREATE TEMP TABLE ${name} AS\n${rows.length?rows.map(select).join('\nUNION ALL\n'):`${select({})} FROM UNNEST(ARRAY<INT64>[])`};`;
}
function inputs(f){return [['invocation_input',[f.input.configuration]],['touch_input',f.input.touches],['conversion_input',f.input.conversions]].map(([name,rows])=>table(name,rows.map((r)=>({...r,invocation_key:f.id})),f.input.type_overrides?.[name])).join('\n');}
function query(f){return sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>`-- BEGIN REPLACEABLE INPUTS\n${inputs(f)}\n-- END REPLACEABLE INPUTS`);}
if(flags.includes('--write-example')){sql=query(cases[0]);await writeFile(sqlFile,sql);}
// Definitions only: this does not compute attribution or execute SQL.
assert.equal(cases.length,19);assert.equal(additionalChecks.length,2);assert.equal(failureCases.length,24);
assert.equal(new Set([...cases,...additionalChecks,...failureCases].map((f)=>f.id)).size,45);
for(const f of [...cases,...additionalChecks]){
 assert.ok(f.expectedDerivation);assert.ok(Array.isArray(f.expected.ledger));assert.ok(Array.isArray(f.expected.coverage));
 assert.equal(f.expected.diagnostics.invocation_key,f.id);
 assert.equal(f.expected.coverage.length%5,0);
 const groups=new Map();
 for(const row of f.expected.ledger){const key=JSON.stringify([row.source_system,row.source_scope,row.conversion_key,row.model]);groups.set(key,(groups.get(key)??0)+row.credit);}
 for(const total of groups.values())assert.ok(Math.abs(total-1)<=1e-12,`${f.id}: stored golden conservation`);
}
for(const [i,f] of cases.slice(0,3).entries())assert.equal(f.expected.ledger.length,[5,10,20][i]);
for(const f of failureCases)assert.equal(typeof f.expectedError,'string');
assert.ok(!/LANGUAGE\s+js/i.test(sql));
const selectedIds=option('--cases')?.split(',');
const selected=(f)=>!selectedIds||selectedIds.includes(f.id);
if(selectedIds)for(const id of selectedIds)assert.ok([...cases,...additionalChecks,...failureCases].some((f)=>f.id===id),`unknown --cases id: ${id}`);
const successSelection=cases.filter(selected),additionalSelection=additionalChecks.filter(selected),failureSelection=failureCases.filter(selected);
function compare(actual,expected,path='result'){
 if(path.endsWith('.credit')||path.endsWith('.total_credit')){
  assert.equal(typeof actual,'number',path);assert.ok(Number.isFinite(actual)&&actual>=0,path);
  assert.ok(Math.abs(actual-expected)<=1e-12,`${path}: ${actual} != ${expected}`);return;
 }
 if(Array.isArray(expected)){assert.ok(Array.isArray(actual),path);assert.equal(actual.length,expected.length,path);expected.forEach((v,i)=>compare(actual[i],v,`${path}[${i}]`));return;}
 if(expected!==null&&typeof expected==='object'){
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),`${path} fields`);
  for(const [key,value]of Object.entries(expected))compare(actual[key],value,`${path}.${key}`);return;
 }
 assert.deepEqual(actual,expected,path);
}
if(!flags.includes('--live'))console.log('Validated 19 full literal fixture definitions, 2 additional full-output checks, and 24 invalid fixture definitions. NO SQL executed. Use --live --project YOUR_BILLING_PROJECT.');
else{
 const project=option('--project');assert.ok(project&&!project.startsWith('--'),'--live requires --project');
 const location=option('--location','US'),now=new Date().toISOString();
 const reportPath=option('--report',join(homedir(),'Downloads',`mta-ledger-full-bigquery-evidence-${now.replaceAll(/[^0-9]/g,'').slice(0,14)}.json`));
 let report={startedAt:now,status:'running',project,location,sqlSha256:hash(sql),fixtureSha256:hash(fixtureText),nodeVersion:process.version,runnerSha256:hash(await readFile(new URL(import.meta.url),'utf8')),maximumBytesBilledPerJob:1073741824,jobs:[],selectedCaseIds:selectedIds??null,comparisonRechecks:[]};
 const resumePath=option('--resume-report');
 if(resumePath){
  const old=JSON.parse(await readFile(resumePath,'utf8'));assert.equal(old.project,project);assert.equal(old.location,location);assert.notEqual(resumePath,reportPath);
  if(old.fixtureSha256!==report.fixtureSha256){
   assert.ok(flags.includes('--recheck-goldens'),'changed fixture definitions require --recheck-goldens');
   assert.ok(option('--fixture-change-note')&&!option('--fixture-change-note').startsWith('--'),'changed fixture definitions require --fixture-change-note');
   report.fixtureChange={previousSha256:old.fixtureSha256,currentSha256:report.fixtureSha256,note:option('--fixture-change-note'),explicitComparisonRecheck:true};
  }
  // Reuse only byte-identical completed queries; changed SQL is submitted afresh per job.
  report={...report,jobs:old.jobs,resumedFrom:resumePath,previousFixtureSha256:old.fixtureSha256,previousSqlSha256:old.sqlSha256};
 }
 let saveQueue=Promise.resolve();
 async function save(){const snapshot=JSON.stringify(report,null,2)+'\n';saveQueue=saveQueue.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,snapshot);});await saveQueue;}
 async function command(args,input=''){return new Promise((resolve,reject)=>{const p=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',(s)=>stdout+=s);p.stderr.on('data',(s)=>stderr+=s);p.on('error',reject);p.on('close',(code)=>resolve({code,stdout,stderr}));p.stdin.end(input);});}
 function rows(output){const parsed=JSON.parse(output);return Array.isArray(parsed.at(-1))?parsed.at(-1):parsed;}
 async function run(label,statement,expectedError=null){
  const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
  const prior=report.jobs.find((j)=>j.label===label&&j.sqlSha256===hash(statement)&&j.state==='DONE'&&((!expectedError&&j.actualError===null)||(expectedError&&j.expectedError===expectedError&&j.verification==='passed')));
  if(prior){
   if(expectedError){console.log(`PASS retained native assertion ${label}`);return {record:prior};}
   const read=await command([...common,'head','--job','--max_rows=10000',prior.jobId]);assert.equal(read.code,0,read.stderr);
   prior.readOnlyRechecks=[...(prior.readOnlyRechecks??[]),{at:new Date().toISOString(),...read}];await save();return {record:prior,rows:rows(read.stdout)};
  }
  const jobId=`mta_full_${label.replaceAll(/[^a-zA-Z0-9_]/g,'_')}_${randomUUID().replaceAll('-','')}`;
  console.log(`SUBMIT ${label} ${jobId}`);
  const result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${jobId}`,'--max_rows=10000'],statement);
  const shown=await command([...common,'show','--job',jobId]);const detail=shown.code===0?JSON.parse(shown.stdout):null;
  const record={label,jobId,jobReference:detail?.jobReference??null,state:detail?.status?.state??null,expectedError,actualError:detail?.status?.errorResult??null,sqlSha256:hash(statement),fixtureSha256:hash(fixtureText),verification:result.code!==0&&!expectedError?'failed':'pending',totalBytesProcessed:detail?.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:detail?.statistics?.query?.totalBytesBilled??null,totalSlotMs:detail?.statistics?.totalSlotMs??null,useLegacySql:detail?.configuration?.query?.useLegacySql??null,configuredMaximumBytesBilled:detail?.configuration?.query?.maximumBytesBilled??null,result,jobMetadata:detail,metadataRead:shown};
  report.jobs.push(record);await save();assert.equal(shown.code,0,shown.stderr);assert.equal(record.state,'DONE');assert.equal(record.useLegacySql,false);assert.equal(String(record.configuredMaximumBytesBilled),'1073741824');
  if(expectedError){assert.notEqual(result.code,0,`${label} unexpectedly succeeded`);assert.ok(record.actualError?.message?.includes(expectedError),JSON.stringify(record.actualError));record.verification='passed';await save();console.log(`PASS expected native assertion ${label}`);return {record};}
  assert.equal(result.code,0,`${result.stdout}\n${result.stderr}`);assert.equal(record.actualError,null);return {record,rows:rows(result.stdout)};
 }
 async function verify(label,statement,f){const result=await run(label,statement);assert.equal(result.rows.length,1);assert.equal(result.rows[0].invocation_key,f.id);const actual=JSON.parse(result.rows[0].result_json);compare(actual,f.expected,f.id);result.record.verification='passed';result.record.expectedOutputSha256=hash(JSON.stringify(f.expected));report.comparisonRechecks.push({label,jobId:result.record.jobId,fixtureSha256:hash(fixtureText),expectedOutputSha256:result.record.expectedOutputSha256,at:new Date().toISOString(),status:'passed'});result.record.comparedLedgerRows=actual.ledger.length;result.record.comparedCoverageRows=actual.coverage.length;result.record.comparedDiagnosticsRows=1;await save();console.log(`PASS full golden ${label}: ${actual.ledger.length} ledger / ${actual.coverage.length} coverage / 1 diagnostics`);}
 async function bounded(tasks){for(let i=0;i<tasks.length;i+=3){const results=await Promise.allSettled(tasks.slice(i,i+3).map((task)=>task()));for(const result of results)if(result.status==='rejected')throw result.reason;}}
 const productionGuards=sql.slice(sql.indexOf('ASSERT NOT EXISTS (SELECT 1 FROM ledger WHERE credit'),sql.indexOf('CREATE TEMP TABLE coverage AS'));
 function mutationQuery(value){return `CREATE TEMP TABLE ledger AS SELECT 'synthetic' source_system, 'test' source_scope, 'conversion' conversion_key, 'linear' model, CAST(1 AS FLOAT64) credit;\nUPDATE ledger SET credit=${value} WHERE TRUE;\n${productionGuards}`;}
 try{
  report.bqVersion=await command(['version']);await save();
  if(!selectedIds)await verify('standalone_example',sql,cases[0]);
  await bounded([...successSelection,...additionalSelection].map((f)=>()=>verify(f.id,query(f),f)));
  await bounded(failureSelection.map((f)=>()=>run(f.id,query(f),f.expectedError)));
  if(!selectedIds){
   const invalid=structuredClone(cases[0]);invalid.input.configuration.half_life_days=0;
   const assertionChecks=[
    ['missing_configuration',sql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=>table('invocation_input',[])),'exactly one invocation configuration is required'],
    ['duplicate_configuration',sql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=>table('invocation_input',[1,2].map(()=>({...cases[0].input.configuration,invocation_key:cases[0].id})))),'exactly one invocation configuration is required'],
    ['invalid_half_life',query(invalid),'invalid ledger configuration'],
    ['injected_credit_conservation',sql.replace('-- TEST CREDIT MUTATION POINT:',"UPDATE ledger SET credit=credit+0.25 WHERE model='linear';\n-- TEST CREDIT MUTATION POINT:"),'credit conservation failed'],
    ['injected_credit_null',mutationQuery('CAST(NULL AS FLOAT64)'),'invalid credit value'],
    ['injected_credit_negative',mutationQuery('CAST(-1 AS FLOAT64)'),'invalid credit value'],
    ['injected_credit_nan',mutationQuery("CAST('NaN' AS FLOAT64)"),'invalid credit value'],
    ['injected_credit_infinity',mutationQuery("CAST('Infinity' AS FLOAT64)"),'invalid credit value']
   ];
   report.productionCreditGuardSha256=hash(productionGuards);
   await bounded(assertionChecks.map(([label,statement,error])=>()=>run(label,statement,error)));
   report.productionAssertionCases=assertionChecks.length;
  }
  report.status='passed';report.completedAt=new Date().toISOString();
  report.successfulFixtures=successSelection.length;report.additionalFullOutputChecks=additionalSelection.length;
  report.comparedFixtureLedgerRows=successSelection.reduce((n,f)=>n+f.expected.ledger.length,0);
  report.comparedFixtureCoverageRows=successSelection.reduce((n,f)=>n+f.expected.coverage.length,0);
  report.comparedFixtureDiagnosticsRows=successSelection.length;
  report.comparedAdditionalLedgerRows=additionalSelection.reduce((n,f)=>n+f.expected.ledger.length,0);
  report.comparedAdditionalCoverageRows=additionalSelection.reduce((n,f)=>n+f.expected.coverage.length,0);
  report.comparedAdditionalDiagnosticsRows=additionalSelection.length;
  report.invalidFixtureCases=failureSelection.length;report.totalExpectedNativeFailures=failureSelection.length+(report.productionAssertionCases??0);
  report.scope=selectedIds?'selected_cases_only':'complete_ledger_fixture_suite';await save();
  console.log(`PASS native ledger ${report.scope}; ${reportPath}`);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

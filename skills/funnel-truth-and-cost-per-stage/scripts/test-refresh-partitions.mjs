import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const sqlFile=new URL('../references/sql/refresh_partitions.sql',import.meta.url);
const fixtureFile=new URL('../references/refresh-fixtures.json',import.meta.url);
let sql=await readFile(sqlFile,'utf8');const fixtureText=await readFile(fixtureFile,'utf8');const {cases}=JSON.parse(fixtureText);
const hash=(x)=>createHash('sha256').update(x).digest('hex');
const quote=(x)=>`'${String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n')}'`;
const identity={source_system:'STRING',source_scope:'STRING',lead_key:'STRING'};
const meta=Object.fromEntries(['channel','taxonomy_version','network_id','campaign_key','ad_source_system','ad_source_scope','ad_key'].map((k)=>[k,'STRING']));
const ledgerSchema={...identity,stage_key:'STRING',stage_order:'INT64',stage_kind:'STRING',achieved:'BOOL',cohort_at:'TIMESTAMP',stage_entered_at:'TIMESTAMP',cohort_date:'DATE',activity_date:'DATE',is_attribution_primary:'BOOL',value:'NUMERIC',currency:'STRING',value_status:'STRING',evidence_keys:[{source_system:'STRING',source_scope:'STRING',record_kind:'STRING',record_key:'STRING'}],stage_truth_status:'STRING',attribution:meta};
const schemas={invocation_input:{source_system:'STRING',source_scope:'STRING',report_timezone:'STRING',prior_report_timezone:'STRING',prior_watermark:'TIMESTAMP',as_of:'TIMESTAMP',overlap_days:'INT64',change_feed_complete:'BOOL',prior_snapshot_complete:'BOOL',current_snapshot_complete:'BOOL'},prior_ledger_input:ledgerSchema,current_ledger_input:ledgerSchema,change_input:{...identity,change_key:'STRING',changed_at:'TIMESTAMP',reason:'STRING'}};
function typeName(t){return Array.isArray(t)?`ARRAY<${typeName(t[0])}>`:typeof t==='object'?`STRUCT<${Object.entries(t).map(([k,v])=>`${k} ${typeName(v)}`).join(',')}>`:t;}
function literal(v,t){if(v==null)return `CAST(NULL AS ${typeName(t)})`;if(Array.isArray(t))return v.length?`[${v.map((x)=>literal(x,t[0])).join(',')}]`:`${typeName(t)}[]`;if(typeof t==='object')return `STRUCT(${Object.entries(t).map(([k,x])=>`${literal(v[k],x)} AS ${k}`).join(',')})`;if(t==='BOOL'&&typeof v==='boolean')return v?'TRUE':'FALSE';return `CAST(${quote(v)} AS ${t})`;}
function renderTable(name,rows,schema=schemas[name]){const fields={invocation_key:'STRING',...schema};const select=(r)=>`SELECT ${Object.entries(fields).map(([k,t])=>`${literal(r[k],t)} AS ${k}`).join(', ')}`;return `CREATE TEMP TABLE ${name} AS\n${rows.length?rows.map(select).join('\nUNION ALL\n'):`${select({})} FROM UNNEST(ARRAY<INT64>[])`};`;}
function inputsFor(fixtures){const tables=Object.fromEntries(Object.keys(schemas).map((k)=>[k,[]]));for(const f of fixtures){for(const c of f.input.configuration_rows??[f.input.configuration])tables.invocation_input.push({...c,invocation_key:f.id});for(const t of ['prior_ledger_input','current_ledger_input','change_input'])for(const r of f.input[t])tables[t].push({...r,invocation_key:f.id});}return Object.entries(tables).map(([t,r])=>renderTable(t,r)).join('\n');}
function fixtureQuery(fixtures,source=sql){return source.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>inputsFor(fixtures)).replace(/-- BEGIN INVOCATION CARDINALITY CHECK[\s\S]*?-- END INVOCATION CARDINALITY CHECK/,'-- Independent synthetic fixture namespaces only.');}
const flags=process.argv.slice(2);const option=(key,fallback)=>{const i=flags.indexOf(key);return i<0?fallback:flags[i+1];};
if(flags.includes('--write-example')){sql=sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>`-- BEGIN REPLACEABLE INPUTS\n${inputsFor([cases[0]])}\n-- END REPLACEABLE INPUTS`);await writeFile(sqlFile,sql);}
const successes=cases.filter((f)=>f.expected!==undefined),failures=cases.filter((f)=>f.expectedError!==undefined);
assert.equal(new Set(cases.map((f)=>f.id)).size,cases.length);assert.equal(successes.length+failures.length,cases.length);assert.ok(!/LANGUAGE\s+js/i.test(sql));
for(const f of successes)for(const k of ['target_partitions','replacement_ledger','changed_leads','different_leads','uncovered_leads','change_evidence'])assert.ok(Array.isArray(f.expected[k]),`${f.id}.${k}`);
const canonical=(x)=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map((k)=>[k,canonical(x[k])])):x;
function normalizeLedger(row){const r=structuredClone(row);r.evidence_keys.sort((a,b)=>JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));return r;}
const serialize=(r)=>JSON.stringify(canonical(r));
function expand(rows,timeZone){const unique=new Map(rows.map((r)=>{const normalized=normalizeLedger(r);return [serialize(normalized),normalized];}));const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});return [...unique.values()].flatMap((ledger)=>['cohort','activity'].map((date_mode)=>{const stamp=ledger[date_mode==='cohort'?'cohort_at':'stage_entered_at'];return {date_mode,report_date:stamp===null?null:formatter.format(new Date(stamp)),ledger};}));}
function applySimulation(actual,fixture,replacements=actual.replacement_ledger){
 const key=(r)=>serialize([r.ledger?.source_system??r.source_system,r.ledger?.source_scope??r.source_scope,r.date_mode,r.report_date]);
 const targets=new Set(actual.target_partitions.map(key));
 const prior=expand(fixture.input.prior_ledger_input,fixture.input.configuration.prior_report_timezone);
 const current=expand(fixture.input.current_ledger_input,fixture.input.configuration.report_timezone);
 const applied=prior.filter((r)=>!targets.has(key(r))).concat(replacements.map((r)=>({...r,ledger:normalizeLedger(r.ledger)})));
 assert.deepEqual(applied.map(serialize).sort(),current.map(serialize).sort(),'atomic target deletion + full replacement must equal complete current snapshot for both date modes');
 assert.equal(new Set(actual.target_partitions.map(key)).size,actual.target_partitions.length,'unique NULL-safe target partitions');
}
if(!flags.includes('--live'))console.log(`Validated ${cases.length} fixture definitions. Native SQL was not executed. Use --live --project YOUR_BILLING_PROJECT (optionally --integration).`);
else {
 const project=option('--project');if(!project||project.startsWith('--')) throw new TypeError('--live requires --project');
 const location=option('--location','US'),now=new Date().toISOString();
 const reportPath=option('--report',join(homedir(),'Downloads',`funnel-refresh-partitions-bigquery-evidence-${now.replaceAll(/[^0-9]/g,'').slice(0,14)}.json`));
 let report={startedAt:now,status:'running',project,location,sqlSha256:hash(sql),fixtureSha256:hash(fixtureText),maximumBytesBilledPerJob:1073741824,jobs:[]};
 const resumePath=option('--resume-report');
 if(resumePath){
  const old=JSON.parse(await readFile(resumePath,'utf8'));assert.equal(old.sqlSha256,report.sqlSha256);assert.equal(old.project,project);assert.equal(old.location,location);assert.notEqual(resumePath,reportPath);
  let goldenCorrection=null;
  if(flags.includes('--recheck-goldens')) {
   const completed=old.jobs.find((j)=>j.label==='all_successful_fixtures'&&j.state==='DONE'&&j.actualError===null);
   assert.ok(completed,'completed successful SQL required for read-only golden correction');
   assert.equal(completed.sqlSha256,hash(fixtureQuery(successes)),'fixture input SQL must remain byte-exact');
   goldenCorrection={previousFixtureSha256:old.fixtureSha256,currentFixtureSha256:report.fixtureSha256,unchangedSuccessfulQuerySha256:completed.sqlSha256,note:option('--golden-correction-note','Expected output correction only; SQL and successful fixture inputs remain byte-exact.')};
  } else assert.equal(old.fixtureSha256,report.fixtureSha256);
  report={...old,fixtureSha256:report.fixtureSha256,resumedFrom:resumePath,resumedAt:now,previousFailure:old.failure??null,failure:null,status:'running',goldenCorrection};
 }
 const deltaPath=option('--overlap-delta-report');let deltaPrior=null;
 if(deltaPath){
  assert.ok(!resumePath,'choose overlap delta or ordinary resume');
  deltaPrior=JSON.parse(await readFile(deltaPath,'utf8'));assert.equal(deltaPrior.status,'passed');assert.equal(deltaPrior.project,project);assert.equal(deltaPrior.location,location);
  const priorSql=await readFile(option('--prior-sql'),'utf8'),priorFixtureText=await readFile(option('--prior-fixtures'),'utf8');
  assert.equal(hash(priorSql),deltaPrior.sqlSha256);assert.equal(hash(priorFixtureText),deltaPrior.fixtureSha256);
  const priorCases=JSON.parse(priorFixtureText).cases;
  for(const f of priorCases)assert.deepEqual(cases.find((c)=>c.id===f.id),f,'existing fixture definitions must remain unchanged');
  const oldPrefix=priorSql.split('CREATE TEMP TABLE change_evidence AS')[0],newPrefix=sql.split('-- BEGIN SATURATED OVERLAP')[0];
  assert.equal(oldPrefix,newPrefix,'all structural validation must remain byte-exact before the new bounded calculation');
  const preserved=[];
  function preserve(label,query,error){const job=deltaPrior.jobs.find((j)=>j.label===label&&j.sqlSha256===hash(query)&&j.verification==='passed');assert.ok(job,`missing prior failure proof ${label}`);assert.equal(job.expectedError,error);assert.ok(job.actualError?.message?.includes(error));preserved.push(job);}
  for(const f of priorCases.filter((f)=>f.expectedError&&f.id!=='overlap-must-be-positive')){
   const oldQuery=fixtureQuery([f],priorSql),newQuery=fixtureQuery([f]);
   assert.equal(oldQuery.split('CREATE TEMP TABLE change_evidence AS')[0],newQuery.split('-- BEGIN SATURATED OVERLAP')[0]);preserve(f.id,oldQuery,f.expectedError);
  }
  preserve('production_missing_configuration',priorSql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=>renderTable('invocation_input',[])),'exactly one invocation configuration is required');
  preserve('production_duplicate_configuration',priorSql.replace(/CREATE TEMP TABLE invocation_input AS([\s\S]*?);/,'CREATE TEMP TABLE invocation_input AS SELECT * FROM ($1) UNION ALL SELECT * FROM ($1);'),'exactly one invocation configuration is required');
  report.priorValidationEvidence={reportPath:deltaPath,priorSqlSha256:deltaPrior.sqlSha256,unchangedValidationPrefixSha256:hash(oldPrefix),preservedFailureJobs:preserved};
  report.preservedIntegrationStageEvidence=[];
 }
 let saveQueue=Promise.resolve();
 async function save(){const snapshot=JSON.stringify(report,null,2)+'\n';saveQueue=saveQueue.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,snapshot);});await saveQueue;}
 async function command(args,input=''){return new Promise((resolve,reject)=>{const child=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',(x)=>stdout+=x);child.stderr.on('data',(x)=>stderr+=x);child.on('error',reject);child.on('close',(code)=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
 async function run(label,query,expectedError=null){
  const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
  const reusableStage=deltaPrior?.jobs.find((j)=>label.startsWith('integration_actual_stage_')&&j.label===label&&j.sqlSha256===hash(query)&&j.verification==='passed');
  const prior=report.jobs.find((j)=>j.label===label&&j.sqlSha256===hash(query)&&(j.verification==='passed'||(flags.includes('--recheck-goldens')&&!expectedError&&j.state==='DONE'&&j.actualError===null)));
  if((resumePath&&prior)||reusableStage){const preserved=prior??reusableStage;console.log(`PASS preserved evidence ${label}`);if(expectedError)return {record:preserved,rows:null};const read=await command([...common,'head','--job','--max_rows=10000',preserved.jobId]);assert.equal(read.code,0);if(reusableStage)report.preservedIntegrationStageEvidence.push({...preserved,readOnlyReverified:true});const parsed=JSON.parse(read.stdout);return {record:preserved,rows:Array.isArray(parsed.at(-1))?parsed.at(-1):parsed};}
  const jobId=`funnel_refresh_synthetic_${label.replaceAll(/[^a-zA-Z0-9_]/g,'_')}_${randomUUID().replaceAll('-','')}`;
  console.log(`SUBMIT ${label} ${jobId}`);
  const result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${jobId}`,'--max_rows=10000'],query);
  const shown=await command([...common,'show','--job',jobId]);const detail=shown.code===0?JSON.parse(shown.stdout):null;
  const record={label,jobId,jobReference:detail?.jobReference??null,state:detail?.status?.state??null,expectedError,actualError:detail?.status?.errorResult??null,totalBytesProcessed:detail?.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:detail?.statistics?.query?.totalBytesBilled??null,totalSlotMs:detail?.statistics?.totalSlotMs??null,configuredMaximumBytesBilled:detail?.configuration?.query?.maximumBytesBilled??null,useLegacySql:detail?.configuration?.query?.useLegacySql??null,sqlSha256:hash(query),verification:'pending'};
  report.jobs.push(record);await save();assert.equal(shown.code,0,shown.stderr);assert.equal(record.state,'DONE');assert.equal(record.useLegacySql,false);assert.equal(String(record.configuredMaximumBytesBilled),'1073741824');
  if(expectedError){assert.notEqual(result.code,0,`${label}: unexpectedly succeeded`);assert.ok(record.actualError?.message?.includes(expectedError),`${label}: wrong error ${JSON.stringify(record.actualError)}`);record.verification='passed';await save();console.log(`PASS SQL assertion ${label}`);return {record,rows:null};}
  assert.equal(result.code,0,`${label}: ${result.stdout}\n${result.stderr}`);assert.equal(record.actualError,null);const parsed=JSON.parse(result.stdout);return {record,rows:Array.isArray(parsed.at(-1))?parsed.at(-1):parsed};
 }
 async function verify(label,query,fixtures){const batch=await run(label,query);assert.equal(batch.rows.length,fixtures.length);let targets=0,replacements=0;for(const f of fixtures){const row=batch.rows.find((r)=>r.invocation_key===f.id);assert.ok(row);const actual=JSON.parse(row.result_json);assert.deepEqual(actual,f.expected,`${f.id}: full independent refresh golden`);applySimulation(actual,f);if(f.id==='late-won-rewrite-preserves-unaffected'){const changed=new Set(actual.changed_leads.map((r)=>r.lead_key));assert.throws(()=>applySimulation(actual,f,actual.replacement_ledger.filter((r)=>changed.has(r.ledger.lead_key))),/full replacement must equal/,'changed-lead-only mutation must fail the same application check');}targets+=actual.target_partitions.length;replacements+=actual.replacement_ledger.length;console.log(`PASS native full golden and application ${f.id}`);}batch.record.verification='passed';batch.record.fixtureCases=fixtures.length;batch.record.targetPartitions=targets;batch.record.replacementRows=replacements;await save();return {targets,replacements};}
 try{
  report.bqVersion=(await command(['version'])).stdout.trim();report.nodeVersion=process.version;await save();
  await verify('standalone_example',sql,[cases[0]]);
  const counts=await verify('all_successful_fixtures',fixtureQuery(successes),successes);report.successfulFixtureCases=successes.length;report.targetPartitions=counts.targets;report.replacementRows=counts.replacements;report.changedLeadOnlyMutationRejected=true;
  const activeFailures=deltaPrior?failures.filter((f)=>['overlap-must-be-positive','overlap-negative-invalid','overlap-fractional-invalid'].includes(f.id)):failures;
  if(deltaPrior)assert.equal(activeFailures.length+report.priorValidationEvidence.preservedFailureJobs.length,failures.length+2,'every failure case must run or have preserved native proof');
  for(let i=0;i<activeFailures.length;i+=3){const done=await Promise.allSettled(activeFailures.slice(i,i+3).map((f)=>run(f.id,fixtureQuery([f]),f.expectedError)));for(const r of done)if(r.status==='rejected')throw r.reason;}
  const missing=sql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=>renderTable('invocation_input',[]));
  const duplicate=sql.replace(/CREATE TEMP TABLE invocation_input AS([\s\S]*?);/,'CREATE TEMP TABLE invocation_input AS SELECT * FROM ($1) UNION ALL SELECT * FROM ($1);');
  if(!deltaPrior){await run('production_missing_configuration',missing,'exactly one invocation configuration is required');await run('production_duplicate_configuration',duplicate,'exactly one invocation configuration is required');}report.structuralFailureCases=failures.length+2;report.currentSqlStructuralFailureCases=activeFailures.length+(deltaPrior?0:2);
  if(flags.includes('--integration')){
   const stageSql=await readFile(new URL('../references/sql/stage_truth.sql',import.meta.url),'utf8');
   const config=cases[0].input.configuration;const leadMeta=Object.fromEntries(Object.keys(meta).map((k)=>[k,null]));
   const stageSchemas={invocation_input:{source_system:'STRING',source_scope:'STRING',report_timezone:'STRING',as_of:'TIMESTAMP',opportunities_complete:'BOOL'},lead_input:{...identity,created_at:'TIMESTAMP',status:'STRING',is_converted:'BOOL',converted_at:'TIMESTAMP',qualified_at:'TIMESTAMP',is_attribution_primary:'BOOL',...meta},stage_input:{stage_key:'STRING',stage_order:'FLOAT64',stage_kind:'STRING'},exclusion_input:{stage_key:'STRING',status:'STRING'},opportunity_input:{source_system:'STRING',source_scope:'STRING',opportunity_key:'STRING',lead_source_system:'STRING',lead_source_scope:'STRING',lead_key:'STRING',is_won:'BOOL',won_at:'TIMESTAMP',value:'NUMERIC',currency:'STRING',value_status:'STRING'},event_input:{source_system:'STRING',source_scope:'STRING',event_key:'STRING',lead_source_system:'STRING',lead_source_scope:'STRING',lead_key:'STRING',stage_key:'STRING',occurred_at:'TIMESTAMP'}};
   const results=[];for(const side of ['prior','current']){
    const id=`integration-stage-${side}`;
    const tables={invocation_input:[{source_system:config.source_system,source_scope:config.source_scope,report_timezone:config.report_timezone,as_of:side==='prior'?config.prior_watermark:config.as_of,opportunities_complete:true}],lead_input:['Changed','Unaffected'].map((lead_key)=>({source_system:config.source_system,source_scope:config.source_scope,lead_key,created_at:'2026-01-01T00:00:00Z',status:'accepted',is_converted:false,converted_at:null,qualified_at:null,is_attribution_primary:lead_key==='Changed',...leadMeta})),stage_input:[{stage_key:'lead',stage_order:0,stage_kind:'lead'},{stage_key:'won',stage_order:70,stage_kind:'won'}],exclusion_input:[],event_input:[],opportunity_input:['Changed','Unaffected'].map((lead_key)=>({source_system:'synthetic_opportunities',source_scope:'opportunity-a',opportunity_key:`Opportunity+${lead_key}`,lead_source_system:config.source_system,lead_source_scope:config.source_scope,lead_key,is_won:true,won_at:lead_key==='Changed'&&side==='current'?'2026-07-11T00:00:00Z':'2026-05-10T00:00:00Z',value:lead_key==='Changed'&&side==='current'?15:10,currency:'USD',value_status:'known'}))};
    const query=stageSql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>Object.entries(tables).map(([t,rows])=>renderTable(t,rows.map((r)=>({...r,invocation_key:id})),stageSchemas[t])).join('\n'));
    const stageRun=await run(`integration_actual_stage_${side}`,query);const result=JSON.parse(stageRun.rows[0].result_json);assert.equal(result.ledger.length,4);assert.ok(result.ledger.every((r)=>r.achieved));stageRun.record.verification='passed';await save();results.push(result.ledger);
   }
   const fixture={id:'actual-stage-refresh-integration',input:{configuration:config,prior_ledger_input:results[0],current_ledger_input:results[1],change_input:[{source_system:config.source_system,source_scope:config.source_scope,lead_key:'Changed',change_key:'Change+LateWin',changed_at:'2026-07-11T01:00:00Z',reason:'opportunity'}]}};
   const refreshed=await run('integration_actual_refresh',fixtureQuery([fixture]));const actual=JSON.parse(refreshed.rows[0].result_json);applySimulation(actual,fixture);assert.equal(actual.mode,'incremental');assert.equal(actual.target_partitions.length,4);assert.equal(actual.replacement_ledger.length,8);
   for(const date of ['2026-05-10','2026-07-11'])assert.ok(actual.target_partitions.some((t)=>t.date_mode==='activity'&&t.report_date===date),'old and new late-win activity partition');
   assert.ok(actual.replacement_ledger.some((r)=>r.date_mode==='activity'&&r.report_date==='2026-05-10'&&r.ledger.lead_key==='Unaffected'),'unaffected lead must refill old partition');
   assert.throws(()=>applySimulation(actual,fixture,actual.replacement_ledger.filter((r)=>r.ledger.lead_key==='Changed')),/full replacement must equal/);
   refreshed.record.verification='passed';report.integration={status:'passed',stageSqlSha256:hash(stageSql),priorStageRows:4,currentStageRows:4,targetPartitions:4,replacementRows:8,changedLeadOnlyMutationRejected:true};await save();
  }
  report.status='passed';report.completedAt=new Date().toISOString();await save();
  const doc=new URL('../references/refresh-contract.md',import.meta.url);const content=await readFile(doc,'utf8');
  const status=`<!-- execution-status:start -->\nAuthenticated native BigQuery checks passed on ${report.completedAt.slice(0,10)}: standalone SQL, ${successes.length} full golden fixtures (${report.targetPartitions} targets / ${report.replacementRows} replacement rows), ${report.currentSqlStructuralFailureCases} current-revision SQL failure checks${deltaPrior?` plus ${report.priorValidationEvidence.preservedFailureJobs.length} preserved failures with byte-exact validation-prefix proof`:''}. All successful fixtures passed full application equality against the current snapshot for both date modes; changed-lead-only replacement was rejected. ${report.integration?.status==='passed'?(deltaPrior?'The changed refresh SQL passed integration using read-only reverified outputs from both unchanged actual stage jobs.':'Actual native stage SQL ran twice and its late-rewrite refresh integration also passed.'):'Sibling integration was not requested in this run.'} Every job confirmed Standard SQL and a 1 GiB billed-bytes cap. Private IDs, hashes, versions, measured bytes, and any earlier failures remain in Downloads reports. This is synthetic correctness evidence, not a production scale benchmark.\n<!-- execution-status:end -->`;
  assert.ok(content.includes('<!-- execution-status:start -->'));await writeFile(doc,content.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/,status));
  console.log(`PASS ${successes.length} golden fixtures, ${failures.length+2} SQL assertions; ${reportPath}`);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

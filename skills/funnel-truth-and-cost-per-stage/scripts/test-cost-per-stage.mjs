import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const sqlFile = new URL('../references/sql/cost_per_stage.sql', import.meta.url);
const fixtureFile = new URL('../references/cost-fixtures.json', import.meta.url);
let sql = await readFile(sqlFile, 'utf8');
const fixtureText = await readFile(fixtureFile, 'utf8');
const { cases } = JSON.parse(fixtureText);
const hash = (x) => createHash('sha256').update(x).digest('hex');
const quote = (x) => `'${String(x).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
const meta = Object.fromEntries(['channel','taxonomy_version','network_id','campaign_key','ad_source_system','ad_source_scope','ad_key'].map((key) => [key,'STRING']));
const identity = { source_system:'STRING',source_scope:'STRING',lead_key:'STRING' };
const schemas = {
 invocation_input:{source_system:'STRING',source_scope:'STRING',report_timezone:'STRING',report_start:'DATE',report_end:'DATE',date_mode:'STRING',spend_complete:'BOOL'},
 stage_input:{stage_key:'STRING',stage_order:'FLOAT64',stage_kind:'STRING'},
 stage_ledger_input:{...identity,stage_key:'STRING',stage_order:'FLOAT64',stage_kind:'STRING',achieved:'BOOL',cohort_at:'TIMESTAMP',stage_entered_at:'TIMESTAMP',is_attribution_primary:'BOOL',value:'NUMERIC',currency:'STRING',value_status:'STRING',stage_truth_status:'STRING',attribution:meta},
 crm_attribution_input:{...identity,channel:'STRING',taxonomy_version:'STRING',quality_status:'STRING',network_id:'STRING',campaign_key:'STRING',ad_source_system:'STRING',ad_source_scope:'STRING',ad_key:'STRING',ad_match_status:'STRING',candidate_ads:[{source_system:'STRING',source_scope:'STRING',ad_key:'STRING',campaign_key:'STRING'}]},
 account_currency_input:{source_system:'STRING',source_scope:'STRING',network_id:'STRING',currency:'STRING'},
 campaign_input:{source_system:'STRING',source_scope:'STRING',network_id:'STRING',campaign_key:'STRING'},
 binding_input:{crm_source_system:'STRING',crm_source_scope:'STRING',ad_source_system:'STRING',ad_source_scope:'STRING',platform:'STRING',entity_type:'STRING'},
 spend_input:{source_system:'STRING',source_scope:'STRING',spend_key:'STRING',event_date:'DATE',channel:'STRING',taxonomy_version:'STRING',network_id:'STRING',campaign_key:'STRING',spend:'NUMERIC',currency:'STRING',spend_status:'STRING'}
};
function typeName(type) { return Array.isArray(type) ? `ARRAY<${typeName(type[0])}>` : typeof type === 'object' ? `STRUCT<${Object.entries(type).map(([k,t])=>`${k} ${typeName(t)}`).join(',')}>` : type; }
function literal(value,type) {
 if (value == null) return `CAST(NULL AS ${typeName(type)})`;
 if (Array.isArray(type)) return value.length ? `[${value.map((v)=>literal(v,type[0])).join(',')}]` : `${typeName(type)}[]`;
 if (typeof type === 'object') return `STRUCT(${Object.entries(type).map(([k,t])=>`${literal(value[k],t)} AS ${k}`).join(',')})`;
 if (type==='BOOL' && typeof value==='boolean') return value?'TRUE':'FALSE';
 return `CAST(${quote(value)} AS ${type})`;
}
function renderTable(name,rows,schema=schemas[name]) {
 const fields={invocation_key:'STRING',...schema};
 const select=(row)=>`SELECT ${Object.entries(fields).map(([k,t])=>`${literal(row[k],t)} AS ${k}`).join(', ')}`;
 return `CREATE TEMP TABLE ${name} AS\n${rows.length?rows.map(select).join('\nUNION ALL\n'):`${select({})} FROM UNNEST(ARRAY<INT64>[])`};`;
}
function inputsFor(fixtures) {
 const inputs=Object.fromEntries(Object.keys(schemas).map((k)=>[k,[]]));
 for (const f of fixtures) {
  for (const c of f.input.configuration_rows??[f.input.configuration]) inputs.invocation_input.push({...c,invocation_key:f.id});
  for (const table of Object.keys(schemas).filter((t)=>t!=='invocation_input')) for(const row of f.input[table]) inputs[table].push({...row,invocation_key:f.id});
 }
 return Object.entries(inputs).map(([name,rows])=>renderTable(name,rows)).join('\n');
}
function fixtureQuery(fixtures) {
 return sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>inputsFor(fixtures))
 .replace(/-- BEGIN INVOCATION CARDINALITY CHECK[\s\S]*?-- END INVOCATION CARDINALITY CHECK/,'-- Independent synthetic fixture namespaces only.');
}
const flags=process.argv.slice(2);
const option=(key,fallback)=>{const i=flags.indexOf(key);return i<0?fallback:flags[i+1];};
if(flags.includes('--write-example')) {
 sql=sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>`-- BEGIN REPLACEABLE INPUTS\n${inputsFor([cases[0]])}\n-- END REPLACEABLE INPUTS`);
 await writeFile(sqlFile,sql);
}
const successes=cases.filter((c)=>c.expected!==undefined),failures=cases.filter((c)=>c.expectedError!==undefined);
assert.equal(new Set(cases.map((c)=>c.id)).size,cases.length);
assert.equal(successes.length+failures.length,cases.length);
assert.ok(!/LANGUAGE\s+js/i.test(sql));
for(const f of successes) for(const key of ['report','lead_reconciliation','spend_evidence','stage_evidence']) assert.ok(Array.isArray(f.expected[key]),`${f.id}.${key}`);
function normalize(value) { // JSON object field order is irrelevant; stable array order is part of the contract.
 return value;
}
function conservation(result,fixture) {
 const uniqueLeads=new Set(fixture.input.stage_ledger_input.map((l)=>JSON.stringify([l.source_system,l.source_scope,l.lead_key])));
 assert.equal(result.lead_reconciliation.length,uniqueLeads.size,'no attribution-only phantom leads');
 for(const stage of new Set(fixture.input.stage_input.map((s)=>s.stage_key))) {
  const evidence=result.stage_evidence.filter((s)=>s.stage_key===stage);
  const included=evidence.filter((s)=>s.included), report=result.report.filter((s)=>s.stage_key===stage);
  assert.equal(report.reduce((n,r)=>n+r.lead_count,0),included.length,'stage lead population additivity');
  assert.equal(report.reduce((n,r)=>n+r.stage_count_total,0),included.filter((r)=>r.achieved===true).length,'all-lead attainment additivity');
  assert.equal(report.reduce((n,r)=>n+r.stage_count_primary,0),included.filter((r)=>r.achieved===true&&r.is_attribution_primary).length,'primary attainment additivity');
  assert.equal(evidence.length,uniqueLeads.size,'all configured stages retain all scoped leads before date exclusion');
  const spend=result.spend_evidence.filter((s)=>s.included);
  assert.equal(report.reduce((n,r)=>n+r.spend_fact_count,0),spend.length,'every observed spend fact once per configured stage');
  // Exact decimal comparison uses scaled integers, never floating-point money addition.
  const numeric=(x)=>{let [i,f='']=String(x).split('.');return BigInt(i+f.padEnd(9,'0'));};
  const known=spend.filter((s)=>s.spend_status==='known');
  const groups=new Map();
  for(const s of known) { const key=JSON.stringify([s.event_date,s.source_system,s.source_scope,s.channel,s.network_id,s.campaign_key]);const g=groups.get(key)??{amount:0n,currencies:new Set()};g.amount+=numeric(s.spend);g.currencies.add(s.currency);groups.set(key,g); }
  for(const [key,g] of groups) {
   const [date,system,scope,channel,network,campaign]=JSON.parse(key);
   const r=report.find((r)=>r.report_date===date&&r.ad_source_system===system&&r.ad_source_scope===scope&&r.channel===channel&&r.network_id===network&&r.campaign_key===campaign&&r.spend_fact_count>0);
   assert.ok(r,'spend group preserved independent of catalog/binding');
   if(r.observed_spend_status==='known') assert.equal(numeric(r.observed_spend),g.amount,'native exact observed-spend conservation');
   else assert.equal(r.observed_spend,null,'unknown/mixed aggregate remains unknown; native evidence retains amounts');
  }
 }
 assert.equal(result.stage_evidence.filter((r)=>!r.included).length,result.diagnostics.outside_range_stage_rows);
 assert.equal(result.spend_evidence.filter((r)=>!r.included).length,result.diagnostics.outside_range_spend_rows);
}
if(!flags.includes('--live')) console.log(`Validated ${cases.length} fixture definitions. No SQL executed; use --live --project YOUR_BILLING_PROJECT (add --integration for sibling integration).`);
else {
 const project=option('--project');if(!project||project.startsWith('--')) throw new TypeError('--live requires --project');
 const location=option('--location','US'),now=new Date().toISOString();
 const reportPath=option('--report',join(homedir(),'Downloads',`funnel-cost-per-stage-bigquery-evidence-${now.replaceAll(/[^0-9]/g,'').slice(0,14)}.json`));
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
 let saveQueue=Promise.resolve();
 async function save(){const snapshot=JSON.stringify(report,null,2)+'\n';saveQueue=saveQueue.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,snapshot);});await saveQueue;}
 async function command(args,input=''){return new Promise((resolve,reject)=>{const child=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',(x)=>stdout+=x);child.stderr.on('data',(x)=>stderr+=x);child.on('error',reject);child.on('close',(code)=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
 async function run(label,query,expectedError=null){
  const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
  const prior=report.jobs.find((j)=>j.label===label&&j.sqlSha256===hash(query)&&(j.verification==='passed'||(flags.includes('--recheck-goldens')&&!expectedError&&j.state==='DONE'&&j.actualError===null)));
  if(resumePath&&prior){console.log(`PASS preserved evidence ${label}`);if(expectedError)return {record:prior,rows:null};const read=await command([...common,'head','--job','--max_rows=10000',prior.jobId]);assert.equal(read.code,0);const parsed=JSON.parse(read.stdout);return {record:prior,rows:Array.isArray(parsed.at(-1))?parsed.at(-1):parsed};}
  const jobId=`funnel_cost_synthetic_${label.replaceAll(/[^a-zA-Z0-9_]/g,'_')}_${randomUUID().replaceAll('-','')}`;
  console.log(`SUBMIT ${label} ${jobId}`);
  const result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${jobId}`,'--max_rows=10000'],query);
  const shown=await command([...common,'show','--job',jobId]);const detail=shown.code===0?JSON.parse(shown.stdout):null;
  const record={label,jobId,jobReference:detail?.jobReference??null,state:detail?.status?.state??null,expectedError,actualError:detail?.status?.errorResult??null,totalBytesProcessed:detail?.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:detail?.statistics?.query?.totalBytesBilled??null,totalSlotMs:detail?.statistics?.totalSlotMs??null,configuredMaximumBytesBilled:detail?.configuration?.query?.maximumBytesBilled??null,useLegacySql:detail?.configuration?.query?.useLegacySql??null,sqlSha256:hash(query),verification:'pending'};
  report.jobs.push(record);await save();assert.equal(shown.code,0,shown.stderr);assert.equal(record.state,'DONE');assert.equal(record.useLegacySql,false);assert.equal(String(record.configuredMaximumBytesBilled),'1073741824');
  if(expectedError){assert.notEqual(result.code,0,`${label}: unexpectedly succeeded`);assert.ok(record.actualError?.message?.includes(expectedError),`${label}: wrong error ${JSON.stringify(record.actualError)}`);record.verification='passed';await save();console.log(`PASS SQL assertion ${label}`);return {record,rows:null};}
  assert.equal(result.code,0,`${label}: ${result.stdout}\n${result.stderr}`);assert.equal(record.actualError,null);const parsed=JSON.parse(result.stdout);return {record,rows:Array.isArray(parsed.at(-1))?parsed.at(-1):parsed};
 }
 async function verify(label,query,fixtures){const batch=await run(label,query);assert.equal(batch.rows.length,fixtures.length);let count=0;for(const f of fixtures){const found=batch.rows.find((r)=>r.invocation_key===f.id);assert.ok(found,`${f.id}: missing output`);const actual=JSON.parse(found.result_json);assert.deepEqual(normalize(actual),f.expected,`${f.id}: full report and evidence golden`);conservation(actual,f);count+=actual.report.length;console.log(`PASS native full golden ${f.id}`);}batch.record.verification='passed';batch.record.fixtureCases=fixtures.length;batch.record.reportRows=count;await save();return count;}
 try {
  report.bqVersion=(await command(['version'])).stdout.trim();await save();
  await verify('standalone_example',sql,[cases[0]]);
  report.comparedReportRows=await verify('all_successful_fixtures',fixtureQuery(successes),successes);
  report.successfulFixtureCases=successes.length;
  for(let i=0;i<failures.length;i+=3){const done=await Promise.allSettled(failures.slice(i,i+3).map((f)=>run(f.id,fixtureQuery([f]),f.expectedError)));for(const r of done)if(r.status==='rejected')throw r.reason;}
  const missing=sql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=>renderTable('invocation_input',[]));
  const duplicate=sql.replace(/CREATE TEMP TABLE invocation_input AS([\s\S]*?);/,'CREATE TEMP TABLE invocation_input AS SELECT * FROM ($1) UNION ALL SELECT * FROM ($1);');
  await run('production_missing_configuration',missing,'exactly one invocation configuration is required');
  await run('production_duplicate_configuration',duplicate,'exactly one invocation configuration is required');
  report.structuralFailureCases=failures.length+2;
  if(flags.includes('--integration')) {
   // This adapter calls sibling implementations; there is no copied stage engine or classifier.
   const {attributeLeads}=await import('../../crm-paid-attribution/scripts/attribute-leads.mjs');
   const crmFixture=JSON.parse(await readFile(new URL('../../crm-paid-attribution/references/fixtures.json',import.meta.url),'utf8')).cases.find((f)=>f.id==='qualified-catalog-campaign-output');
   const resolved=attributeLeads(crmFixture.input.leads,crmFixture.input.options);
   const source=resolved[0];assert.equal(source.campaign_key,'CatalogCampaign+Case');
   const stageSql=await readFile(new URL('../references/sql/stage_truth.sql',import.meta.url),'utf8');
   const stageFixture=JSON.parse(await readFile(new URL('../references/stage-fixtures.json',import.meta.url),'utf8')).cases.find((f)=>f.expected&&f.input.leads.length===1&&f.input.opportunities.length>=3);
   assert.ok(stageFixture,'existing stage opportunity fixture required');
   const integrationId='actual-crm-stage-cost-integration';
   const stageSchemas={invocation_input:{source_system:'STRING',source_scope:'STRING',report_timezone:'STRING',as_of:'TIMESTAMP',opportunities_complete:'BOOL'},lead_input:{...identity,created_at:'TIMESTAMP',status:'STRING',is_converted:'BOOL',converted_at:'TIMESTAMP',qualified_at:'TIMESTAMP',is_attribution_primary:'BOOL',...meta},stage_input:schemas.stage_input,exclusion_input:{stage_key:'STRING',status:'STRING'},opportunity_input:{source_system:'STRING',source_scope:'STRING',opportunity_key:'STRING',lead_source_system:'STRING',lead_source_scope:'STRING',lead_key:'STRING',is_won:'BOOL',won_at:'TIMESTAMP',value:'NUMERIC',currency:'STRING',value_status:'STRING'},event_input:{source_system:'STRING',source_scope:'STRING',event_key:'STRING',lead_source_system:'STRING',lead_source_scope:'STRING',lead_key:'STRING',stage_key:'STRING',occurred_at:'TIMESTAMP'}};
   const inp=structuredClone(stageFixture.input);inp.configuration={...inp.configuration,source_system:source.source_system,source_scope:source.source_scope};
   const lead=inp.leads[0];Object.assign(lead,source); // typed projection below excludes raw tracking/PII.
   for(const list of [inp.opportunities,inp.events])for(const row of list)Object.assign(row,{lead_source_system:source.source_system,lead_source_scope:source.source_scope,lead_key:source.lead_key});
   const names={invocation_input:'configuration',lead_input:'leads',stage_input:'stages',exclusion_input:'exclusions',opportunity_input:'opportunities',event_input:'events'};
   const stageInputs=Object.entries(names).map(([table,key])=>renderTable(table,(Array.isArray(inp[key])?inp[key]:[inp[key]]).map((r)=>({...r,invocation_key:integrationId})),stageSchemas[table])).join('\n');
   const stageQuery=stageSql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>stageInputs);
   const stageRun=await run('integration_actual_stage_truth',stageQuery);
   const stageResult=JSON.parse(stageRun.rows[0].result_json);assert.equal(stageResult.ledger.length,inp.stages.length);assert.ok(stageResult.ledger.some((r)=>r.stage_kind==='won'&&r.achieved));
   stageRun.record.verification='passed';await save();
   const integration={id:integrationId,input:{configuration:{source_system:source.source_system,source_scope:source.source_scope,report_timezone:inp.configuration.report_timezone,report_start:'2026-01-01',report_end:'2026-12-31',date_mode:'cohort',spend_complete:true},stage_input:inp.stages,stage_ledger_input:stageResult.ledger,account_currency_input:[],crm_attribution_input:resolved,campaign_input:[{source_system:source.ad_source_system,source_scope:source.ad_source_scope,network_id:source.network_id,campaign_key:source.campaign_key}],binding_input:[{crm_source_system:source.source_system,crm_source_scope:source.source_scope,ad_source_system:source.ad_source_system,ad_source_scope:source.ad_source_scope,platform:source.network_id,entity_type:'campaign'}],spend_input:[{source_system:source.ad_source_system,source_scope:source.ad_source_scope,spend_key:'integration-spend',event_date:stageResult.ledger[0].cohort_date,channel:source.channel,taxonomy_version:source.taxonomy_version,network_id:source.network_id,campaign_key:source.campaign_key,spend:'30',currency:'USD',spend_status:'known'}]}};
   const costRun=await run('integration_actual_cost',fixtureQuery([integration]));const actual=JSON.parse(costRun.rows[0].result_json);conservation(actual,integration);
   assert.equal(actual.lead_reconciliation[0].bucket,'matched');assert.equal(actual.lead_reconciliation[0].campaign_key,'CatalogCampaign+Case');
   for(const row of actual.report){const stage=stageResult.ledger.find((s)=>s.stage_key===row.stage_key);assert.equal(row.lead_count,1);assert.equal(row.stage_count_total,stage.achieved===true?1:0);assert.equal(row.stage_count_primary,stage.achieved===true&&source.is_attribution_primary?1:0);assert.equal(row.observed_spend,30);assert.equal(row.spend,30);assert.equal(row.revenue,stage.achieved===true?stage.value:null);assert.equal(row.cost_per_stage,row.stage_count_primary?30:null);}
   costRun.record.verification='passed';report.integration={status:'passed',crmFixtureId:crmFixture.id,stageFixtureId:stageFixture.id,stageSqlSha256:hash(stageSql),crmResolverSha256:hash(await readFile(new URL('../../crm-paid-attribution/scripts/attribute-leads.mjs',import.meta.url))),leadRows:resolved.length,stageRows:stageResult.ledger.length,reportRows:actual.report.length};await save();
  }
  report.status='passed';report.completedAt=new Date().toISOString();await save();
  const doc=new URL('../references/cost-contract.md',import.meta.url);const content=await readFile(doc,'utf8');
  const status=`<!-- execution-status:start -->\nAuthenticated native BigQuery checks passed on ${report.completedAt.slice(0,10)}: standalone SQL, ${successes.length} full golden fixtures (${report.comparedReportRows} report rows), ${failures.length} structural fixture failures, and two production configuration failures. ${report.integration?.status==='passed'?'The actual sibling CRM resolver → native stage ledger → native cost integration also passed.':'Sibling integration was not requested on this run.'} Every job confirmed Standard SQL and a 1 GiB billed-bytes cap. Private job IDs, project, hashes, versions, and measured bytes remain in Downloads evidence. These synthetic checks are correctness evidence, not a scale benchmark.\n<!-- execution-status:end -->`;
  assert.ok(content.includes('<!-- execution-status:start -->'));await writeFile(doc,content.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/,status));
  console.log(`PASS ${successes.length} successful fixtures, ${failures.length+2} SQL assertion cases; ${reportPath}`);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
const sqlFile=new URL('../references/sql/attribution_metrics.sql',import.meta.url),fixtureFile=new URL('../references/metrics-fixtures.json',import.meta.url);
let sql=await readFile(sqlFile,'utf8');const fixtureText=await readFile(fixtureFile,'utf8'),{cases,failure_cases:failures}=JSON.parse(fixtureText);
const upstreamSql=await readFile(new URL('../references/sql/credit_ledger.sql',import.meta.url),'utf8'),upstreamFixtureText=await readFile(new URL('../references/ledger-fixtures.json',import.meta.url),'utf8'),upstreamFixtures=JSON.parse(upstreamFixtureText);
const flags=process.argv.slice(2),opt=(key,fallback)=>flags.includes(key)?flags[flags.indexOf(key)+1]:fallback,hash=s=>createHash('sha256').update(s).digest('hex');
const key={source_system:'STRING',source_scope:'STRING'},money={value:'NUMERIC',currency:'STRING',value_status:'STRING'};
const schemas={configuration_input:{invocation_key:'STRING',report_scope:'STRING',report_timezone:'STRING',report_start_date:'DATE',report_end_date:'DATE',as_of:'TIMESTAMP',selected_model:'STRING',conversion_window_mode:'STRING',spend_complete:'BOOL',outcome_kind:'STRING',acquisition_history_complete:'BOOL'},conversion_scope_input:key,spend_scope_input:{...key,currency:'STRING'},ledger_input:{...key,conversion_key:'STRING',touch_source_system:'STRING',touch_source_scope:'STRING',touch_key:'STRING',conversion_at:'TIMESTAMP',conversion_date:'DATE',touch_at:'TIMESTAMP',channel:'STRING',taxonomy_version:'STRING',model:'STRING',credit:'FLOAT64',...money,conversion_window_mode:'STRING',report_timezone:'STRING',report_start_date:'DATE',report_end_date:'DATE',as_of:'TIMESTAMP'},coverage_input:{...key,conversion_key:'STRING',model:'STRING',conversion_at:'TIMESTAMP',conversion_date:'DATE',...money,conversion_window_mode:'STRING',eligible_touch_count:'INT64',total_credit:'FLOAT64',status:'STRING'},spend_input:{...key,spend_key:'STRING',event_date:'DATE',date_timezone:'STRING',channel:'STRING',taxonomy_version:'STRING',spend:'NUMERIC',currency:'STRING',spend_status:'STRING'}};
const quote=x=>`'${String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r')}'`;
function table(name,rows,schema=schemas[name]){const select=r=>'SELECT '+Object.entries(schema).map(([k,t])=>`CAST(${r[k]==null?'NULL':quote(r[k])} AS ${t}) AS ${k}`).join(', ');return `CREATE TEMP TABLE ${name} AS\n${rows.length?rows.map(select).join('\nUNION ALL\n'):select({})+' FROM UNNEST(ARRAY<INT64>[])'};`;}
function input(f){return [['configuration_input',[f.input.configuration]],['conversion_scope_input',f.input.conversion_scopes],['spend_scope_input',f.input.spend_scopes],['ledger_input',f.input.ledger],['coverage_input',f.input.coverage],['spend_input',f.input.spend]].map(([n,r])=>table(n,r)).join('\n');}
function upstreamQuery(f){
 const u=structuredClone(upstreamFixtures.cases.find(x=>x.id===f.upstream_fixture));assert.ok(u);
 if(f.upstream_extra_conversion)u.input.conversions.push(f.upstream_extra_conversion);
 const subject={subject_source_system:'STRING',subject_source_scope:'STRING',subject_key:'STRING'};
 const us={invocation_input:{invocation_key:'STRING',report_timezone:'STRING',report_start_date:'DATE',report_end_date:'DATE',as_of:'TIMESTAMP',requested_lookback_days:'INT64',min_lookback_days:'INT64',max_lookback_days:'INT64',half_life_days:'FLOAT64',conversion_window_mode:'STRING'},touch_input:{invocation_key:'STRING',...key,touch_key:'STRING',visitor_key:'STRING',occurred_at:'TIMESTAMP',channel:'STRING',taxonomy_version:'STRING',...subject},conversion_input:{invocation_key:'STRING',...key,conversion_key:'STRING',occurred_at:'TIMESTAMP',...subject,...money}};
 const text=[['invocation_input',[u.input.configuration]],['touch_input',u.input.touches],['conversion_input',u.input.conversions]].map(([n,rs])=>table(n,rs.map(r=>({...r,invocation_key:u.id})),us[n])).join('\n');
 return upstreamSql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>`-- BEGIN REPLACEABLE INPUTS\n${text}\n-- END REPLACEABLE INPUTS`);
}
function query(f){return sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/,()=>`-- BEGIN REPLACEABLE INPUTS\n${input(f)}\n-- END REPLACEABLE INPUTS`);}
if(flags.includes('--write-example')){sql=query(cases[0]);await writeFile(sqlFile,sql);}
for(const f of cases){assert.ok(f.expectedDerivation);for(const k of ['allocation_ledger','channel_metrics','uncredited_coverage'])assert.ok(Array.isArray(f.expected[k]));assert.equal(f.expected.diagnostics.invocation_key,f.id);}
assert.equal(new Set([...cases,...failures].map(f=>f.id)).size,cases.length+failures.length);assert.ok(!/LANGUAGE\s+js/i.test(sql));
function compare(a,e,p='result'){if(['credit','total_credit','credited_conversion_count'].includes(p.split('.').at(-1))&&typeof e==='number'){assert.equal(typeof a,'number',p);assert.ok(Number.isFinite(a)&&Math.abs(a-e)<=1e-12,`${p}: ${a} != ${e}`);return;}if(Array.isArray(e)){assert.ok(Array.isArray(a),p);assert.equal(a.length,e.length,p);e.forEach((v,i)=>compare(a[i],v,`${p}[${i}]`));return;}if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),p+' keys');for(const[k,v]of Object.entries(e))compare(a[k],v,p+'.'+k);return;}assert.deepEqual(a,e,p);}
const selected=opt('--cases')?.split(',');if(selected)for(const id of selected)assert.ok([...cases,...failures].some(f=>f.id===id),`unknown fixture ${id}`);
if(!flags.includes('--live')){console.log(`Validated ${cases.length} literal full-output fixtures and ${failures.length} invalid definitions. NO SQL EXECUTED.`);}else{
 const project=opt('--project');assert.ok(project&&!project.startsWith('--'));const location=opt('--location','US'),reportPath=opt('--report',join(homedir(),'Downloads',`mta-metrics-native-evidence-${new Date().toISOString().replaceAll(/[^0-9]/g,'').slice(0,14)}.json`));
 let report={startedAt:new Date().toISOString(),status:'running',project,location,sqlSha256:hash(sql),fixtureSha256:hash(fixtureText),runnerSha256:hash(await readFile(new URL(import.meta.url),'utf8')),upstreamSqlSha256:hash(upstreamSql),upstreamFixtureSha256:hash(upstreamFixtureText),nodeVersion:process.version,maximumBytesBilledPerJob:1073741824,selectedCaseIds:selected??null,jobs:[]};
 const resume=opt('--resume-report');if(resume){const old=JSON.parse(await readFile(resume,'utf8'));assert.equal(old.project,project);assert.equal(old.location,location);assert.notEqual(resume,reportPath);if(old.fixtureSha256!==report.fixtureSha256){assert.ok(flags.includes('--recheck-goldens')&&opt('--fixture-change-note'),'changed fixture requires explicit recheck note');report.fixtureChange={previousSha256:old.fixtureSha256,currentSha256:report.fixtureSha256,note:opt('--fixture-change-note')};}report.resumedFrom=resume;report.jobs=old.jobs;}
 let queue=Promise.resolve();async function save(){const text=JSON.stringify(report,null,2)+'\n';queue=queue.then(async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,text);});await queue;}
 async function command(args,input=''){return new Promise((resolve,reject)=>{const p=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',s=>stdout+=s);p.stderr.on('data',s=>stderr+=s);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input);});}
 const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
 function rows(s){const a=JSON.parse(s);return Array.isArray(a.at(-1))?a.at(-1):a;}
 async function run(label,statement,error,expected){
  let actual;let record=report.jobs.find(j=>j.label===label&&j.sqlSha256===hash(statement)&&j.verification==='passed'&&j.expectedError===(error??null));let result;
  if(record){if(error){console.log('PASS retained native failure '+label);return;}result=await command([...common,'head','--job','--max_rows=10000',record.jobId]);record.readOnlyRechecks=[...(record.readOnlyRechecks??[]),{at:new Date().toISOString(),...result}];assert.equal(result.code,0,result.stderr);}
  else{const jobId='mta_metrics_'+label.replaceAll(/[^a-zA-Z0-9_]/g,'_')+'_'+randomUUID().replaceAll('-','');console.log('SUBMIT '+label);result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${jobId}`,'--max_rows=10000'],statement);const shown=await command([...common,'show','--job',jobId]);const detail=shown.code===0?JSON.parse(shown.stdout):null;record={label,jobId,sqlSha256:hash(statement),fixtureSha256:hash(fixtureText),state:detail?.status?.state,expectedError:error??null,actualError:detail?.status?.errorResult??null,verification:'pending',totalBytesProcessed:detail?.statistics?.query?.totalBytesProcessed??null,totalBytesBilled:detail?.statistics?.query?.totalBytesBilled??null,result,jobMetadata:detail,metadataRead:shown};report.jobs.push(record);await save();assert.equal(shown.code,0,shown.stderr);assert.equal(record.state,'DONE');assert.equal(detail.configuration.query.useLegacySql,false);assert.equal(detail.configuration.query.useQueryCache,false);assert.equal(String(detail.configuration.query.maximumBytesBilled),'1073741824');}
  if(error){assert.notEqual(result.code,0,`${label} unexpectedly passed`);assert.ok(record.actualError?.message?.includes(error),JSON.stringify(record.actualError));}
  else{assert.equal(result.code,0,result.stdout+'\n'+result.stderr);const output=rows(result.stdout);assert.equal(output.length,1);actual=JSON.parse(output[0].result_json);compare(actual,expected,label);record.expectedOutputSha256=hash(JSON.stringify(expected));record.comparisonAt=new Date().toISOString();}
  record.verification='passed';await save();console.log(`PASS ${error?'expected native failure':'full golden'} ${label}`);return {actual,record};
 }
 async function verifyFixture(f){
  if(!f.upstream_fixture)return run(f.id,query(f),null,f.expected);
  // These input projections come exclusively from the actual native producer output.
  const producer=await run(f.id+'-upstream',upstreamQuery(f),null,f.upstream_expected_output);
  const downstream=structuredClone(f);
  for(const [kind,name] of [['ledger','ledger_input'],['coverage','coverage_input']])downstream.input[kind]=producer.actual[kind].map(row=>Object.fromEntries(Object.keys(schemas[name]).map(k=>[k,row[k]])));
  const statement=query(downstream);
  const link={fixtureId:f.id,upstreamJobId:producer.record.jobId,upstreamQuerySha256:producer.record.sqlSha256,upstreamOutputSha256:hash(JSON.stringify(producer.actual)),downstreamProjectionSha256:hash(JSON.stringify({ledger:downstream.input.ledger,coverage:downstream.input.coverage})),downstreamInputSha256:hash(input(downstream)),downstreamQuerySha256:hash(statement)};
  report.integrationLinks=[...(report.integrationLinks??[]),link];await save();
  const consumer=await run(f.id,statement,null,f.expected);link.downstreamJobId=consumer.record.jobId;link.status='passed';await save();return consumer;
 }
 async function batch(tasks){for(let i=0;i<tasks.length;i+=6){const rs=await Promise.allSettled(tasks.slice(i,i+6).map(f=>f()));for(const r of rs)if(r.status==='rejected')throw r.reason;}}
 try{report.bqVersion=await command(['version']);await save();const ok=cases.filter(f=>!selected||selected.includes(f.id)).sort((a,b)=>Number(Boolean(a.upstream_fixture))-Number(Boolean(b.upstream_fixture))),bad=failures.filter(f=>!selected||selected.includes(f.id));await batch(ok.map(f=>()=>verifyFixture(f)));await batch(bad.map(f=>()=>run(f.id,query(f),f.expectedError)));
 if(!selected){
  const reversed=structuredClone(cases.find(f=>f.id==='exact-duplicates'));
  for(const k of ['ledger','coverage','spend','conversion_scopes','spend_scopes'])reversed.input[k].reverse();
  await batch([
   ()=>run('standalone-example',sql,null,cases[0].expected),
   ()=>run('row-permutation',query(reversed),null,reversed.expected),
   ()=>run('mutation-conservation',query(cases[0]).replace('-- TEST ALLOCATION MUTATION POINT',"UPDATE allocations SET allocated_value=allocated_value+NUMERIC '0.000000001' WHERE touch_key='t1';\n-- TEST ALLOCATION MUTATION POINT"),'monetary conservation failed'),
   ()=>run('mutation-join-inflation',query(cases.find(f=>f.id==='spend-only-uncredited')).replace('-- TEST JOIN MUTATION POINT','INSERT INTO joined SELECT * FROM joined;\n-- TEST JOIN MUTATION POINT'),'metric join inflation')
  ]);
 }

 report.status='passed';report.completedAt=new Date().toISOString();report.scope=selected?'selected_cases_only':'complete_metrics_fixture_suite';report.successfulFixtures=ok.length;report.invalidFixtureCases=bad.length;report.additionalChecks=selected?0:4;report.additionalFullOutputChecks=selected?0:2;report.productionMutationChecks=selected?0:2;report.producerIntegrationJobs=ok.filter(f=>f.upstream_fixture).length;report.totalExpectedNativeFailures=bad.length+(selected?0:2);report.comparedFixtureAllocationRows=ok.reduce((n,f)=>n+f.expected.allocation_ledger.length,0);report.comparedFixtureMetricRows=ok.reduce((n,f)=>n+f.expected.channel_metrics.length,0);report.comparedFixtureUncreditedRows=ok.reduce((n,f)=>n+f.expected.uncredited_coverage.length,0);report.comparedFixtureDiagnosticsRows=ok.length;report.verifiedNativeJobs=report.jobs.filter(j=>j.verification==='passed').length;report.retainedSupersededJobs=report.jobs.filter(j=>j.verification!=='passed').length;await save();console.log(`PASS native metrics ${report.scope}; evidence saved in Downloads`);
 }catch(error){report.status='failed';report.failure=error.message;report.completedAt=new Date().toISOString();await save();throw error;}
}

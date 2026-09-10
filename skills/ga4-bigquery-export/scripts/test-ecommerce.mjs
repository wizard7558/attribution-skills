#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const sql=await readFile(join(root,'references/sql/ecommerce.sql'),'utf8'),fixtureText=await readFile(join(root,'references/ecommerce-fixtures.json'),'utf8'),fixture=JSON.parse(fixtureText);
const hash=x=>createHash('sha256').update(x).digest('hex');
const flags=process.argv.slice(2),valid=new Set(['--live','--project','--location','--report','--resume-report']);
for(let i=0;i<flags.length;i++){assert.ok(valid.has(flags[i]));if(flags[i]!=='--live')assert.ok(flags[++i]&&!flags[i].startsWith('--'));}
const opt=(k,f)=>flags.includes(k)?flags[flags.indexOf(k)+1]:f;
const quote=x=>"'"+String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r')+"'";
function compare(a,e,p='result'){
 if(['payload_json','accepted_payload_json','evidence_json'].includes(p.split('.').at(-1))&&e!==null){assert.equal(typeof a,'string',p);compare(JSON.parse(a),JSON.parse(e),p+'.decoded');return;}
 if(Array.isArray(e)){assert.ok(Array.isArray(a),p);assert.equal(a.length,e.length,p);e.forEach((v,i)=>compare(a[i],v,`${p}[${i}]`));return;}
 if(e&&typeof e==='object'){assert.ok(a&&typeof a==='object',p);assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),p);for(const k of Object.keys(e))compare(a[k],e[k],p+'.'+k);return;}
 const field=p.split('.').at(-1), floating=['known_subtotal','revenue_usd','tax_usd','shipping_usd','native_revenue'].includes(field)||(field==='value'&&!p.includes('.quantity.'));
 if(typeof e==='number'&&floating){assert.equal(typeof a,'number',p);assert.ok(Number.isFinite(a)&&Math.abs(a-e)<=Math.max(1,Math.abs(e))*1e-12,`${p}: ${a} != ${e}`);return;}
 assert.deepEqual(a,e,p);
}
function setup(events){return `CREATE TEMP TABLE synthetic_events AS
SELECT JSON_VALUE(e,'$.event_date') AS event_date,
 CAST(JSON_VALUE(e,'$.event_timestamp') AS INT64) AS event_timestamp,
 JSON_VALUE(e,'$.event_name') AS event_name, JSON_VALUE(e,'$.platform') AS platform,
 JSON_VALUE(e,'$.stream_id') AS stream_id, JSON_VALUE(e,'$.user_pseudo_id') AS user_pseudo_id,
 [STRUCT('currency' AS key, STRUCT(JSON_VALUE(e,'$.payload.currency') AS string_value) AS value)] AS event_params,
 STRUCT(JSON_VALUE(e,'$.transaction_id') AS transaction_id,
  CAST(JSON_VALUE(e,'$.payload.revenue_usd') AS FLOAT64) AS purchase_revenue_in_usd,
  CAST(JSON_VALUE(e,'$.payload.tax_usd') AS FLOAT64) AS tax_value_in_usd,
  CAST(JSON_VALUE(e,'$.payload.shipping_usd') AS FLOAT64) AS shipping_value_in_usd,
  CAST(JSON_VALUE(e,'$.payload.native_revenue') AS FLOAT64) AS purchase_revenue,
  CAST(JSON_VALUE(e,'$.payload.total_item_quantity') AS INT64) AS total_item_quantity,
  CAST(JSON_VALUE(e,'$.payload.unique_items') AS INT64) AS unique_items) AS ecommerce,
 ARRAY(SELECT AS STRUCT JSON_VALUE(i,'$.item_id') AS item_id, JSON_VALUE(i,'$.item_name') AS item_name,
  JSON_VALUE(i,'$.item_category') AS item_category, CAST(JSON_VALUE(i,'$.quantity') AS INT64) AS quantity,
  CAST(JSON_VALUE(i,'$.revenue_usd') AS FLOAT64) AS item_revenue_in_usd,
  CAST(JSON_VALUE(i,'$.native_revenue') AS FLOAT64) AS item_revenue
  FROM UNNEST(JSON_QUERY_ARRAY(e,'$.payload.items')) i WITH OFFSET o ORDER BY o) AS items
FROM UNNEST(JSON_QUERY_ARRAY(${quote(JSON.stringify(events))})) e;\n`;}
function query(template,events){return setup(events)+template.replace('`PROJECT.analytics_PROPERTY_ID.events_*`',()=>'(SELECT e.*, event_date AS _TABLE_SUFFIX FROM synthetic_events e)').replace("'YYYYMMDD' AND 'YYYYMMDD'",()=>`${quote(fixture.window.start)} AND ${quote(fixture.window.end)}`).replace("'YYYYMMDD' AS start_suffix, 'YYYYMMDD' AS end_suffix",()=>`${quote(fixture.window.start)} AS start_suffix, ${quote(fixture.window.end)} AS end_suffix`);}
assert.equal(fixture.cases.length,9);assert.equal(new Set(fixture.cases.map(c=>c.id)).size,9);
for(const c of fixture.cases){assert.ok(c.derivation);compare(c.expected,c.expected);const d=c.expected.diagnostics;assert.equal(d.observed_purchase_events,d.qualified_purchase_events+d.unkeyed_purchase_events);assert.equal(d.qualified_purchase_events,d.qualified_payload_variants+d.collapsed_duplicate_events);assert.equal(c.expected.qualified_transactions.length,d.qualified_transaction_count);assert.equal(c.expected.item_lines.length,d.item_line_count);assert.ok(!query(sql,c.events).includes('YYYYMMDD'));}
// Exercise the real comparator, including semantic data errors and exact count/type checks.
const expected=fixture.cases[0].expected;
for(const mutate of [x=>x.daily_summary[0].qualified_transaction_count=3,x=>x.item_lines.push(structuredClone(x.item_lines[0])),x=>x.qualified_transactions[0].money[0].amount.value=999,x=>x.diagnostics.observed_purchase_events=true]){const bad=structuredClone(expected);mutate(bad);assert.throws(()=>compare(bad,expected));}
const badUnknown=structuredClone(fixture.cases[1].expected);badUnknown.daily_summary[0].money[0].value=0;assert.throws(()=>compare(badUnknown,fixture.cases[1].expected));
const tiny=structuredClone(expected);tiny.daily_summary[0].money[0].known_subtotal+=1e-13;compare(tiny,expected);
assert.throws(()=>compare({value:Infinity},{value:1}));assert.throws(()=>compare({count:1.1},{count:1}));
const copy=await mkdtemp(join(tmpdir(),'ga4-ecommerce-'));
try{await cp(join(root,'references/sql/ecommerce.sql'),join(copy,'ecommerce.sql'));assert.equal(await readFile(join(copy,'ecommerce.sql'),'utf8'),sql);
 if(!flags.includes('--live'))console.log('PASS nine independent full-output fixture definitions, accounting identities, copied SQL and eight comparator checks. NO SQL EXECUTED.');else await live();
}finally{await rm(copy,{recursive:true,force:true});}
async function live(){
 const project=opt('--project');assert.ok(project);const location=opt('--location','US'),output=resolve(opt('--report',join(homedir(),'Downloads',`ga4-ecommerce-native-evidence-${new Date().toISOString().replaceAll(/[^0-9]/g,'').slice(0,14)}.json`)));
 const report={version:1,pid:process.pid,startedAt:new Date().toISOString(),status:'running',project,location,sqlSha256:hash(sql),fixtureSha256:hash(fixtureText),runnerSha256:hash(await readFile(fileURLToPath(import.meta.url))),nodeVersion:process.version,maximumBytesBilledPerJob:1073741824,useQueryCache:false,jobs:[]};
 const resume=opt('--resume-report');if(resume){assert.notEqual(resolve(resume),output);const old=JSON.parse(await readFile(resume,'utf8'));for(const k of ['project','location','sqlSha256','fixtureSha256','runnerSha256'])assert.equal(old[k],report[k],`resume ${k}`);report.resumedFrom=resume;report.jobs=structuredClone(old.jobs);}
 await assert.rejects(readFile(output),e=>e.code==='ENOENT');
 const save=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');};
 const command=(args,input='')=>new Promise((res,rej)=>{const p=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',rej);p.on('close',code=>res({code,stdout,stderr}));p.stdin.end(input);});
 const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
 async function run(label,statement,expected,mutant=false){let j=report.jobs.find(j=>j.label===label),result;
  if(j){assert.equal(j.querySha256,hash(statement));assert.equal(j.verification,'passed');const shown=await command([...common,'show','--job',j.jobId]);assert.equal(shown.code,0);const md=JSON.parse(shown.stdout);assert.equal(md.status.state,'DONE');assert.ok(!md.status.errorResult);assert.deepEqual(md.configuration.query,j.jobMetadata.configuration.query);result=await command([...common,'head','--job','--max_rows=10000',j.jobId]);j.readOnlyRechecks=[...(j.readOnlyRechecks??[]),{at:new Date().toISOString(),metadata:shown,result}];}
  else{j={label,jobId:'ga4_ecommerce_'+label.replaceAll('-','_')+'_'+randomUUID().replaceAll('-',''),query:statement,querySha256:hash(statement),inputSha256:hash(statement.slice(0,statement.indexOf('-- Standalone observed-export'))),submittedAt:new Date().toISOString(),verification:'pending',semanticMutant:mutant};report.jobs.push(j);await save();console.log(`SUBMIT ${label} ${j.jobId}`);result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${j.jobId}`,'--max_rows=10000'],statement);j.result=result;const shown=await command([...common,'show','--job',j.jobId]);j.metadataRead=shown;j.jobMetadata=shown.code===0?JSON.parse(shown.stdout):null;await save();assert.equal(shown.code,0);const md=j.jobMetadata;assert.equal(md.status.state,'DONE');assert.equal(md.configuration.query.useLegacySql,false);assert.equal(md.configuration.query.useQueryCache,false);assert.equal(String(md.configuration.query.maximumBytesBilled),'1073741824');assert.equal(md.configuration.query.query,statement);j.totalBytesProcessed=md.statistics.query?.totalBytesProcessed??null;j.totalBytesBilled=md.statistics.query?.totalBytesBilled??null;}
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);const p=JSON.parse(result.stdout);const rows=Array.isArray(p.at(-1))?p.at(-1):p;assert.equal(rows.length,1);const actual=JSON.parse(rows[0].result_json);j.rawRows=rows;j.parsedOutput=actual;await save();
  if(mutant){assert.throws(()=>compare(actual,expected));j.mutationDetected=true;}else compare(actual,expected);
  j.expectedSha256=hash(JSON.stringify(expected));j.verification='passed';await save();return actual;
 }
 try{report.bqVersion=await command(['version']);await save();for(const c of fixture.cases)await run(c.id,query(sql,c.events),c.expected);
  const first=fixture.cases[0];await run('copied-standalone',query(await readFile(join(copy,'ecommerce.sql'),'utf8'),first.events),first.expected);await run('event-permutation',query(sql,[...first.events].reverse()),first.expected);
  const badCount=sql.replace('-- TEST COUNT MUTATION POINT',`UPDATE daily_counts d SET qualified_transaction_count = (SELECT COUNT(DISTINCT transaction_id) FROM transactions t WHERE t.event_date=d.event_date) WHERE TRUE;\n-- TEST COUNT MUTATION POINT`);assert.notEqual(badCount,sql);await run('mutation-unqualified-count',query(badCount,first.events),first.expected,true);
  const badItems=sql.replace('-- TEST ITEM MUTATION POINT',`CREATE OR REPLACE TEMP TABLE item_lines AS SELECT i.* FROM item_lines i JOIN purchase_evidence p ON p.qualified AND i.source_system=p.source_system AND i.source_scope=p.source_scope AND i.platform=p.platform AND i.stream_id=p.stream_id AND i.user_pseudo_id=p.user_pseudo_id AND i.transaction_id=p.transaction_id;\n-- TEST ITEM MUTATION POINT`);assert.notEqual(badItems,sql);await run('mutation-raw-item-fanout',query(badItems,first.events),first.expected,true);
  report.status='passed';report.completedAt=new Date().toISOString();report.counts={fullFixtureGoldens:9,nativeJobs:13,copiedStandalone:1,eventPermutation:1,semanticMutants:2};await save();console.log('PASS nine full native goldens, copied standalone SQL, event permutation and two caught semantic mutants: 13 bounded native jobs.');
 }catch(e){report.status='failed';report.error=e.message;report.completedAt=new Date().toISOString();await save();throw e;}
}

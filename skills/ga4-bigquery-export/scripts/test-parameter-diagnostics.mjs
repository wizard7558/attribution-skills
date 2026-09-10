#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),hash=x=>createHash('sha256').update(x).digest('hex');
const fixtureText=await readFile(join(root,'references/parameter-diagnostic-fixtures.json'),'utf8'),f=JSON.parse(fixtureText),helper=await readFile(join(here,'parameter-helpers.sql'),'utf8');
const legacyText=await readFile(join(root,'references/integration-fixtures.json'),'utf8'),legacy=JSON.parse(legacyText);
const names=['sessions','channel_daily','landing_pages','traffic_source_compare','params','key_events','ui_reconciliation'],templates={};
for(const name of names){templates[name]=await readFile(join(root,`references/sql/${name}.sql`),'utf8');assert.equal(templates[name].match(/-- BEGIN GENERATED PARAMETER HELPERS\n([\s\S]*?)-- END GENERATED PARAMETER HELPERS/)[1],helper);}
const flags=process.argv.slice(2),valid=new Set(['--live','--project','--location','--report','--resume-report']);for(let i=0;i<flags.length;i++){assert.ok(valid.has(flags[i]));if(flags[i]!=='--live')assert.ok(flags[++i]&&!flags[i].startsWith('--'));}
const opt=(k,f)=>flags.includes(k)?flags[flags.indexOf(k)+1]:f;
const quote=x=>"'"+String(x).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r')+"'";
const floatFields=new Set(['engagement_time_msec','engagement_time_sec','event_value_in_usd','purchase_revenue_usd','pct_null_user','pct_crossing_midnight']);
const intFields=new Set(['ga_session_id','event_timestamp','events','key_events','sessions','engaged_sessions','new_users','purchase_events_without_transaction_id','purchases','ga_session_id_duplicate_count','page_location_duplicate_count','session_engaged_duplicate_count','engagement_time_msec_duplicate_count','observed_event_rows','total_events','null_user_pseudo_id_events','missing_session_id_events','total_sessions','sessions_crossing_midnight']);
function compare(a,e,p='result'){
 if(Array.isArray(e)){assert.ok(Array.isArray(a),p);assert.equal(a.length,e.length,p);e.forEach((v,i)=>compare(a[i],v,`${p}[${i}]`));return;}
 if(e&&typeof e==='object'){assert.ok(a&&typeof a==='object',p);assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),p);for(const k of Object.keys(e))compare(a[k],e[k],p+'.'+k);return;}
 const field=p.split('.').at(-1);
 if(typeof e==='number'&&(floatFields.has(field)||intFields.has(field))){assert.ok(typeof a==='number'||(typeof a==='string'&&a.trim()!==''),p);a=Number(a);assert.ok(Number.isFinite(a),p);if(intFields.has(field)){assert.ok(Number.isSafeInteger(a));assert.equal(a,e,p);}else assert.ok(Math.abs(a-e)<=Math.max(1,Math.abs(e))*1e-12,p);return;}
 if(typeof e==='boolean'&&field==='engaged'&&['true','false'].includes(a))a=a==='true';
 assert.deepEqual(a,e,p);
}
function projection(row,e){return Object.fromEntries(Object.keys(e).map(k=>[k,row[k]]));}
assert.equal(f.expected.params.inline_rows.length,6);assert.equal(f.expected.params.helper_rows.length,6);assert.equal(f.expected.sessions.length,4);
for(let i=0;i<6;i++)compare(projection(f.expected.params.helper_rows[i],f.expected.params.inline_rows[i]),f.expected.params.inline_rows[i]);
assert.equal(f.expected.sessions.filter(s=>s.session_key.startsWith('u.')).length,2);
for(const bad of [x=>x.helper_rows[0].page_location='https://example.test/forged',x=>x.helper_rows[2].ga_session_id=3,x=>x.helper_rows[0].engagement_time_msec=20000,x=>x.inline_rows.pop()]){const x=structuredClone(f.expected.params);bad(x);assert.throws(()=>compare(x,f.expected.params));}
assert.throws(()=>compare({event_value_in_usd:0},{event_value_in_usd:null}));assert.throws(()=>compare({events:true},{events:1}));
const temp=await mkdtemp(join(tmpdir(),'ga4-parameter-copy-'));
try{for(const name of names){await cp(join(root,`references/sql/${name}.sql`),join(temp,name+'.sql'));assert.equal(await readFile(join(temp,name+'.sql'),'utf8'),templates[name]);}
 if(!flags.includes('--live'))console.log('PASS seven identical helper blocks, full literal raw diagnostics, four qualified-session projections, inline/helper parity and six comparator checks. NO SQL EXECUTED.');else await live();
}finally{await rm(temp,{recursive:true,force:true});}
function setup(events){return `CREATE TEMP TABLE synthetic_events AS
SELECT JSON_VALUE(e,'$.event_date') AS event_date,
 CAST(JSON_VALUE(e,'$.timestamp') AS INT64) AS event_timestamp,
 JSON_VALUE(e,'$.event_name') AS event_name, JSON_VALUE(e,'$.user') AS user_pseudo_id,
 CAST(JSON_VALUE(e,'$.event_value_in_usd') AS FLOAT64) AS event_value_in_usd,
 ARRAY(SELECT AS STRUCT JSON_VALUE(p,'$.key') AS key,
  STRUCT(JSON_VALUE(p,'$.value.string_value') AS string_value,
    CAST(JSON_VALUE(p,'$.value.int_value') AS INT64) AS int_value,
    CAST(JSON_VALUE(p,'$.value.float_value') AS FLOAT64) AS float_value,
    CAST(JSON_VALUE(p,'$.value.double_value') AS FLOAT64) AS double_value) AS value
  FROM UNNEST(JSON_QUERY_ARRAY(e,'$.event_params')) p WITH OFFSET o ORDER BY o) AS event_params,
 STRUCT(JSON_VALUE(e,'$.gclid') AS gclid,JSON_VALUE(e,'$.dclid') AS dclid,JSON_VALUE(e,'$.srsltid') AS srsltid) AS collected_traffic_source,
 STRUCT(STRUCT(JSON_VALUE(e,'$.source') AS source,JSON_VALUE(e,'$.medium') AS medium,JSON_VALUE(e,'$.campaign') AS campaign_name,JSON_VALUE(e,'$.native') AS default_channel_group) AS cross_channel_campaign,
  STRUCT(JSON_VALUE(e,'$.manual_source') AS source,JSON_VALUE(e,'$.manual_medium') AS medium,JSON_VALUE(e,'$.manual_campaign') AS campaign_name) AS manual_campaign) AS session_traffic_source_last_click,
 STRUCT(JSON_VALUE(e,'$.transaction') AS transaction_id,CAST(JSON_VALUE(e,'$.revenue') AS FLOAT64) AS purchase_revenue_in_usd) AS ecommerce
FROM UNNEST(JSON_QUERY_ARRAY(${quote(JSON.stringify(events))})) e;\n`;}
function query(template,events=f.events,window=f.window){let sql=template.replaceAll('`PROJECT.analytics_PROPERTY_ID.events_*`',()=>'(SELECT e.*,event_date AS _TABLE_SUFFIX FROM synthetic_events e)').replaceAll("'YYYYMMDD' AND 'YYYYMMDD'",()=>`${quote(window.start)} AND ${quote(window.end)}`).replaceAll("PARSE_DATE('%Y%m%d','YYYYMMDD'),PARSE_DATE('%Y%m%d','YYYYMMDD')",()=>`PARSE_DATE('%Y%m%d',${quote(window.start)}),PARSE_DATE('%Y%m%d',${quote(window.end)})`);assert.ok(!sql.includes('YYYYMMDD'));if(sql.includes('DECLARE key_event_names')){const end=sql.indexOf(';',sql.indexOf('DECLARE key_event_names'))+1;return sql.slice(0,end)+'\n'+setup(events)+sql.slice(end);}return setup(events)+sql;}
function legacyEvents(){const p=(key,s=null,i=null)=>({key,value:{string_value:s,int_value:i,float_value:null,double_value:null}});return legacy.events.map(e=>({...e,user:e.visitor,event_name:e.event,event_params:[p('ga_session_id',null,e.session??null),p('ga_session_number',null,e.number??null),p('page_location',e.url??null),p('page_referrer',e.referrer??null),p('session_engaged',e.engaged??null),p('engagement_time_msec',null,e.engagement_ms??null)]}));}
async function live(){
 const project=opt('--project');assert.ok(project);const location=opt('--location','US'),out=resolve(opt('--report',join(homedir(),'Downloads',`ga4-parameter-native-evidence-${new Date().toISOString().replaceAll(/[^0-9]/g,'').slice(0,14)}.json`)));
 const sourceHashes=Object.fromEntries(Object.entries(templates).map(([k,s])=>[k,hash(s)]));sourceHashes.parameterHelpers=hash(helper);sourceHashes.runner=hash(await readFile(fileURLToPath(import.meta.url)));
 const report={version:1,pid:process.pid,startedAt:new Date().toISOString(),status:'running',project,location,sourceHashes,fixtureSha256:hash(fixtureText),legacyFixtureSha256:hash(legacyText),maximumBytesBilledPerJob:1073741824,useQueryCache:false,nodeVersion:process.version,jobs:[]};
 const resume=opt('--resume-report');if(resume){assert.notEqual(resolve(resume),out);const old=JSON.parse(await readFile(resume,'utf8'));for(const k of ['project','location','sourceHashes','fixtureSha256','legacyFixtureSha256'])assert.deepEqual(old[k],report[k]);report.resumedFrom=resume;report.jobs=structuredClone(old.jobs);}
 await assert.rejects(readFile(out),e=>e.code==='ENOENT');const save=async()=>{await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');};
 const command=(args,input='')=>new Promise((res,rej)=>{const p=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',rej);p.on('close',code=>res({code,stdout,stderr}));p.stdin.end(input);});
 const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
 async function run(label,statement,verify){let j=report.jobs.find(x=>x.label===label),result;if(j){assert.equal(j.querySha256,hash(statement));assert.equal(j.verification,'passed');const shown=await command([...common,'show','--job',j.jobId]);assert.equal(shown.code,0);const md=JSON.parse(shown.stdout);assert.equal(md.status.state,'DONE');assert.ok(!md.status.errorResult);assert.deepEqual(md.configuration.query,j.jobMetadata.configuration.query);result=await command([...common,'head','--job','--max_rows=10000',j.jobId]);j.readOnlyRechecks=[...(j.readOnlyRechecks??[]),{metadata:shown,result,at:new Date().toISOString()}];}
 else{j={label,jobId:'ga4_parameter_'+label.replaceAll('-','_')+'_'+randomUUID().replaceAll('-',''),query:statement,querySha256:hash(statement),submittedAt:new Date().toISOString(),verification:'pending'};report.jobs.push(j);await save();console.log(`SUBMIT ${label} ${j.jobId}`);result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${j.jobId}`,'--max_rows=10000'],statement);j.result=result;const shown=await command([...common,'show','--job',j.jobId]);j.metadataRead=shown;j.jobMetadata=shown.code===0?JSON.parse(shown.stdout):null;await save();assert.equal(shown.code,0);const md=j.jobMetadata;assert.equal(md.status.state,'DONE');assert.equal(md.configuration.query.useLegacySql,false);assert.equal(md.configuration.query.useQueryCache,false);assert.equal(String(md.configuration.query.maximumBytesBilled),'1073741824');assert.equal(md.configuration.query.query,statement);j.totalBytesProcessed=md.statistics.query?.totalBytesProcessed??null;j.totalBytesBilled=md.statistics.query?.totalBytesBilled??null;}
 assert.equal(result.code,0,result.stdout+'\n'+result.stderr);const p=JSON.parse(result.stdout),rows=Array.isArray(p.at(-1))?p.at(-1):p;j.rawRows=rows;const value=rows.length===1&&Object.hasOwn(rows[0],'result_json')?JSON.parse(rows[0].result_json):rows;j.parsedOutput=value;await save();verify(value);j.verification='passed';await save();return value;
 }
 const verify=(name,actual)=>{if(name==='sessions'){assert.equal(actual.length,f.expected.sessions.length);f.expected.sessions.forEach((e,i)=>compare(projection(actual[i],e),e));assert.equal(new Set(actual.map(r=>JSON.stringify([r.source_system,r.source_scope,r.session_key]))).size,4);}else compare(actual,f.expected[name]);};
 try{report.bqVersion=await command(['version']);await save();for(const name of names)await run(name,query(templates[name]),a=>verify(name,a));
 for(const name of names)await run(name+'-copied',query(await readFile(join(temp,name+'.sql'),'utf8')),a=>verify(name,a));
 await run('ui-empty',query(templates.ui_reconciliation,[]),a=>compare(a,f.expected.empty_ui_reconciliation));
 await run('params-permutation',query(templates.params,[...f.events].reverse()),a=>compare(a,f.expected.params));
 const last=templates.params.replaceAll('ORDER BY parameter_offset LIMIT 1','ORDER BY parameter_offset DESC LIMIT 1');assert.notEqual(last,templates.params);await run('mutation-last-parameter',query(last),a=>{assert.throws(()=>compare(a,f.expected.params));assert.notEqual(a.helper_rows[0].ga_session_id,1);});
 const skip=templates.params.replace('WHERE p.key = target_key ORDER BY parameter_offset LIMIT 1','WHERE p.key = target_key AND p.value.string_value IS NOT NULL ORDER BY parameter_offset LIMIT 1');assert.notEqual(skip,templates.params);await run('mutation-skip-first-null',query(skip),a=>{assert.throws(()=>compare(a,f.expected.params));assert.equal(a.helper_rows[0].page_location,'https://example.test/forged');});
 const oldEvents=legacyEvents();await run('legacy-integration-sessions',query(templates.sessions,oldEvents,{start:'20260901',end:'20260902'}),a=>{assert.equal(a.length,legacy.expected.sessions);for(const [visitor,e] of Object.entries(legacy.expected.visitors)){const matches=a.filter(r=>r.visitor_key===visitor);assert.equal(matches.length,1);compare(projection(matches[0],e),e);}const row=a.find(r=>r.visitor_key==='synthetic-multi');assert.deepEqual(Object.keys(row.click_ids).sort(),legacy.click_id_names.slice().sort());for(const k of legacy.click_id_names)assert.equal(row.click_ids[k],`synthetic-${k}`);});
 await run('legacy-integration-channel-daily',query(templates.channel_daily,oldEvents,{start:'20260901',end:'20260902'}),a=>{assert.equal(a.length,legacy.expected.daily.length);for(const e of legacy.expected.daily){const matches=a.filter(r=>r.event_date===e.event_date&&r.channel===e.channel);assert.equal(matches.length,1);compare(projection(matches[0],e),e);}});
 report.status='passed';report.completedAt=new Date().toISOString();report.counts={nativeJobs:20,actualTemplates:7,copiedTemplates:7,emptyDiagnostic:1,eventPermutation:1,semanticMutants:2,legacyIntegrationJobs:2};await save();console.log('PASS 20 native jobs: seven actual templates/copies, empty diagnostics, permutation, two caught helper mutants and legacy session/channel integration.');
 }catch(e){report.status='failed';report.error=e.message;report.completedAt=new Date().toISOString();await save();throw e;}
}

#!/usr/bin/env node
// Native synthetic proof; offline checks never claim to execute SQL.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'..');
const hash=x=>createHash('sha256').update(x).digest('hex');
const flags=process.argv.slice(2), allowed=new Set(['--live','--project','--location','--report','--resume-report']);
for(let i=0;i<flags.length;i++){assert.ok(allowed.has(flags[i]),`unknown flag ${flags[i]}`);if(flags[i]!=='--live')assert.ok(flags[++i]&&!flags[i].startsWith('--'),'missing flag value');}
const opt=(x,f)=>flags.includes(x)?flags[flags.indexOf(x)+1]:f;
const fixtureText=await readFile(path.join(root,'references/companion-session-fixtures.json'),'utf8'), f=JSON.parse(fixtureText);
const templates={};for(const name of ['sessions','landing_pages','traffic_source_compare'])templates[name]=await readFile(path.join(root,`references/sql/${name}.sql`),'utf8');
const block=(sql,name)=>{const m=sql.match(new RegExp(`-- BEGIN GENERATED ${name}\\n([\\s\\S]*?)-- END GENERATED ${name}`));assert.ok(m,name);return m[1];};
for(const name of ['landing_pages','traffic_source_compare'])for(const section of ['CHANNEL TAXONOMY','SESSION CTES'])assert.equal(block(templates[name],section),block(templates.sessions,section));
const utmBlock=block(templates.traffic_source_compare,'LANDING UTM EVIDENCE');
const body=utmBlock.match(/AS r'''\n([\s\S]*?)\n''';/)[1], parse=new Function('landing_url',body);
for(const c of f.parser_cases)assert.deepEqual(parse(c.url),c.expected);
// Compare generated helper behavior to the actual unchanged canonical implementation.
const canonicalFile=path.resolve(root,'../channel-taxonomy/scripts/channel-taxonomy.mjs');
const canonical=await readFile(canonicalFile,'utf8');
const implementation=canonical.replace(/^\/\*[\s\S]*?\*\/\s*/m,'').replace(/\nexport \{[\s\S]*?\};?\s*$/m,'\n').trim();
assert.ok(body.startsWith(implementation));
const helpers=new Function(implementation+'\nreturn {hostOf,queryParams,decode,text};')();
for(const c of f.parser_cases){const p=helpers.hostOf(c.url)?helpers.queryParams(c.url):{};for(const key of ['utm_source','utm_medium','utm_campaign'])assert.equal(parse(c.url)[key],p[key]===undefined?null:(helpers.decode(p[key])||null));}
assert.equal(f.expected_sessions.length,14);assert.equal(new Set(f.expected_sessions.map(s=>JSON.stringify([s.source_system,s.source_scope,s.session_key]))).size,14);
assert.equal(f.expected_sessions.filter(s=>s.visitor_key==='same').length,2);
for(const rows of [f.expected_landing,f.expected_traffic])assert.equal(rows.reduce((n,r)=>n+r.sessions,0),14);
for(const row of f.expected_sessions){assert.equal(typeof row.engaged,'boolean');for(const k of ['key_events','events'])assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0);}
const copied=await mkdtemp(path.join(tmpdir(),'ga4-companions-'));
try{
 for(const name of Object.keys(templates)){await cp(path.join(root,`references/sql/${name}.sql`),path.join(copied,`${name}.sql`));assert.equal(await readFile(path.join(copied,`${name}.sql`),'utf8'),templates[name]);}
 if(!flags.includes('--live')){console.log(`PASS definitions: 14 qualified sessions, ${f.expected_landing.length} landing groups, ${f.expected_traffic.length} traffic groups, 8 canonical parser cases, copied SQL and shared blocks. NO SQL EXECUTED.`);}
 else await live();
}finally{await rm(copied,{recursive:true,force:true});}
function setup(events){return `CREATE TEMP TABLE synthetic_events AS
SELECT JSON_VALUE(e, '$.event_date') AS event_date,
 JSON_VALUE(e, '$.visitor') AS user_pseudo_id,
 CAST(JSON_VALUE(e, '$.timestamp') AS INT64) AS event_timestamp,
 JSON_VALUE(e, '$.event') AS event_name,
 [STRUCT('ga_session_id' AS key, STRUCT(CAST(NULL AS STRING) AS string_value, CAST(JSON_VALUE(e, '$.session') AS INT64) AS int_value) AS value),
  STRUCT('ga_session_number', STRUCT(CAST(NULL AS STRING), CAST(JSON_VALUE(e, '$.number') AS INT64))),
  STRUCT('page_location', STRUCT(JSON_VALUE(e, '$.url'), CAST(NULL AS INT64))),
  STRUCT('page_referrer', STRUCT(JSON_VALUE(e, '$.referrer'), CAST(NULL AS INT64))),
  STRUCT('session_engaged', STRUCT(JSON_VALUE(e, '$.engaged'), CAST(NULL AS INT64))),
  STRUCT('engagement_time_msec', STRUCT(CAST(NULL AS STRING), CAST(JSON_VALUE(e, '$.engagement_ms') AS INT64)))] AS event_params,
 STRUCT(JSON_VALUE(e, '$.gclid') AS gclid, JSON_VALUE(e, '$.dclid') AS dclid, JSON_VALUE(e, '$.srsltid') AS srsltid) AS collected_traffic_source,
 STRUCT(STRUCT(JSON_VALUE(e, '$.source') AS source, JSON_VALUE(e, '$.medium') AS medium,
   JSON_VALUE(e, '$.campaign') AS campaign_name, JSON_VALUE(e, '$.native') AS default_channel_group) AS cross_channel_campaign,
   STRUCT(JSON_VALUE(e, '$.manual_source') AS source, JSON_VALUE(e, '$.manual_medium') AS medium, JSON_VALUE(e, '$.manual_campaign') AS campaign_name) AS manual_campaign) AS session_traffic_source_last_click,
 STRUCT(JSON_VALUE(e, '$.transaction') AS transaction_id, CAST(JSON_VALUE(e, '$.revenue') AS FLOAT64) AS purchase_revenue_in_usd) AS ecommerce
FROM UNNEST(JSON_QUERY_ARRAY(${quote(JSON.stringify(events))})) e;\n`;}
function quote(s){return "'"+String(s).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r')+"'";}
function query(template,events=f.events){let sql=template.replace('`PROJECT.analytics_PROPERTY_ID.events_*`',()=>'(SELECT e.*, event_date AS _TABLE_SUFFIX FROM synthetic_events e)').replace("'YYYYMMDD' AND 'YYYYMMDD'",()=>`${quote(f.window.start)} AND ${quote(f.window.end)}`);assert.ok(!sql.includes('`PROJECT.analytics_PROPERTY_ID.events_*`'));const end=sql.indexOf(';',sql.indexOf('DECLARE key_event_names'))+1;assert.ok(end>0);return sql.slice(0,end)+'\n'+setup(events)+sql.slice(end);}
function normalized(row){const out={...row};for(const k of ['sessions','engaged_sessions','key_events','events'])if(k in out){assert.ok(typeof out[k]==='number'||typeof out[k]==='string');out[k]=Number(out[k]);assert.ok(Number.isSafeInteger(out[k]));}if('engaged' in out){assert.ok([true,false,'true','false'].includes(out.engaged));out.engaged=out.engaged===true||out.engaged==='true';}return out;}
function ordering(a,b,fields){for(const k of fields){if(a[k]===b[k])continue;if(a[k]===null)return -1;if(b[k]===null)return 1;return a[k]<b[k]?-1:1;}return 0;}
function aggregate(rows,kind){const map=new Map();for(const s of rows){const u=kind==='traffic'?parse(s.landing_page_location):null;const r=kind==='landing'?{source_system:s.source_system,source_scope:s.source_scope,landing_page_path:s.landing_page_path}:{source_system:s.source_system,source_scope:s.source_scope,session_last_click_source:s.session_source,session_last_click_medium:s.session_medium,landing_url_status:u.landing_url_status,landing_utm_source:u.utm_source,landing_utm_medium:u.utm_medium,landing_utm_campaign:u.utm_campaign};const key=JSON.stringify(r);if(!map.has(key))map.set(key,{...r,sessions:0,...(kind==='landing'?{engaged_sessions:0,key_events:0}:{})});const a=map.get(key);a.sessions++;if(kind==='landing'){a.engaged_sessions+=Number(s.engaged);a.key_events+=s.key_events;}}
 const rs=[...map.values()];const fields=Object.keys(rs[0]).filter(k=>!['sessions','engaged_sessions','key_events'].includes(k));return rs.sort((a,b)=>b.sessions-a.sessions||ordering(a,b,fields)).slice(0,20);}
async function live(){
 const project=opt('--project');assert.ok(project,'--project is required');const location=opt('--location','US');
 const reportPath=path.resolve(opt('--report',path.join(homedir(),'Downloads',`ga4-companion-native-evidence-${new Date().toISOString().replaceAll(/[^0-9]/g,'').slice(0,14)}.json`)));
 const sourceHashes=Object.fromEntries(Object.entries(templates).map(([n,s])=>[n,hash(s)]));sourceHashes.canonical=hash(canonical);sourceHashes.runner=hash(await readFile(fileURLToPath(import.meta.url)));
 let report={version:1,pid:process.pid,startedAt:new Date().toISOString(),status:'running',project,location,maximumBytesBilledPerJob:1073741824,useQueryCache:false,nodeVersion:process.version,sourceHashes,fixtureSha256:hash(fixtureText),jobs:[]};
 const oldPath=opt('--resume-report');if(oldPath){assert.notEqual(path.resolve(oldPath),reportPath);const old=JSON.parse(await readFile(oldPath,'utf8'));for(const k of ['project','location','fixtureSha256','sourceHashes'])assert.deepEqual(old[k],report[k],`resume ${k}`);report.resumedFrom=oldPath;report.jobs=structuredClone(old.jobs);}
 await assert.rejects(readFile(reportPath),e=>e.code==='ENOENT','report output must be new');
 const save=async()=>{await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');};
 const command=(args,input='')=>new Promise((resolve,reject)=>{const p=spawn('bq',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input);});
 const common=[`--project_id=${project}`,`--location=${location}`,'--format=json','--quiet'];
 async function run(label,sql){let j=report.jobs.find(x=>x.label===label);let result;if(j){assert.equal(j.querySha256,hash(sql),'resume requires byte-identical query');assert.equal(j.verification,'passed','resume only terminal verified jobs');const shown=await command([...common,'show','--job',j.jobId]);assert.equal(shown.code,0);const md=JSON.parse(shown.stdout);assert.deepEqual(md.configuration.query,j.jobMetadata.configuration.query);assert.equal(md.status.state,'DONE');assert.ok(!md.status.errorResult);result=await command([...common,'head','--job','--max_rows=10000',j.jobId]);j.readOnlyRechecks=[...(j.readOnlyRechecks??[]),{at:new Date().toISOString(),metadata:shown,result}];}
 else{j={label,jobId:'ga4_companion_'+label.replaceAll('-','_')+'_'+randomUUID().replaceAll('-',''),query:sql,querySha256:hash(sql),submittedAt:new Date().toISOString(),verification:'pending'};report.jobs.push(j);await save();console.log(`SUBMIT ${label} ${j.jobId}`);result=await command([...common,'query','--use_legacy_sql=false','--use_cache=false','--maximum_bytes_billed=1073741824',`--job_id=${j.jobId}`,'--max_rows=10000'],sql);j.result=result;const shown=await command([...common,'show','--job',j.jobId]);j.metadataRead=shown;j.jobMetadata=shown.code===0?JSON.parse(shown.stdout):null;await save();assert.equal(shown.code,0,shown.stderr);const md=j.jobMetadata;assert.equal(md.status.state,'DONE');assert.equal(md.configuration.query.useLegacySql,false);assert.equal(md.configuration.query.useQueryCache,false);assert.equal(String(md.configuration.query.maximumBytesBilled),'1073741824');assert.equal(md.configuration.query.query,sql);j.totalBytesProcessed=md.statistics.query?.totalBytesProcessed??null;j.totalBytesBilled=md.statistics.query?.totalBytesBilled??null;}
 assert.equal(result.code,0,result.stdout+'\n'+result.stderr);const p=JSON.parse(result.stdout);const rows=(Array.isArray(p.at(-1))?p.at(-1):p);j.rawRows=rows;await save();return {rows:rows.map(normalized),record:j};}
 try{report.bqVersion=await command(['version']);await save();const source=await run('sessions',query(templates.sessions));assert.equal(source.rows.length,f.expected_sessions.length);const keyed=new Map(source.rows.map(s=>[JSON.stringify([s.source_system,s.source_scope,s.session_key]),s]));assert.equal(keyed.size,source.rows.length);for(const e of f.expected_sessions){const a=keyed.get(JSON.stringify([e.source_system,e.source_scope,e.session_key]));assert.ok(a);assert.deepEqual(Object.fromEntries(Object.keys(e).map(k=>[k,a[k]])),e);}source.record.verification='passed';await save();
 for(const [name,kind,expected] of [['landing_pages','landing',f.expected_landing],['traffic_source_compare','traffic',f.expected_traffic]]){const a=await run(name,query(templates[name]));assert.deepEqual(a.rows,expected);assert.deepEqual(a.rows,aggregate(source.rows,kind));a.record.verification='passed';await save();const copy=await run(name+'-copied',query(await readFile(path.join(copied,name+'.sql'),'utf8')));assert.deepEqual(copy.rows,expected);copy.record.verification='passed';await save();const perm=await run(name+'-permuted',query(templates[name],[...f.events].reverse()));assert.deepEqual(perm.rows,expected);perm.record.verification='passed';await save();}
 const parserQuery=utmBlock+'\nSELECT CAST(JSON_VALUE(c,\'$.index\') AS INT64) AS case_index, extract_landing_utm_evidence(JSON_VALUE(c,\'$.url\')) AS evidence FROM UNNEST(JSON_QUERY_ARRAY('+quote(JSON.stringify(f.parser_cases.map((c,i)=>({index:i,url:c.url}))))+')) c ORDER BY case_index;';
 const parser=await run('utm-native-parity',parserQuery);assert.equal(parser.rows.length,f.parser_cases.length);parser.rows.forEach((r,i)=>{assert.equal(Number(r.case_index),i);assert.deepEqual(r.evidence,f.parser_cases[i].expected);});parser.record.verification='passed';await save();
 const omission=templates.landing_pages.replace('OR COUNTIF(event_name IN UNNEST(key_event_names)) > 0','OR FALSE');assert.notEqual(omission,templates.landing_pages);const badEngagement=await run('mutation-key-engagement',query(omission));assert.notDeepEqual(badEngagement.rows,f.expected_landing);assert.equal(badEngagement.rows.find(r=>r.landing_page_path==='/key').engaged_sessions,0);badEngagement.record.verification='passed';badEngagement.record.mutationDetected=true;await save();
 const mixed=templates.traffic_source_compare.replace('session_traffic_source_last_click.cross_channel_campaign.medium AS medium','COALESCE(session_traffic_source_last_click.cross_channel_campaign.medium, session_traffic_source_last_click.manual_campaign.medium) AS medium');assert.notEqual(mixed,templates.traffic_source_compare);const badSource=await run('mutation-mixed-source',query(mixed));assert.notDeepEqual(badSource.rows,f.expected_traffic);assert.equal(badSource.rows.find(r=>r.session_last_click_source==='Cross').session_last_click_medium,'paid_social');badSource.record.verification='passed';badSource.record.mutationDetected=true;
 report.status='passed';report.completedAt=new Date().toISOString();report.counts={nativeJobs:10,sourceSessions:14,landingGroups:13,trafficGroups:12,parserCases:8,semanticMutations:2};await save();console.log('PASS 10 bounded native jobs: actual source sessions, full companion goldens, direct aggregate parity, copied SQL, permutation, canonical UDF and two detected semantic mutants.');
 }catch(e){report.status='failed';report.error=e.message;report.completedAt=new Date().toISOString();await save();throw e;}
}

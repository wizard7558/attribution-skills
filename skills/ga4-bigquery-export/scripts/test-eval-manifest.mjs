#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateConfig,decodeRows,collectResults,runChecks,DEFAULT_CAP} from './run-export-checks.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const read=n=>JSON.parse(fs.readFileSync(path.join(root,'references',n+'-fixtures.json'),'utf8'));
const C=read('companion-session'),P=read('parameter-diagnostic'),E=read('ecommerce'),L=read('integration');
const clone=structuredClone,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const project=(row,keys)=>Object.fromEntries(keys.map(k=>{assert.ok(Object.hasOwn(row,k),k);return[k,row[k]];}));
const option=k=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:null;
// Accepted executable/fixture/substantive-doc bytes; updating these pins requires a new review.
const PINNED={
  "references/ecommerce-fixtures.json": "d8ae310c5184e4d635f34d09f5e43ea44be82744c2cc983ecc6e605bf4c3809d",
  "references/companion-session-fixtures.json": "8a21df85f58b0d5c3f9034aa466b413a9aeab1103dd2826b40232e89e8fc4075",
  "references/export-check-fixtures.json": "2656720617bd4449e9e9c375da817e1e85c47d6a6dbcd476635bc2ca873c66f5",
  "references/integration-fixtures.json": "9aa70ca11f9bd41775644c1ae00aa4cb8af789a72b6de7ef4e522552d7b2cb46",
  "references/parameter-diagnostic-fixtures.json": "5f2f81f3e4e18f60b47c383c825770a2a6290b2f7bf3b0593d8ef5238d76d286",
  "scripts/parameter-helpers.sql": "08247dfce0de8cb793ebbef101e07eea59dc69e7add339f94850160bf25234aa",
  "scripts/test-ecommerce.mjs": "29a29b4ef576ceb43766f6b206e946d8504a1c482d19145baa9a90401e956416",
  "scripts/run-export-checks.mjs": "9eaedf7ec9e30895195196dfd6f0d7447f175c9e58255c907b92a3f1b6494f14",
  "scripts/test-export-checks.mjs": "f74c121a20a26c95ea9cd83052f37e5b707ff212eeb6ec027a10e7c309d1ae13",
  "scripts/test-parameter-diagnostics.mjs": "252358c194e14986f0e7cbdb887f2a4bee67325fe0e21eba2bc8441707da4a89",
  "scripts/test-companion-sessions.mjs": "f09b2a98b203b151067277435e7afeecaced5c6564cbb0e56be529f7de2398af",
  "scripts/session-ctes.sql": "36bbd978128f3339bb285e70c0b74e18b7d85039cb97173a26342e602c010e36",
  "references/sql/key_events.sql": "222626d590d9c084318916b44cb40beac00a259a0ea1208f2360fa4cc90ebd73",
  "references/sql/ui_reconciliation.sql": "098c9c6009797cc2661e66218a1ebd93c3b422cd326ad298f6a879d4bbfbe2d8",
  "references/sql/channel_daily.sql": "4309a0225cac62771bf8f56b52fc0b2ae9eae7b5ac58a8d643148f78a247b361",
  "references/sql/params.sql": "3d9528f013c781642f5092df84f1b14d0c3d2e695cec03419499869af6c5784f",
  "references/sql/sessions.sql": "ee76588d48334bcc033cd8edd6ec28134ff359c7d3e5045a8b0f4f8d5d4ed587",
  "references/sql/ecommerce.sql": "60e45b553965e30d5d9875cc44f88875a6045ab870a15c8aafac29c9ae0e530c",
  "references/sql/landing_pages.sql": "481bcbdb92b2111690bc8093a4802f0fd09286f1f0cce7572c87f15f1e6dfa75",
  "references/sql/traffic_source_compare.sql": "0b92d5049ae78506200df314cc846de644d399d4ef499ec04cb2b9a84afb6617",
  "SKILL.md": "f4ef7556afa021a3fc03d78a68383d10d52ddd51de776b262f7a54dfbd38310d",
  "references/schema.md": "0fec76afa20f8b59bc372589094cd228998b37ea9f3113ec1484d0051ede6f02",
  "references/pitfalls.md": "7b11b48047e30ca7af122062755585b249467aedf2bac40b1620837c401cddff",
  "references/channel_rules.md": "990b49ab730461cb0780dfc5ef19d48fe60aed16499c5fcaafb4a9bc03363c07",
  "references/verification-status.md": "3dc8b09f9dc66dcfed1d3950d75bd26f55673daf0c92df728be32bdb3378c18f"
};
for(const [relative,h] of Object.entries(PINNED))assert.equal(hash(fs.readFileSync(path.join(root,relative))),h,relative);
const permitted=new Set(['--write','--evidence','--native-index','--standalone-child']);
for(let i=2;i<process.argv.length;i++){assert.ok(permitted.has(process.argv[i]),process.argv[i]);if(['--evidence','--native-index'].includes(process.argv[i]))assert.ok(process.argv[++i]);}
// Only bijective identity display labels change. Preserve null, empty and whitespace-only keys,
// surrounding whitespace, source scope, all parameter/URL/campaign text and array order.
function labeler(events){
 const users=new Set(),orders=new Set();
 for(const e of events){for(const k of ['visitor','user','user_pseudo_id'])if(typeof e[k]==='string'&&e[k].trim())users.add(e[k]);for(const k of ['transaction','transaction_id'])if(typeof e[k]==='string'&&e[k].trim())orders.add(e[k]);}
 const map=(s,p)=>Object.fromEntries([...s].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map((v,i)=>[v,v.match(/^\s*/u)[0]+p+String(i+1).padStart(2,'0')+v.match(/\s*$/u)[0]]));
 const u=map(users,'v'),t=map(orders,'t');assert.equal(new Set(Object.values(u)).size,Object.keys(u).length);assert.equal(new Set(Object.values(t)).size,Object.keys(t).length);
 const visit=x=>Array.isArray(x)?x.map(visit):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,['visitor','user','user_pseudo_id','visitor_key'].includes(k)?u[v]??v:['transaction','transaction_id'].includes(k)?t[v]??v:k==='session_key'&&typeof v==='string'?Object.entries(u).reduce((a,[old,n])=>a===v&&v.startsWith(old+'.')?n+v.slice(old.length):a,v):visit(v)])):x;
 return {apply:visit,users:u,transactions:t};
}
const cLabels=labeler(C.events),pLabels=labeler(P.events),lLabels=labeler(L.events);
const pools={Q:{encoding:'session_events',source_system:'ga4',source_scope:'PROJECT.analytics_PROPERTY_ID',window:C.window,key_event_names:['purchase','generate_lead','sign_up'],events:cLabels.apply(C.events)},R:{encoding:'session_events',source_system:'ga4',source_scope:'PROJECT.analytics_PROPERTY_ID',window:{start:'20260901',end:'20260902'},key_event_names:['purchase','generate_lead','sign_up'],events:lLabels.apply(L.events)}};
const provenance=[];
function entry(label,operation,input,result,origin){provenance.push({label,operation,...origin});return {input:{case:label,operation,...input},expected:{case:label,result}};}
const scopedSessions=keys=>keys.map(k=>{const r=C.expected_sessions.find(r=>r.session_key===k);assert.ok(r,k);return r;});
const g1=[];
for(const [i,keys] of [['A',['same.1','same.2']],['B',['tie.3']],['C',['partial.4','cross.5','manual.14']],['D',['window.13']]])g1.push(entry(i,'sessions',{pool:'Q',session_keys:keys.map(k=>cLabels.apply({session_key:k}).session_key)},cLabels.apply(scopedSessions(keys)),{fixture:'companion-session-fixtures.json',keys}));
g1.push(entry('E','landing',{pool:'Q'},clone(C.expected_landing),{fixture:'companion-session-fixtures.json',projection:'expected_landing'}));
g1.push(entry('F','traffic',{pool:'Q'},clone(C.expected_traffic),{fixture:'companion-session-fixtures.json',projection:'expected_traffic'}));
const channels=Object.entries(L.expected.visitors).map(([visitor_key,e])=>({visitor_key,channel:e.channel}));
g1.push(entry('G','channels',{pool:'R',visitor_keys:channels.map(r=>lLabels.users[r.visitor_key]),click_visitor:lLabels.users['synthetic-multi']},{channels:lLabels.apply(channels),retained_clicks:L.click_id_names.map(name=>({name,value:`synthetic-${name}`}))},{fixture:'integration-fixtures.json',projection:'expected.visitors.channel; accepted native runner thirteen-click literal'}));
const scopeReview={session_identity_fields:['source_system','source_scope','session_key'],splits_platform_stream:false,reporting_timezone:null,engagement_measure:'observed_proxy',complete_beyond_window:false,new_users_measure:'first_session_rows',same_person_across_sources:false,native_channel_is_canonical:false,landing_sample_limit:20,traffic_sample_limit:20,landing_groups_by_date:false};
g1.push(entry('H','scope_review',{questions:Object.keys(scopeReview)},scopeReview,{authority:['scripts/session-ctes.sql','references/companion-session-contract.md','references/channel_rules.md']}));
const g2=[];
for(const [label,indexes] of [['A',[0]],['B',[1,3]],['C',[2,4,5]]]){
 const rows=indexes.map(i=>P.expected.params.helper_rows[i]);
 g2.push(entry(label,'parameters',{pool:'Q',row_keys:rows.map(r=>pLabels.apply(project(r,['user_pseudo_id','event_timestamp'])))},pLabels.apply(rows),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.params.helper_rows',indexes}));
}
g2.push(entry('D','key_events',{pool:'Q'},pLabels.apply(P.expected.key_events.map(r=>project(r,['source_system','source_scope','user_pseudo_id','ga_session_id','event_date','event_name','event_timestamp','event_value_in_usd','session_key']))),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.key_events; exclude old CLI display event_ts'}));
g2.push(entry('E','parameter_sessions',{pool:'Q'},pLabels.apply(P.expected.sessions),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.sessions'}));
g2.push(entry('F','daily_observations',{pool:'Q'},clone(P.expected.ui_reconciliation.daily_observations),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.ui_reconciliation.daily_observations'}));
g2.push(entry('G','identifier_and_spans',{pool:'Q'},project(P.expected.ui_reconciliation,['identifier_observation','session_date_spans']),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.ui_reconciliation two objects'}));
g2.push(entry('H','observations',{pool:'R'},clone(P.expected.empty_ui_reconciliation),{fixture:'parameter-diagnostic-fixtures.json',projection:'expected.empty_ui_reconciliation'}));
const paramPools={Q:{encoding:'parameter_events',source_system:'ga4',source_scope:'PROJECT.analytics_PROPERTY_ID',window:P.window,key_event_names:['purchase','generate_lead','sign_up'],events:pLabels.apply(P.events)},R:{encoding:'parameter_events',source_system:'ga4',source_scope:'PROJECT.analytics_PROPERTY_ID',window:P.window,key_event_names:['purchase','generate_lead','sign_up'],events:[]}};
const txKeys=['source_system','source_scope','platform','stream_id','user_pseudo_id','transaction_id','event_date'];
const diagKeys=['observed_purchase_events','qualified_purchase_events','unkeyed_purchase_events','qualified_transaction_count','conflicting_transaction_count','collapsed_duplicate_events','item_line_count'];
const compactDaily=r=>({event_date:r.event_date,qualified_transaction_count:r.qualified_transaction_count,all_population_unique_purchase_count:r.all_population_unique_purchase_count,...project(r.money.find(m=>m.metric==='revenue_usd'),['known_subtotal','value','reasons'])});
const compactTxKeys=['platform','stream_id','user_pseudo_id','transaction_id'];
function ecommerceProjection(e){return {daily_summary:e.daily_summary.map(compactDaily),qualified_transactions:e.qualified_transactions.map(r=>({...project(r,[...compactTxKeys,'event_date','occurrence_count','payload_variant_count','status']),revenue:r.money.find(m=>m.metric==='revenue_usd').amount})),item_lines:e.item_lines.map(r=>project(r,[...compactTxKeys,'item_offset','quantity','revenue_usd'])),unkeyed_evidence:e.unkeyed_evidence.map(r=>project(r,[...compactTxKeys,'event_date','event_timestamp_micros','occurrence_count','reasons'])),diagnostics:project(e.diagnostics,diagKeys)};}

const g3=[],txPools={},txLabels={};
for(const [label,id] of [['A','qualified-domain-and-cross-date'],['B','conflict-unknown-and-invalid'],['C','unkeyed-earlier-date']]){
 const f=E.cases.find(c=>c.id===id),labels=labeler(f.events);txLabels[label]=labels;
 txPools[label]={encoding:'purchase_events',window:E.window,events:labels.apply(f.events)};
 g3.push(entry(label,'ecommerce',{pool:label},labels.apply(ecommerceProjection(f.expected)),{fixture:'ecommerce-fixtures.json',id}));
}
const numericIds=['all-zero','all-negative','signed-cancellation','positive-overflow','unkeyed-evidence','no-purchases'];
const numericExpected=[];
for(const [i,id] of numericIds.entries()){
 const f=E.cases.find(c=>c.id===id),labels=labeler(f.events),pool='N'+(i+1);txLabels[pool]=labels;txPools[pool]={encoding:'purchase_events',window:E.window,events:labels.apply(f.events)};
 numericExpected.push({pool,daily_summary:f.expected.daily_summary.map(compactDaily),diagnostics:project(f.expected.diagnostics,diagKeys)});
}
g3.push(entry('D','ecommerce_totals',{pools:numericIds.map((_,i)=>'N'+(i+1))},numericExpected,{fixture:'ecommerce-fixtures.json',ids:numericIds}));
txPools.R=pools.R;
const dailyKeys=['event_date','channel','sessions','engaged_sessions','new_users','key_events','purchases','purchase_revenue_usd','revenue_status','purchase_events_without_transaction_id','native_channel_groups'];
const daily=L.expected.daily.map(r=>Object.fromEntries(dailyKeys.map(k=>[k,['sessions','engaged_sessions','new_users','key_events','purchases','purchase_events_without_transaction_id','purchase_revenue_usd'].includes(k)&&r[k]!==null?Number(r[k]):r[k]])));
g3.push(entry('E','channel_daily',{pool:'R'},daily,{fixture:'integration-fixtures.json',projection:'expected.daily'}));
const configs=[{sourceProject:'example-project',dataset:'analytics_test',start:'20260901',end:'20260903'},{sourceProject:'example-project',dataset:'analytics_test',start:'20260229',end:'20260301'},{sourceProject:'example-project',dataset:'a` UNION SELECT',start:'20260901',end:'20260903'},{sourceProject:'example-project',dataset:'analytics_test',start:'20260901',end:'20260903',maximumBytesBilled:'0'}];
const configExpected=[{accepted:true,billing_project:'example-project',location:'US',maximum_bytes_billed:'1073741824'},...Array.from({length:3},()=>({accepted:false,billing_project:null,location:null,maximum_bytes_billed:null}))];
const executionPolicy={daily_only:true,includes_intraday:false,limit_controls_scanned_bytes:false,dry_run_zero_proves_free_script:false,standard_sql:true,use_query_cache:false,automatically_raise_cap:false,complete_rest_removes_sql_limit:false};
g3.push(entry('F','execution_configuration',{configurations:configs,questions:Object.keys(executionPolicy)},{configurations:configExpected,policy:executionPolicy},{authority:['scripts/test-export-checks.mjs','scripts/run-export-checks.mjs']}));
const identity={projectId:'example-project',location:'US',jobId:'job-a'};
const transportSchema={fields:[{name:'integer',type:'INTEGER'},{name:'decimal',type:'NUMERIC'},{name:'precise_timestamp',type:'TIMESTAMP'},{name:'nested',type:'RECORD',fields:[{name:'values',type:'INTEGER',mode:'REPEATED'},{name:'label',type:'STRING'}]}]};
const rawRow={f:[{v:'9007199254740993'},{v:'0.000000001'},{v:'1788220800000001'},{v:{f:[{v:[{v:'1'},{v:'9007199254740993'}]},{v:null}]}}]};
const rawPage=(rows=[],extra={})=>({jobReference:identity,jobComplete:true,totalRows:String(rows.length),schema:transportSchema,rows,...extra});
const pages=[rawPage([rawRow],{totalRows:'2',pageToken:'p2'}),rawPage([rawRow],{totalRows:'2'})];
const transportTrials=[{pages},{pages:[rawPage([rawRow],{totalRows:'2'})]},{pages:[rawPage([],{jobComplete:false})]},{pages:[rawPage([],{pageToken:'same'}),rawPage([],{pageToken:'same'})]},{pages:[rawPage([])]}];
const decodedRow={integer:'9007199254740993',decimal:'0.000000001',precise_timestamp:'1788220800000001',nested:{values:['1','9007199254740993'],label:null}};
const transportExpected=[{accepted:true,rows:[decodedRow,decodedRow],total_rows:'2',page_count:2},...Array.from({length:3},()=>({accepted:false,rows:null,total_rows:null,page_count:null})),{accepted:true,rows:[],total_rows:'0',page_count:1}];
g3.push(entry('G','result_pages',{identity,schema:transportSchema,format_options:{useInt64Timestamp:true},trials:transportTrials.map(t=>({pages:t.pages.map(p=>project(p,Object.keys(p).filter(k=>!['schema','jobReference'].includes(k))))}))},transportExpected,{authority:['scripts/test-export-checks.mjs','scripts/run-export-checks.mjs'],derivation:'Independent exact nested transport literals, verified against actual decoder/collector'}));
const resumeExpected={initial_submission_count:8,unchanged_resume_submission_count:0,unchanged_resume_same_handles:true,original_report_unchanged:true,changed_config_rejected:true,changed_wrapper_rejected:true,changed_template_rejected:true,missing_handle_replacement_count:0,missing_handle_state:'retrieval_pending_or_failed',failed_handle_replacement_count:0,failed_handle_state:'query_failed'};
g3.push(entry('H','resume',{scenario:{inventory:'all eight current templates',prior:'successful saved report after first execution',trials:['resume unchanged','change end date only','change wrapper bytes only','change sessions template bytes only','recorded handle returns HTTP 404','recorded handle is DONE with native error']},questions:Object.keys(resumeExpected)},resumeExpected,{authority:['scripts/test-export-checks.mjs','scripts/run-export-checks.mjs']}));
assert.deepEqual(g3[6].input.trials.map(t=>({pages:t.pages.map(p=>({...p,schema:g3[6].input.schema,jobReference:g3[6].input.identity}))})),transportTrials);
for(const [label,data] of Object.entries({companion:{events:C.events,labels:cLabels},parameter:{events:P.events,labels:pLabels},legacy:{events:L.events,labels:lLabels}})){
 const transformed=data.labels.apply(data.events);for(let i=0;i<data.events.length;i++)for(const [k,v] of Object.entries(data.events[i]))if(!['visitor','user','user_pseudo_id','transaction','transaction_id'].includes(k))assert.deepEqual(transformed[i][k],v,label+': unchanged raw '+k);
}
const expected=[g1,g2,g3].map(g=>({cases:g.map(c=>c.expected)}));
// Verify every scored array ordering using visible projection fields. This is sorting,
// not a second session/transaction engine; no hidden native evidence JSON is required.
function cmp(a,b){if(a===b)return 0;if(a===null)return -1;if(b===null)return 1;if(typeof a==='number'&&typeof b==='number')return a<b?-1:1;if(Array.isArray(a)&&Array.isArray(b)){for(let i=0;i<Math.min(a.length,b.length);i++){const n=cmp(a[i],b[i]);if(n)return n;}return a.length-b.length;}return Buffer.compare(Buffer.from(String(a)),Buffer.from(String(b)));}
function ordered(rows,keys){const sorted=rows.slice().sort((a,b)=>{for(const [key,desc] of keys.map(k=>Array.isArray(k)?k:[k,false])){const n=cmp(a[key],b[key]);if(n)return desc?-n:n;}return 0;});assert.deepEqual(rows,sorted,'visible projection ordering: '+keys);}
ordered(g1[4].expected.result,[['sessions',true],'source_system','source_scope','landing_page_path']);
ordered(g1[5].expected.result,[['sessions',true],'source_system','source_scope','session_last_click_source','session_last_click_medium','landing_url_status','landing_utm_source','landing_utm_medium','landing_utm_campaign']);
ordered(g2[3].expected.result,['event_timestamp','source_system','source_scope','user_pseudo_id','ga_session_id','event_name','event_date','event_value_in_usd']);
ordered(g2[4].expected.result,['source_system','source_scope','session_key']);ordered(g2[5].expected.result,['table_date']);ordered(g2[7].expected.result.daily_observations,['table_date']);
for(const c of g3.slice(0,3)){const r=c.expected.result;ordered(r.daily_summary,['event_date']);ordered(r.qualified_transactions,compactTxKeys);ordered(r.item_lines,[...compactTxKeys,'item_offset']);ordered(r.unkeyed_evidence,['event_date','event_timestamp_micros',...compactTxKeys,'occurrence_count','reasons']);}
for(const r of g3[3].expected.result)ordered(r.daily_summary,['event_date']);
ordered(g3[4].expected.result,['event_date',['sessions',true],'channel']);for(const r of g3[4].expected.result)assert.deepEqual(r.native_channel_groups,r.native_channel_groups.slice().sort((a,b)=>cmp(a,b)));
assert.deepEqual(L.click_id_names,['gclid','dclid','gbraid','wbraid','msclkid','fbclid','ttclid','rdt_cid','li_fat_id','twclid','epik','sccid','srsltid']);

const groups=[['sessions-and-source-evidence',g1,pools],['parameters-and-observation-boundaries',g2,paramPools],['transactions-and-execution',g3,txPools]];
const contract=fs.readFileSync(path.join(root,'references/evaluation-output-contract.md'),'utf8');
const shared=contract.split('## Shared interface\n')[1].split('\n## ')[0];
const floatNames=new Set(['value','known_subtotal','purchase_revenue_usd','engagement_time_msec','engagement_time_sec','event_value_in_usd','pct_null_user','pct_crossing_midnight']);
const isFloat=p=>floatNames.has(p.split('/').at(-1))&&!p.endsWith('/quantity/value');
const pointer=s=>s.replaceAll('~','~0').replaceAll('/','~1');
function checks(v,p=''){
 if(Array.isArray(v))return [{path:p,op:'array_length_equals',expected:v.length},...v.flatMap((x,i)=>checks(x,p+'/'+i))];
 if(v&&typeof v==='object')return Object.entries(v).flatMap(([k,x])=>checks(x,p+'/'+pointer(k)));
 return [{path:p,op:typeof v==='number'&&isFloat(p)?'approximately':'equals',expected:v,...(typeof v==='number'&&isFloat(p)?{tolerance:1e-9}:{})}];
}
const nullableStrings=new Set(['visitor_key','user_pseudo_id','session_key','platform','stream_id','transaction_id','source_system','source_scope','landing_page_location','landing_page_path','page_location','session_source','session_medium','session_engaged','session_last_click_source','session_last_click_medium','landing_utm_source','landing_utm_medium','landing_utm_campaign','reporting_timezone','billing_project','location','maximum_bytes_billed','total_rows','item_id']);
const nullableNumbers=new Set(['ga_session_id','all_population_unique_purchase_count','page_count']);
function schema(values,key='',at=''){
 const kinds=new Map();
 for(const v of values){const type=v===null?'null':Array.isArray(v)?'array':typeof v==='number'?(isFloat(at)?'number':'integer'):typeof v;const k=type==='object'?type+':'+Object.keys(v).sort().join('|'):type;if(!kinds.has(k))kinds.set(k,{type,values:[]});kinds.get(k).values.push(v);}
 if(nullableStrings.has(key))return {type:['string','null']};
 if(nullableNumbers.has(key))return {type:['integer','null']};
 if(floatNames.has(key)&&!at.endsWith('/quantity/value'))return {type:[values.some(v=>typeof v==='string')?'string':'number','null']};
 if(at.endsWith('/quantity/value'))return {type:['integer','null']};
 const choices=[...kinds.values()].map(({type,values:vs})=>{
  if(type==='object'){const ks=Object.keys(vs[0]);return {type,properties:Object.fromEntries(ks.map(k=>[k,schema(vs.map(v=>v[k]),k,at+'/'+k)])),required:ks,additionalProperties:false};}
  if(type==='array')return {type,items:vs.flat().length?schema(vs.flat(),'',at+'/*'):{type:'string'}};
  return {type};
 });return choices.length===1?choices[0]:{anyOf:choices};
}
const manifest={context_files:['SKILL.md','references/evaluation-quick-reference.md'],groups:groups.map(([id,g,pool],i)=>({id,prompt:'Apply the declared reports to the supplied pools, then return the ordered projection. Use the following public output contract.\n\n'+shared+'\n\n'+contract.split('## '+id+'\n')[1].split('\n## ')[0],input:{pools:pool,cases:g.map(c=>c.input)},output_schema:schema([expected[i]]),checks:checks(expected[i])}))};
for(const g of manifest.groups)for(const c of E.cases)assert.ok(!JSON.stringify(g.input).includes(c.id),'private fixture id leaked');
const manifestPath=path.join(root,'references/eval-cases.json'),serialized=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--write'))fs.writeFileSync(manifestPath,serialized);
assert.equal(fs.readFileSync(manifestPath,'utf8'),serialized,'deterministic manifest freshness');
// Real wrapper operations only. These mocks exercise the production transport protocol,
// not BigQuery execution or a second implementation of the report business logic.
let wrapperAssertions=0;
for(let i=0;i<configs.length;i++){let v;try{const c=validateConfig(configs[i]);v={accepted:true,billing_project:c.billingProject,location:c.location,maximum_bytes_billed:c.maximumBytesBilled};}catch{v={accepted:false,billing_project:null,location:null,maximum_bytes_billed:null};}assert.deepEqual(v,configExpected[i]);wrapperAssertions++;}
assert.deepEqual(decodeRows(transportSchema,[rawRow]),[decodedRow]);wrapperAssertions++;
for(let i=0;i<transportTrials.length;i++){
 let value,n=0;try{const result=await collectResults(async()=>{const p=transportTrials[i].pages[n++];assert.ok(p);return p;},identity);value={accepted:true,rows:result.rows,total_rows:result.totalRows,page_count:result.pages.length};}catch{value={accepted:false,rows:null,total_rows:null,page_count:null};}assert.deepEqual(value,transportExpected[i]);wrapperAssertions++;
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ga4-eval-'));
let nativeAudit=null;
const originalLog=console.log, mockLog=[];
try{
 console.log=(...args)=>mockLog.push(args.join(' '));
 const config=validateConfig(configs[0]);let submissions=0;
 const mock={versions:async()=>({offline:true}),submit:async()=>{submissions++;return {code:0,stdout:'offline',stderr:''};},metadata:async j=>({jobReference:{...identity,jobId:j.jobId},configuration:{query:{query:j.query,useLegacySql:false,useQueryCache:false,maximumBytesBilled:DEFAULT_CAP}},status:{state:'DONE'},statistics:{query:{totalBytesProcessed:'0',totalBytesBilled:'0'}}}),page:async j=>({...rawPage([]),jobReference:{...identity,jobId:j.jobId}})};
 const first=await runChecks({config,report:path.join(temp,'first.json')},{transport:mock});assert.equal(first.report.state,'completed');const before=fs.readFileSync(first.path),initial=submissions;
 const again=await runChecks({config,resumeReport:first.path,report:path.join(temp,'again.json')},{transport:mock});
 const actualResume={initial_submission_count:initial,unchanged_resume_submission_count:submissions-initial,unchanged_resume_same_handles:JSON.stringify(first.report.jobs.map(j=>j.jobId))===JSON.stringify(again.report.jobs.map(j=>j.jobId)),original_report_unchanged:before.equals(fs.readFileSync(first.path))};
 for(const [name,args,deps] of [['changed_config_rejected',{config:{...config,end:'20260904'}},{}],['changed_wrapper_rejected',{}, {wrapperHash:'changed'}]]){let rejected=false;try{await runChecks({config,resumeReport:first.path,report:path.join(temp,name+'.json'),...args},{transport:mock,...deps});}catch{rejected=true;}actualResume[name]=rejected;}
 const copied=path.join(temp,'sql');fs.cpSync(path.join(root,'references/sql'),copied,{recursive:true});fs.appendFileSync(path.join(copied,'sessions.sql'),'\n-- offline mutation\n');let rejected=false;try{await runChecks({config,resumeReport:first.path,report:path.join(temp,'changed-template.json')},{transport:mock,sqlDir:copied});}catch{rejected=true;}actualResume.changed_template_rejected=rejected;
 for(const [kind,metadata] of [['missing',async()=>{throw new Error('HTTP 404 missing job');}],['failed',async j=>({...await mock.metadata(j),status:{state:'DONE',errorResult:{reason:'invalidQuery',message:'offline native error'}}})]]){
  const prior=submissions;const outcome=await runChecks({config,resumeReport:first.path,report:path.join(temp,kind+'.json')},{transport:{...mock,metadata}});actualResume[kind+'_handle_replacement_count']=submissions-prior;actualResume[kind+'_handle_state']=outcome.report.jobs[0].state;
 }
 assert.deepEqual(actualResume,resumeExpected);wrapperAssertions++;console.log=originalLog;
 // Private retained evidence is optional for portable offline verification. It is never model context.
 if(option('--native-index')){
  const indexPath=option('--native-index'),index=JSON.parse(fs.readFileSync(indexPath));const reports={};const audited=[];
  for(const [kind,ref] of Object.entries(index.reports)){
   const bytes=fs.readFileSync(ref.path);assert.equal(hash(bytes),ref.sha256);const r=JSON.parse(bytes);assert.equal(r.status,'passed');reports[kind]=r;
   const fixtureName={parameter:'parameter-diagnostic',companion:'companion-session',ecommerce:'ecommerce'}[kind];assert.equal(r.fixtureSha256,hash(fs.readFileSync(path.join(root,'references',fixtureName+'-fixtures.json'))));
   const runnerName={parameter:'test-parameter-diagnostics.mjs',companion:'test-companion-sessions.mjs',ecommerce:'test-ecommerce.mjs'}[kind];assert.equal(r.runnerSha256??r.sourceHashes.runner,hash(fs.readFileSync(path.join(root,'scripts',runnerName))));
   for(const [name,h] of Object.entries(r.sourceHashes??{})){if(['runner','canonical'].includes(name))continue;assert.equal(h,hash(fs.readFileSync(path.join(root,name==='parameterHelpers'?'scripts/parameter-helpers.sql':'references/sql/'+name+'.sql'))));}
   if(r.sqlSha256)assert.equal(r.sqlSha256,hash(fs.readFileSync(path.join(root,'references/sql/ecommerce.sql'))));
   for(const j of r.jobs){assert.equal(hash(j.query),j.querySha256);assert.equal(j.jobMetadata.status.state,'DONE');assert.ok(!j.jobMetadata.status.errorResult);assert.equal(j.jobMetadata.configuration.query.query,j.query);assert.equal(j.jobMetadata.configuration.query.useLegacySql,false);assert.equal(j.jobMetadata.configuration.query.useQueryCache,false);assert.equal(String(j.jobMetadata.configuration.query.maximumBytesBilled),'1073741824');assert.equal(j.result.code,0);const parsed=JSON.parse(j.result.stdout),rows=Array.isArray(parsed.at(-1))?parsed.at(-1):parsed;assert.deepEqual(rows,j.rawRows);const output=rows.length===1&&Object.hasOwn(rows[0],'result_json')?JSON.parse(rows[0].result_json):rows;if(j.parsedOutput)assert.deepEqual(output,j.parsedOutput);j.auditOutput=output;audited.push({kind,label:j.label,job_id:j.jobId,query_sha256:j.querySha256,full_output_sha256:hash(JSON.stringify(output))});}
  }
  // Full native outputs are retained above; compare literal full goldens or their originally
  // declared projection. Only BigQuery scalar type encodings are normalized here.
  function compare(a,e,p=''){
   if(Array.isArray(e)){assert.ok(Array.isArray(a),p);assert.equal(a.length,e.length,p);e.forEach((v,i)=>compare(a[i],v,p+'/'+i));return;}
   if(e&&typeof e==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort(),p);for(const k of Object.keys(e))compare(a[k],e[k],p+'/'+k);return;}
   if(typeof e==='number'){assert.ok(typeof a==='number'||typeof a==='string',p);assert.ok(Number.isFinite(Number(a)),p);assert.ok(Math.abs(Number(a)-e)<=Math.max(1,Math.abs(e))*1e-12,p);return;}
   if(typeof e==='boolean'&&['true','false'].includes(a))a=a==='true';assert.deepEqual(a,e,p);
  }
  const job=(kind,label)=>{const j=reports[kind].jobs.find(j=>j.label===label);assert.ok(j,[kind,label]);return j.auditOutput;};
  for(const name of ['params','key_events','ui_reconciliation','channel_daily','landing_pages','traffic_source_compare'])compare(job('parameter',name),P.expected[name],name);
  compare(job('parameter','ui-empty'),P.expected.empty_ui_reconciliation);
  compare(job('parameter','sessions').map((r,i)=>project(r,Object.keys(P.expected.sessions[i]))),P.expected.sessions);
  const cs=job('companion','sessions');compare(C.expected_sessions.map(e=>project(cs.find(r=>r.session_key===e.session_key),Object.keys(e))),C.expected_sessions);
  compare(job('companion','landing_pages'),C.expected_landing);compare(job('companion','traffic_source_compare'),C.expected_traffic);
  const legacy=job('parameter','legacy-integration-sessions');for(const [visitor,e] of Object.entries(L.expected.visitors))compare(project(legacy.find(r=>r.visitor_key===visitor),Object.keys(e)),e);
  for(const k of L.click_id_names)assert.equal(legacy.find(r=>r.visitor_key==='synthetic-multi').click_ids[k],`synthetic-${k}`);
  const ld=job('parameter','legacy-integration-channel-daily');for(const e of L.expected.daily)compare(project(ld.find(r=>r.event_date===e.event_date&&r.channel===e.channel),Object.keys(e)),e);
  for(const f of E.cases)compare(job('ecommerce',f.id),f.expected,f.id);
  for(const [relative,h] of Object.entries(index.current_source_hashes))assert.equal(hash(fs.readFileSync(path.join(root,relative))),h,relative);
  nativeAudit={index_sha256:hash(fs.readFileSync(indexPath)),reports:Object.fromEntries(Object.entries(index.reports).map(([k,v])=>[k,v.sha256])),complete_native_jobs_verified:audited.length,jobs:audited};
 }
 const harness=process.env.GA4_EVAL_HARNESS??path.resolve(root,'../../scripts/run-skill-evals.py');assert.equal(hash(fs.readFileSync(harness)),'b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45');
 fs.writeFileSync(path.join(temp,'expected.json'),JSON.stringify(expected));
 const python=String.raw`
import copy,hashlib,importlib.util,json,pathlib,re,sys
spec=importlib.util.spec_from_file_location('h',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
root=pathlib.Path(sys.argv[2]);manifest,hashes,sha=h.validate_manifest(root);expected=json.loads(pathlib.Path(sys.argv[3]).read_text());contexts={f:(root/f).read_text() for f in manifest['context_files']}
assert h.HARNESS_VERSION=='2026-09-08.3';assert manifest['context_files']==['SKILL.md','references/evaluation-quick-reference.md']
try:
 import tiktoken
 enc=tiktoken.get_encoding('cl100k_base');tokens=lambda t:len(enc.encode(t));tokenizer='cl100k_base estimate; not model-specific tokenization'
except ImportError:
 tokens=lambda t:(len(t.encode('utf8'))+2)//3;tokenizer='UTF8 bytes/3 conservative estimate; not model-specific tokenization'
def evaluate(g,x):return h.evaluate_call({'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','message':{'content':json.dumps(x)}}},'qwen3:4b',g,h.prompt_for(g),'offline','offline','offline')
def score(g,x):return sum(c['passed'] for c in evaluate(g,x)['check_status'])
def fields(x,p=''):
 if isinstance(x,list):return [(p,'array_length_equals')]+[a for i,v in enumerate(x) for a in fields(v,p+'/'+str(i))]
 if isinstance(x,dict):return [a for k,v in x.items() for a in fields(v,p+'/'+k.replace('~','~0').replace('/','~1'))]
 return [(p,'scalar')]
def setpath(x,p,v,remove=False):
 parts=p.split('/')[1:];a=x
 for k in parts[:-1]:a=a[int(k)] if isinstance(a,list) else a[k.replace('~1','/').replace('~0','~')]
 k=int(parts[-1]) if isinstance(a,list) else parts[-1].replace('~1','/').replace('~0','~')
 if remove:del a[k]
 else:a[k]=v
mutants=[];summaries=[];sizes=[];vocabulary=[]
for gi,(g,e) in enumerate(zip(manifest['groups'],expected)):
 assert [c['case'] for c in g['input']['cases']]==list('ABCDEFGH')
 assert h.schema_type_ok(e,g['output_schema']),g['id'];assert score(g,e)==len(g['checks']),evaluate(g,e)
 assert sorted(fields(e))==sorted((c['path'],'array_length_equals' if c['op']=='array_length_equals' else 'scalar') for c in g['checks'])
 request=h.prompt_for(g);altered=copy.deepcopy(g);altered['checks']=[{'path':'/hidden','op':'equals','expected':'EXPECTED_ONLY_SENTINEL_41c9'}]
 assert h.prompt_for(altered)==request
 for condition in ['with-skill','without-skill']:
  system=h.system_prompt(condition,contexts);assert 'EXPECTED_ONLY_SENTINEL_41c9' not in system+request
 assert 'checks' not in json.loads(request)
 assert '##' not in h.system_prompt('without-skill',contexts) or 'Compact GA4 operational reference' not in h.system_prompt('without-skill',contexts)
 assert 'first matching array record' in request or 'first matching array record' in '\n'.join(contexts.values()) or 'first matching array offset' in '\n'.join(contexts.values())
 text=request+'\n'+'\n'.join(contexts.values());derived=[]
 for c in g['checks']:
  v=c['expected']
  if isinstance(v,str) and v not in text:
   assert re.fullmatch(r'v[0-9]+\.-?[0-9]+',v) or re.fullmatch(r'\d{4}-\d{2}-\d{2}',v) or (c['path'].endswith('/landing_page_path') and v.startswith('/')) or (c['path'].endswith(('/landing_utm_source','/landing_utm_medium','/landing_utm_campaign'))), (g['id'],c['path'],v)
   derived.append(c['path'])
 vocabulary.append({'group':g['id'],'missing_nonderived_literals':0,'derived_string_paths':derived})
 # One check per scalar and array length; meaningful mutations target every count, status,
 # key, null, money and Boolean rather than comparing whole numeric arrays strictly.
 tested_fields=set()
 for c in g['checks']:
  if c['op']=='array_length_equals':continue
  p=c['path'];v=c['expected']
  if p.endswith(('/case','/source_system','/source_scope','/event_date','/observation_scope','/limitations')):continue
  if not (v is None or isinstance(v,(bool,int,float)) or p.endswith(('/status','/revenue_status','/channel','/session_source','/session_medium','/page_location','/session_key','/transaction_id','/missing_identifier_cause','/table_existence','/export_completeness','/missing_handle_state','/failed_handle_state'))):continue
  field=p.split('/')[-1]
  if field in tested_fields:continue
  tested_fields.add(field)
  bad=(not v) if isinstance(v,bool) else 0 if v is None else v+1 if isinstance(v,(int,float)) else v+'WRONG'
  x=copy.deepcopy(e);setpath(x,p,bad);assert score(g,x)<len(g['checks']);mutants.append(g['id']+':'+p)
 tested_arrays=0
 for c in g['checks']:
  if c['op']!='array_length_equals':continue
  if tested_arrays>=2:break
  tested_arrays+=1
  x=copy.deepcopy(e);_,a=h.json_pointer(x,c['path']);a.append(copy.deepcopy(a[0]) if a else 'extra');assert score(g,x)<len(g['checks']);mutants.append(g['id']+':extra:'+c['path'])
  _,orig=h.json_pointer(e,c['path'])
  if len(orig)>1 and orig!=list(reversed(orig)):
   x=copy.deepcopy(e);setpath(x,c['path'],list(reversed(orig)));assert score(g,x)<len(g['checks']);mutants.append(g['id']+':order:'+c['path'])
  if orig:
   x=copy.deepcopy(e);_,a=h.json_pointer(x,c['path']);a.pop();assert score(g,x)<len(g['checks']);mutants.append(g['id']+':missing:'+c['path'])
 # Actual parser/schema errors: extra fields, missing nested fields, nonfinite values, wrong bool/count.
 leaf=next(c for c in g['checks'] if c['op']!='array_length_equals')
 for kind in ['extra','missing','nan','inf','minus_inf']:
  x=copy.deepcopy(e)
  if kind=='extra':x['cases'][0]['unexpected']=True
  elif kind=='missing':setpath(x,leaf['path'],None,True)
  else:setpath(x,leaf['path'],{'nan':float('nan'),'inf':float('inf'),'minus_inf':float('-inf')}[kind])
  assert not h.schema_type_ok(x,g['output_schema']);assert evaluate(g,x)['errors'];mutants.append(g['id']+':schema:'+kind)
 for c in g['checks']:
  if type(c['expected']) is bool or type(c['expected']) is int:
   x=copy.deepcopy(e);setpath(x,c['path'],1 if type(c['expected']) is bool else True);assert score(g,x)<len(g['checks']);mutants.append(g['id']+':type:'+c['path']);break
 # Explicit familiar wrong mechanisms have distinct failed checks.
 named=[('/cases/2/result/0/session_medium','paid_social')] if gi==0 else [('/cases/0/result/0/page_location','https://example.test/forged'),('/cases/2/result/0/ga_session_id',3)] if gi==1 else [('/cases/0/result/diagnostics/qualified_transaction_count',1),('/cases/3/result/1/daily_summary/0/value',7),('/cases/3/result/3/daily_summary/0/known_subtotal',0),('/cases/0/result/item_lines/0/revenue_usd/value',100),('/cases/2/result/daily_summary/1/all_population_unique_purchase_count',1),('/cases/7/result/unchanged_resume_submission_count',8)]
 for p,bad in named:
  x=copy.deepcopy(e);setpath(x,p,bad);assert score(g,x)<len(g['checks']);mutants.append(g['id']+':semantic:'+p)
 malformed={'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','message':{'content':'{not JSON'}}}
 assert h.evaluate_call(malformed,'qwen3:4b',g,request,'offline','offline','offline')['errors'];mutants.append(g['id']+':malformed_json')
 # Every approximate scalar permits equivalent int/float spelling but excludes bool.
 for c in g['checks']:
  if c['op']=='approximately':assert h.compare({**c,'path':''},float(c['expected']))['passed'];assert not h.compare({**c,'path':''},True)['passed']
 out=json.dumps(e,ensure_ascii=False,indent=2);n=tokens(request+h.system_prompt('with-skill',contexts));o=tokens(out)
 sizes.append({'group':g['id'],'request_and_context_estimated_tokens':n,'output_estimated_tokens':o,'output_headroom':8192-o,'context_plus_8192':n+8192})
 summaries.append({'group':g['id'],'cases':len(e['cases']),'checks':len(g['checks'])})
print(json.dumps({'status':'passed','manifest_sha256':sha,'context_hashes':hashes,'harness_sha256':h.harness_hash(),'groups':summaries,'mutations':len(mutants),'mutation_paths':mutants,'vocabulary_audit':vocabulary,'tokenizer':tokenizer,'sizes':sizes}))
`;
 const run=spawnSync(process.env.GA4_EVAL_PYTHON??'python3',['-c',python,harness,root,path.join(temp,'expected.json')],{encoding:'utf8',maxBuffer:8*1024*1024});
 if(run.status!==0){process.stderr.write(run.stderr);throw new Error('frozen scorer verification failed');}
 const report=JSON.parse(run.stdout);for(const size of report.sizes){assert.ok(size.context_plus_8192<=28000,JSON.stringify(size));assert.ok(size.output_estimated_tokens<=5000,JSON.stringify(size));}
 report.wrapper_offline_assertions=wrapperAssertions;report.wrapper_transport='offline mocks only; zero credential/API requests';report.visible_ordering_assertions='all scored arrays use declared projection keys or explicit selector/pool order';report.native_evidence=nativeAudit;report.identity_projection={companion:{users:cLabels.users,transactions:cLabels.transactions},parameter:{users:pLabels.users,transactions:pLabels.transactions},legacy:{users:lLabels.users,transactions:lLabels.transactions},ecommerce:Object.fromEntries(Object.entries(txLabels).map(([k,v])=>[k,{users:v.users,transactions:v.transactions}]))};report.private_case_origins=provenance.map((p,i)=>({group:groups[Math.floor(i/8)][0],...p}));
 const sources=['scripts/test-eval-manifest.mjs','scripts/run-export-checks.mjs','scripts/session-ctes.sql','scripts/parameter-helpers.sql',...['sessions','channel_daily','landing_pages','traffic_source_compare','params','key_events','ui_reconciliation','ecommerce'].map(n=>'references/sql/'+n+'.sql'),...['companion-session','parameter-diagnostic','ecommerce','integration'].map(n=>'references/'+n+'-fixtures.json'),'references/evaluation-output-contract.md','references/evaluation-quick-reference.md'];
 report.source_hashes=Object.fromEntries(sources.map(n=>[n,hash(fs.readFileSync(path.join(root,n)))]));report.accepted_pins_verified=PINNED;report.sql_execution='NO SQL EXECUTED';report.model_calls=0;report.created_at=new Date().toISOString();
 if(option('--evidence')){const out=option('--evidence');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
 console.log(JSON.stringify({status:report.status,groups:report.groups,mutations:report.mutations,sizes:report.sizes,manifest_sha256:report.manifest_sha256,wrapper_offline_assertions:wrapperAssertions,retained_native_jobs:nativeAudit?.complete_native_jobs_verified??null,sql_execution:report.sql_execution,model_calls:0},null,2));
 // A copied skill may point at the shared scorer through GA4_EVAL_HARNESS; no sibling skill required.
 if(!process.argv.includes('--standalone-child')){
  const copy=path.join(temp,'standalone');fs.mkdirSync(copy);for(const folder of ['scripts','references'])fs.cpSync(path.join(root,folder),path.join(copy,folder),{recursive:true});fs.copyFileSync(path.join(root,'SKILL.md'),path.join(copy,'SKILL.md'));
  const child=spawnSync(process.execPath,[path.join(copy,'scripts/test-eval-manifest.mjs'),'--standalone-child'],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,GA4_EVAL_HARNESS:harness}});assert.equal(child.status,0,child.stderr);console.log('PASS copied standalone manifest verification with explicit shared scorer. NO SQL EXECUTED.');
 }
}finally{console.log=originalLog;fs.rmSync(temp,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseCollectorTimestamp } from '../assets/collector/timestamp.mjs';
import { handleCollect, __internal } from '../assets/collector/core.js';
import { createPgDatabase } from '../assets/collector/transaction-db.mjs';
if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--connected') throw new TypeError('Usage: test-identity-capture.mjs [--connected]');
let assertions=0; const check=(method,...args)=>{assertions+=1;return assert[method](...args);};
const timestampGoldens=[
 ['2026-09-03T12:00:00Z','2026-09-03T12:00:00.000000Z'],
 ['2026-09-03T12:00:00.1Z','2026-09-03T12:00:00.100000Z'],
 ['2026-09-03T12:00:00.12Z','2026-09-03T12:00:00.120000Z'],
 ['2026-09-03T12:00:00.123Z','2026-09-03T12:00:00.123000Z'],
 ['2026-09-03T12:00:00.1234Z','2026-09-03T12:00:00.123400Z'],
 ['2026-09-03T12:00:00.12345Z','2026-09-03T12:00:00.123450Z'],
 ['2026-09-03T12:00:00.123456Z','2026-09-03T12:00:00.123456Z'],
 ['2026-09-03T12:00:00.1234567Z','2026-09-03T12:00:00.123456Z'],
 ['2026-09-03T12:00:00.12345678Z','2026-09-03T12:00:00.123456Z'],
 ['2026-09-03T12:00:00.123456789Z','2026-09-03T12:00:00.123456Z'],
 ['2026-09-03T14:00:00.123456789+02:00','2026-09-03T12:00:00.123456Z'],
 ['2026-09-03T07:00:00.123456789-05:00','2026-09-03T12:00:00.123456Z'],
 ['1969-12-31T23:59:59.999999999Z','1969-12-31T23:59:59.999999Z'],
 ['0001-01-01T00:00:00.000000001Z','0001-01-01T00:00:00.000000Z'],
 ['9999-12-31T23:59:59.999999999Z','9999-12-31T23:59:59.999999Z'],
 ['0004-02-29T00:00:00Z','0004-02-29T00:00:00.000000Z'],
 ['2000-02-29T00:00:00Z','2000-02-29T00:00:00.000000Z'],
 ['2026-09-03T14:00:00+14:00','2026-09-03T00:00:00.000000Z'],
 ['2026-09-03T00:00:00-14:00','2026-09-03T14:00:00.000000Z'],
];
const invalid=[null,undefined,42,{},'', '2026-01-01','2026-01-01T00:00:00','2026-01-01 00:00:00Z','2026-01-01t00:00:00z','2026-01-01T00:00:00.Z','2026-01-01T00:00:00.1234567890Z','2026-01-01T00:00:00Z\n',' 2026-01-01T00:00:00Z','2026-02-29T00:00:00Z','1900-02-29T00:00:00Z','0001-02-29T00:00:00Z','0000-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z','2026-01-00T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T23:60:00Z','2026-01-01T23:59:60Z','2026-01-01T00:00:00+14:01','2026-01-01T00:00:00-15:00','2026-01-01T00:00:00+00:60','0001-01-01T00:00:00+00:01','9999-12-31T23:59:59-00:01'];
for(const [original,postgres] of timestampGoldens)check('deepEqual',parseCollectorTimestamp(original),{original,postgres});
let transactions=0;
for(const occurred_at of invalid){
 check('throws',()=>parseCollectorTimestamp(occurred_at),TypeError);
 const result=await handleCollect({site_key:'capture_test',visitor_uid:'browser',event_type:'identify',occurred_at},{},{transaction(){transactions+=1;throw new Error('invalid timestamp opened transaction');}});
 check('equal',result.status,400);
}
check('equal',transactions,0);
const emailHash='619cffe43033c9965ff3f07855f3b589494e6b689003b2f86d9a577785f9da95';
const phoneHash='36a2cef4ff9bf7a1abd2a93359136b870393be4106e6c5d19b72ff564f9deca4';
check('equal',await __internal.sha256Hex(__internal.canonicalizeEmail(' Capture@Example.Test ')),emailHash);
check('equal',await __internal.sha256Hex(__internal.canonicalizePhone('+1 (415) 555-0123')),phoneHash);
const deterministic=assertions;
console.log(`PASS identity capture deterministic tests: ${timestampGoldens.length} timestamp goldens, ${invalid.length} rejected timestamps before transaction, ${deterministic} assertions`);
if(process.argv[2]==='--connected'){
 const database=new URL(process.env.DATABASE_URL||'missing://invalid'),collector=new URL(process.env.COLLECTOR_URL||'missing://invalid');
 if(process.env.PIXEL_DISPOSABLE_TEST!=='1'||database.hostname!=='127.0.0.1'||database.pathname!=='/pixel_test'||collector.hostname!=='127.0.0.1'||!process.env.PIXEL_TRANSACTION_RUNTIME)throw new Error('Requires owned disposable database/collector');
 const require=createRequire(join(process.env.PIXEL_TRANSACTION_RUNTIME,'package.json')),{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL}),db=createPgDatabase(pool);
 const started=new Date().toISOString(),reportPath=join(homedir(),'Downloads',`first-party-pixel-identity-capture-native-evidence-${started.replaceAll(/[^0-9]/g,'')}.json`);
 const report={started_at:started,status:'running',node:process.version,pg:require('pg/package.json').version,queries:[],requests:[],deterministic_assertions:deterministic,source_sha256:{}};
 for(const name of ['assets/collector/core.js','assets/collector/timestamp.mjs','assets/schema.sql','references/sql/identity_touches.sql','references/sql/identity_observations.sql'])report.source_sha256[name]=createHash('sha256').update(await readFile(new URL('../'+name,import.meta.url))).digest('hex');
 const save=async()=>{await mkdir(join(homedir(),'Downloads'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');};
 const query=async(text,params=[])=>{try{const r=await db.query(text,params);report.queries.push({text,params,rows:r.rows});return r.rows;}catch(error){report.queries.push({text,params,error:{message:error.message,code:error.code}});throw error;}};
 const tables=['visitors','events','contacts','identity_links','touchpoints','conversion_events','consent_state','identity_observations'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async(table)=>[table,(await query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM pixel.${table} r`))[0].rows])));
 const post=async(payload,expected=204)=>{const response=await fetch(collector,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},body:JSON.stringify(payload)});const body=await response.text();report.requests.push({payload,status:response.status,body});check('equal',response.status,expected,body);};
 const cases=[
  {id:'touch-low',type:'pageview',at:'2026-09-03T12:00:00.123456001Z',pg:'2026-09-03T12:00:00.123456Z'},
  {id:'touch-high',type:'pageview',at:'2026-09-03T12:00:00.123456999Z',pg:'2026-09-03T12:00:00.123456Z'},
  {id:'email-low',type:'identify',at:'2026-09-03T12:00:00.123456001Z',pg:'2026-09-03T12:00:00.123456Z',identity:{email:' Capture@Example.Test '},email:emailHash},
  {id:'email-high',type:'identify',at:'2026-09-03T12:00:00.123456999Z',pg:'2026-09-03T12:00:00.123456Z',identity:{email:'capture@example.test'},email:emailHash},
  {id:'offset-equal',type:'identify',at:'2026-09-03T14:00:00.123456001+02:00',pg:'2026-09-03T12:00:00.123456Z',identity:{email:'capture@example.test'},email:emailHash},
  {id:'pre-epoch',type:'form_submit',at:'1969-12-31T23:59:59.999999999Z',pg:'1969-12-31T23:59:59.999999Z',identity:{phone:'+1 (415) 555-0123'},phone:phoneHash,visitor:'phone-browser'},
  {id:'missing-identity',type:'identify',at:'2026-09-03T12:01:00Z',pg:'2026-09-03T12:01:00.000000Z'},
  {id:'invalid-identity',type:'form_submit',at:'2026-09-03T12:02:00.000001Z',pg:'2026-09-03T12:02:00.000001Z',identity:{email:'not-an-email',phone:'4155550123'}},
  {id:'minimum',type:'identify',at:'0001-01-01T00:00:00.000000001Z',pg:'0001-01-01T00:00:00.000000Z'},
  {id:'maximum',type:'identify',at:'9999-12-31T23:59:59.999999999Z',pg:'9999-12-31T23:59:59.999999Z'},
 ];
 try{
  report.server_version=(await query('SHOW server_version'))[0].server_version;
  await query("INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES ('capture_test','example.test','{}')");
  for(const c of cases)await post({site_key:'capture_test',visitor_uid:c.visitor||'capture-browser',event_type:c.type,occurred_at:c.at,url:'https://example.test/',click_ids:{gclid:'Capture+Click'},identity:c.identity,properties:{capture_case:c.id,value:0,currency:'USD'}});
  const eventRows=await query(`SELECT e.id::text AS id,e.visitor_id::text AS visitor_id,e.properties->>'capture_case' AS label,e.occurred_at_iso,
   to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS native_time FROM pixel.events e WHERE site_key='capture_test'`);
  check('equal',eventRows.length,cases.length);
  const events=new Map(eventRows.map((row)=>[row.label,row]));
  for(const c of cases)check('deepEqual',events.get(c.id),{id:events.get(c.id).id,visitor_id:events.get(c.id).visitor_id,label:c.id,occurred_at_iso:c.at,native_time:c.pg},`${c.id}: independent event timestamp golden`);
  const obsSql=await readFile(new URL('../references/sql/identity_observations.sql',import.meta.url),'utf8'),touchSql=await readFile(new URL('../references/sql/identity_touches.sql',import.meta.url),'utf8');
  const exports=(await query(obsSql)).filter((row)=>row.source_scope==='capture_test');
  const expected=cases.filter((c)=>['identify','form_submit'].includes(c.type)).map((c)=>({source_system:'first_party_pixel',source_scope:'capture_test',visitor_key:events.get(c.id).visitor_id,observation_key:events.get(c.id).id,occurred_at:c.at,source_event_type:c.type,email_hash:c.email??null,phone_hash:c.phone??null,identity_input_format:'canonical_sha256_v1',identity_normalization_version:'0.1.0',capture_status:c.email||c.phone?'eligible':'no_valid_identity'}));
  const byKey=(a,b)=>a.observation_key<b.observation_key?-1:1;
  check('deepEqual',[...exports].sort(byKey),[...expected].sort(byKey),'full independent qualified identity export goldens');report.expected_identity_exports=expected;report.actual_identity_exports=exports;
  check('equal',new Set(exports.map((row)=>row.observation_key)).size,8,'multiple source events retained independently');
  for(const c of cases.filter((row)=>row.type==='form_submit'))check('deepEqual',(await query(`SELECT occurred_at_iso,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS native_time FROM pixel.conversion_events WHERE event_id=$1`,[events.get(c.id).id]))[0],{occurred_at_iso:c.at,native_time:c.pg});
  for(const c of cases.filter((row)=>row.type==='pageview'))check('deepEqual',(await query(`SELECT occurred_at_iso,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS native_time FROM pixel.touchpoints WHERE event_id=$1`,[events.get(c.id).id]))[0],{occurred_at_iso:c.at,native_time:c.pg},`${c.id}: independent native touch timestamp golden`);
  const touches=(await query(touchSql)).filter((row)=>row.source_scope==='capture_test');check('equal',touches.length,2);
  check('deepEqual',touches.map((row)=>row.occurred_at).sort(),[cases[0].at,cases[1].at],'same native microsecond retains distinct exact nanoseconds');
  check('equal',events.get('touch-low').native_time,events.get('touch-high').native_time);
  check('equal',events.get('email-low').native_time,events.get('offset-equal').native_time);
  // Independent exact-instant check, not a graph call: original text retains
  // the information needed for an inclusive as_of cutoff within one native µs.
  const ns = (iso) => {
    const fraction = /\.(\d{1,9})(?=Z|[+-]\d{2}:\d{2}$)/.exec(iso)?.[1] ?? '';
    const whole = iso.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/,'');
    return BigInt(Date.parse(whole))*1000000n + BigInt(fraction.padEnd(9,'0'));
  };
  const cutoff = ns('2026-09-03T12:00:00.123456001Z');
  const boundaryLabels = ['email-low','email-high','offset-equal'];
  const exactIncluded = boundaryLabels.filter((id)=>ns(exports.find((row)=>row.observation_key===events.get(id).id).occurred_at)<=cutoff);
  check('deepEqual',exactIncluded,['email-low','offset-equal'],'inclusive exact original-ns cutoff excludes later same-µs observation');
  check('equal',ns(cases[2].at),ns(cases[4].at),'equivalent offset instants');
  const nativeIncluded = await query("SELECT event_id::text AS id FROM pixel.identity_observations WHERE site_key='capture_test' AND occurred_at <= '2026-09-03T12:00:00.123456Z'");
  check('ok',boundaryLabels.every((id)=>nativeIncluded.some((row)=>row.id===events.get(id).id)),'native µs cannot alone distinguish the exact cutoff');
  const originals=await query("SELECT * FROM pixel.identity_observations WHERE site_key='capture_test' ORDER BY event_id");
  check('equal',JSON.stringify(originals).includes('capture@example.test'),false);check('equal',JSON.stringify(originals).includes('4155550123'),false);
  for(const row of originals){check('deepEqual',Object.keys(row).sort(),['event_id','site_key','visitor_id','source_event_type','occurred_at','occurred_at_iso','email_hash','phone_hash','identity_input_format','identity_normalization_version','capture_status','recorded_at'].sort());check('ok',row.recorded_at);}
  await assert.rejects(query('UPDATE pixel.identity_observations SET email_hash=email_hash WHERE event_id=$1',[exports[0].observation_key]),(e)=>{check('equal',e.code,'55000');return true;});
  check('deepEqual',await query("SELECT * FROM pixel.identity_observations WHERE site_key='capture_test' ORDER BY event_id"),originals,'attempted update changed no bytes');
  const duplicate=exports[0].observation_key;
  await assert.rejects(query('INSERT INTO pixel.identity_observations SELECT * FROM pixel.identity_observations WHERE event_id=$1',[duplicate]),(e)=>{check('equal',e.code,'23505');return true;});
  for(const [hash,status] of [[emailHash.toUpperCase(),'eligible'],['a'.repeat(63),'eligible'],['g'.repeat(64),'eligible'],[null,'eligible'],[emailHash,'no_valid_identity']])await assert.rejects(query(`INSERT INTO pixel.identity_observations(event_id,site_key,visitor_id,source_event_type,occurred_at,occurred_at_iso,email_hash,identity_input_format,identity_normalization_version,capture_status) VALUES (gen_random_uuid(),'capture_test',$1,'identify','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z',$2,'canonical_sha256_v1','0.1.0',$3)`,[events.get('email-low').visitor_id,hash,status]),(e)=>{check('equal',e.code,'23514');return true;});
  const beforeInvalid=await snapshot();
  for(const occurred_at of invalid)await post({site_key:'capture_test',visitor_uid:'invalid-browser',event_type:'identify',occurred_at},400);
  check('deepEqual',await snapshot(),beforeInvalid,'all rejected timestamps preserve all eight tables');
  // Actual pre-upgrade-style rows stay unknown after repeated schema application.
  await query("INSERT INTO pixel.events(site_key,visitor_id,event_type,occurred_at) VALUES ('capture_test',$1,'identify','2026-09-02T00:00:00.123456Z')",[events.get('email-low').visitor_id]);
  await query("INSERT INTO pixel.touchpoints(site_key,visitor_id,channel,occurred_at) VALUES ('capture_test',$1,'Display','2026-09-02T00:00:00.123456Z')",[events.get('email-low').visitor_id]);
  await query("INSERT INTO pixel.conversion_events(site_key,visitor_id,event_name,occurred_at) VALUES ('capture_test',$1,'legacy','2026-09-02T00:00:00.123456Z')",[events.get('email-low').visitor_id]);
  const beforeSchema=await snapshot(),schema=await readFile(new URL('../assets/schema.sql',import.meta.url),'utf8');
  await query(schema);await query(schema);check('deepEqual',await snapshot(),beforeSchema,'schema replay preserves historical NULL and immutable observations');
  const legacy=(await query(touchSql)).find((row)=>row.source_scope==='capture_test'&&row.export_status==='legacy_requires_reclassification');check('equal',legacy.occurred_at,'2026-09-02T00:00:00.123456Z','legacy native timestamp retains six digits without fabricated original');
  check('equal',(await query(obsSql)).filter((row)=>row.source_scope==='capture_test').length,8,'no observation fabricated for historical identify/link');
  for(const table of ['events','touchpoints','conversion_events'])check('ok',beforeSchema[table].some((row)=>row.site_key==='capture_test'&&row.occurred_at_iso===null),`${table}: legacy original remains NULL`);
  // Tenant retention deletes remain allowed; append-only does not mean undeletable.
  await query("INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES ('capture_retention','example.test','{}')");
  await post({site_key:'capture_retention',visitor_uid:'retention-browser',event_type:'identify',occurred_at:'2026-09-03T12:00:00Z'});
  check('equal',(await query("SELECT count(*)::int AS n FROM pixel.identity_observations WHERE site_key='capture_retention'"))[0].n,1);
  await query("DELETE FROM pixel.sites WHERE site_key='capture_retention'");
  for(const table of ['visitors','identity_observations'])check('equal',(await query(`SELECT count(*)::int AS n FROM pixel.${table} WHERE site_key='capture_retention'`))[0].n,0,`${table}: retention cascade allowed`);
  check('equal',(await query("SELECT count(*)::int AS n FROM pixel.events WHERE site_key='capture_retention'"))[0].n,1,'existing partitioned raw-event retention remains separate from tenant FK cascades');
  report.final_snapshot=await snapshot();report.native_assertions=assertions-deterministic;report.completed_at=new Date().toISOString();report.status='passed';await save();
  console.log(`PASS native identity capture: ${cases.length} source fixture events plus retention request, 8 full observation export goldens, ${report.native_assertions} assertions; evidence ${reportPath}`);
 }catch(error){report.status='failed';report.failure=String(error.stack||error);report.completed_at=new Date().toISOString();await save();throw error;}finally{await pool.end();}
}

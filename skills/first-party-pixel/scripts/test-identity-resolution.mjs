import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPgDatabase } from '../assets/collector/transaction-db.mjs';
if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--connected')throw new TypeError('Usage: test-identity-resolution.mjs [--connected]');
if(process.argv[2]!=='--connected'){
 const env={...process.env};delete env.DATABASE_URL;
 const result=spawnSync('bash',[fileURLToPath(new URL('./roundtrip.sh',import.meta.url))],{env,stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);
}
const database=new URL(process.env.DATABASE_URL||'missing://invalid'),collector=new URL(process.env.COLLECTOR_URL||'missing://invalid');
if(process.env.PIXEL_DISPOSABLE_TEST!=='1'||database.hostname!=='127.0.0.1'||database.pathname!=='/pixel_test'||collector.hostname!=='127.0.0.1'||!process.env.PIXEL_TRANSACTION_RUNTIME)throw new Error('Requires owned disposable database and collector');
const require=createRequire(join(process.env.PIXEL_TRANSACTION_RUNTIME,'package.json')),{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5}),db=createPgDatabase(pool);
const started=new Date().toISOString(),reportPath=join(homedir(),'Downloads',`first-party-pixel-identity-resolution-native-evidence-${started.replaceAll(/[^0-9]/g,'')}.json`);
const report={started_at:started,status:'running',node:process.version,pg:require('pg/package.json').version,queries:[],requests:[],steps:[],mutants:[],source_sha256:{}};
let assertions=0;
const check=(method,...args)=>{assertions+=1;return assert[method](...args);};
const hash=(s)=>createHash('sha256').update(s).digest('hex');
const fmt='canonical_sha256_v1',site='resolution_test';
for(const name of ['assets/collector/core.js','assets/schema.sql','references/sql/identity_contacts.sql'])report.source_sha256[name]=hash(await readFile(new URL('../'+name,import.meta.url)));
const save=async()=>{await mkdir(join(homedir(),'Downloads'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');};
const query=async(text,params=[])=>{try{const r=await db.query(text,params);report.queries.push({text,params,rows:r.rows});return r.rows;}catch(e){report.queries.push({text,params,error:{message:e.message,code:e.code}});throw e;}};
const tables=['visitors','events','contacts','identity_links','touchpoints','conversion_events','consent_state','identity_observations'];
const snapshot=async()=>{const result={};for(const table of tables)result[table]=(await query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM pixel.${table} r`))[0].rows;return result;};
let sequence=0;
const payload=(visitor_uid,identity,event_type='identify',site_key=site)=>({site_key,visitor_uid,event_type,identity,event_name:event_type==='track'?'purchase':null,occurred_at:'2026-09-03T12:00:00.000000001Z',url:'https://example.test/',click_ids:{gclid:'Resolution+Click'},properties:{resolution_sequence:sequence++,value:0,currency:'USD'}});
const post=async(p)=>{const r=await fetch(collector,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},body:JSON.stringify(p)});const body=await r.text();report.requests.push({payload:p,status:r.status,body});check('equal',r.status,204,body);return p;};
const step=async(name,callback)=>{const before=await snapshot();await callback();report.steps.push({name,before,after:await snapshot()});await save();};
const contacts=()=>query('SELECT * FROM pixel.contacts WHERE site_key=$1 ORDER BY id',[site]);
const byEmail=async(email)=>(await query('SELECT * FROM pixel.contacts WHERE site_key=$1 AND email_hash=$2',[site,hash(email)]))[0];
const linkIds=async(visitor)=>(await query('SELECT l.contact_id::text AS id FROM pixel.identity_links l JOIN pixel.visitors v ON v.id=l.visitor_id WHERE v.site_key=$1 AND v.visitor_uid=$2 ORDER BY l.contact_id',[site,visitor])).map(x=>x.id);
const seed=async(name,{email=null,phone=null,email_hash=email?hash(email):null,phone_hash=phone?hash(phone):null,email_hash_format=null,phone_hash_format=null}={})=>{
 const id=`00000000-0000-4000-8000-${String(seed.count++).padStart(12,'0')}`;
 await query('INSERT INTO pixel.contacts(id,site_key,email_canonical,email_hash,phone_e164,phone_hash,email_hash_format,phone_hash_format,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,site,email,email_hash,phone,phone_hash,email_hash_format,phone_hash_format,'2000-01-01T00:00:00Z']);return{id,name};
};seed.count=1;
const expectedSnapshots=[];
function expectContact(id,{email=null,phone=null,emailFormat=null,phoneFormat=null,emailStatus=email?'attested':'missing',phoneStatus=phone?'attested':'missing',capture=email||phone?'eligible':'no_attested_identity'}){expectedSnapshots.push({source_system:'first_party_pixel',source_scope:site,contact_key:id,email_hash:email,phone_hash:phone,email_hash_format:emailFormat,phone_hash_format:phoneFormat,email_hash_status:emailStatus,phone_hash_status:phoneStatus,capture_status:capture});}
let scratch;
try{
 report.postgres_version=(await query('SHOW server_version'))[0].server_version;
 await query("INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES('resolution_test','example.test','{}'),('resolution_other','example.test','{}')");
 let main;
 await step('unique email create, fill phone, reverse phone lookup',async()=>{
  await post(payload('email-first',{email:'Main@Example.Test'}));main=await byEmail('main@example.test');check('ok',main);
  await post(payload('email-fill',{email:'main@example.test',phone:'+14155551001'}));
  await post(payload('phone-reverse',{phone:'+1 (415) 555-1001'}));
  const now=await byEmail('main@example.test');check('equal',now.id,main.id);check('equal',now.phone_e164,'+14155551001');check('equal',now.phone_hash,hash('+14155551001'));check('equal',now.email_hash_format,fmt);check('equal',now.phone_hash_format,fmt);
  check('deepEqual',await linkIds('phone-reverse'),[main.id]);check('equal',(await contacts()).length,1);
 });
 expectContact(main.id,{email:hash('main@example.test'),phone:hash('+14155551001'),emailFormat:fmt,phoneFormat:fmt});
 const a=await seed('ambiguous-current-email',{email:'ambiguous@example.test',email_hash_format:fmt});
 const b=await seed('ambiguous-current-phone',{phone:'+14155551002',phone_hash_format:fmt});
 await step('disjoint current email and phone stay ambiguous',async()=>{
  const before=await contacts();await post(payload('ambiguous-current',{email:'ambiguous@example.test',phone:'+14155551002'},'form_submit'));
  check('deepEqual',await contacts(),before);check('deepEqual',await linkIds('ambiguous-current'),[]);
  check('equal',(await query("SELECT contact_id FROM pixel.conversion_events c JOIN pixel.visitors v ON v.id=c.visitor_id WHERE v.site_key=$1 AND visitor_uid='ambiguous-current'",[site]))[0].contact_id,null);
 });
 expectContact(a.id,{email:hash('ambiguous@example.test'),emailFormat:fmt});expectContact(b.id,{phone:hash('+14155551002'),phoneFormat:fmt});
 const mixedA=await seed('mixed-current-email',{email:'mixed@example.test',phone:'+14155551999',email_hash_format:fmt});
 const mixedB=await seed('mixed-legacy-phone',{email:'old-unverified@example.test',phone_hash:hash('+14155551003')});
 await step('ambiguous mixed legacy candidate re-proven per kind without filling raw',async()=>{
  const before=await contacts();await post(payload('ambiguous-legacy',{email:'mixed@example.test',phone:'+14155551003'},'form_submit'));
  check('deepEqual',await linkIds('ambiguous-legacy'),[]);const rows=await contacts();check('equal',rows.length,before.length);
  const row=rows.find(x=>x.id===mixedB.id);check('equal',row.phone_hash_format,fmt);check('equal',row.phone_e164,null);check('equal',row.email_hash_format,null);check('equal',rows.find(x=>x.id===mixedA.id).phone_hash_format,null);
  check('equal',(await query("SELECT c.contact_id FROM pixel.conversion_events c JOIN pixel.visitors v ON v.id=c.visitor_id WHERE v.site_key=$1 AND visitor_uid='ambiguous-legacy'",[site]))[0].contact_id,null);
 });
 expectContact(mixedA.id,{email:hash('mixed@example.test'),emailFormat:fmt,phoneStatus:'legacy_unverified'});
 expectContact(mixedB.id,{phone:hash('+14155551003'),phoneFormat:fmt,emailStatus:'legacy_unverified'});
 const partial=await seed('incompatible raw phone',{email:'partial@example.test',phone:'+14155551998',phone_hash:null});
 const sameRaw=await seed('matching raw phone',{email:'same-raw@example.test',phone:'+14155551004',phone_hash:null});
 const missingRaw=await seed('missing raw matching hash',{phone_hash:hash('+14155551005'),email:'untouched@example.test'});
 const incompatibleEmail=await seed('incompatible raw email',{email:'legacy-wrong@example.test',email_hash:hash('reproved@example.test')});
 await step('unique fills, immutable legacy values and selective provenance',async()=>{
  await post(payload('partial',{email:'partial@example.test',phone:'+14155551006'}));
  let row=(await contacts()).find(x=>x.id===partial.id);check('equal',row.phone_e164,'+14155551998');check('equal',row.phone_hash,null);check('equal',row.phone_hash_format,null);check('equal',row.email_hash_format,fmt);
  await post(payload('same-raw',{email:'same-raw@example.test',phone:'+14155551004'}));row=(await contacts()).find(x=>x.id===sameRaw.id);check('equal',row.phone_hash,hash('+14155551004'));check('equal',row.phone_e164,'+14155551004');
  await post(payload('missing-raw',{phone:'+14155551005'}));row=(await contacts()).find(x=>x.id===missingRaw.id);check('equal',row.phone_e164,'+14155551005');check('equal',row.email_hash_format,null);
  await post(payload('incompatible-email',{email:'reproved@example.test'}));row=(await contacts()).find(x=>x.id===incompatibleEmail.id);check('equal',row.email_canonical,'legacy-wrong@example.test');check('equal',row.email_hash,hash('reproved@example.test'));check('equal',row.email_hash_format,fmt);
  const mainBefore=await byEmail('main@example.test');await post(payload('do-not-overwrite',{email:'different-new@example.test',phone:'+14155551001'}));check('deepEqual',await byEmail('main@example.test'),mainBefore);check('equal',(await query('SELECT count(*)::int AS n FROM pixel.contacts WHERE site_key=$1 AND email_hash=$2',[site,hash('different-new@example.test')]))[0].n,0);
 });
 expectContact(partial.id,{email:hash('partial@example.test'),emailFormat:fmt});
 expectContact(sameRaw.id,{email:hash('same-raw@example.test'),phone:hash('+14155551004'),emailFormat:fmt,phoneFormat:fmt});
 expectContact(missingRaw.id,{phone:hash('+14155551005'),phoneFormat:fmt,emailStatus:'legacy_unverified'});
 expectContact(incompatibleEmail.id,{email:hash('reproved@example.test'),emailFormat:fmt});
 const unknown=await seed('unknown legacy',{email:'unknown-raw@example.test',email_hash:'legacy-noncanonical'});expectContact(unknown.id,{emailStatus:'legacy_unverified'});
 await step('missing invalid identity creates observations but no contact or link',async()=>{
  const before=await contacts();await post(payload('missing',undefined));await post(payload('invalid',{email:'invalid',phone:'4155551000'},'form_submit'));check('deepEqual',await contacts(),before);check('deepEqual',await linkIds('missing'),[]);check('deepEqual',await linkIds('invalid'),[]);
  check('deepEqual',(await query("SELECT o.capture_status FROM pixel.identity_observations o JOIN pixel.visitors v ON v.id=o.visitor_id WHERE v.site_key=$1 AND v.visitor_uid IN ('missing','invalid') ORDER BY v.visitor_uid",[site])).map(x=>x.capture_status),['no_valid_identity','no_valid_identity']);
 });
 await step('shared visitor never establishes historical or future native ownership',async()=>{
  await post(payload('shared',undefined,'pageview'));await post(payload('shared',undefined,'track'));await post(payload('shared',{email:'main@example.test'}));await post(payload('shared',undefined,'pageview'));await post(payload('shared',undefined,'track'));await post(payload('shared',{phone:'+14155551002'}));await post(payload('shared',undefined,'pageview'));await post(payload('shared',undefined,'track'));await post(payload('shared',{phone:'+14155551002'},'form_submit'));
  check('deepEqual',await linkIds('shared'),[main.id,b.id].sort());
  check('ok',(await query('SELECT t.contact_id FROM pixel.touchpoints t JOIN pixel.visitors v ON v.id=t.visitor_id WHERE v.site_key=$1 AND visitor_uid=$2',[site,'shared'])).every(x=>x.contact_id===null));
  const conv=await query('SELECT c.event_name,c.contact_id FROM pixel.conversion_events c JOIN pixel.visitors v ON v.id=c.visitor_id WHERE v.site_key=$1 AND visitor_uid=$2',[site,'shared']);check('equal',conv.length,4);check('ok',conv.filter(x=>x.event_name==='purchase').every(x=>x.contact_id===null));check('equal',conv.find(x=>x.event_name==='form_submit').contact_id,b.id);
  const visitor=(await query('SELECT id FROM pixel.visitors WHERE site_key=$1 AND visitor_uid=$2',[site,'shared']))[0].id;
  await query("INSERT INTO pixel.touchpoints(site_key,visitor_id,contact_id,channel,occurred_at) VALUES($1,$2,$3,'Paid Search','2026-09-02T00:00:00Z')",[site,visitor,main.id]);await query("INSERT INTO pixel.conversion_events(site_key,visitor_id,contact_id,event_name,occurred_at) VALUES($1,$2,$3,'historical','2026-09-02T00:00:00Z')",[site,visitor,main.id]);
  const before=await snapshot();await post(payload('shared',{phone:'+14155551002'}));const after=await snapshot();check('deepEqual',after.touchpoints,before.touchpoints);check('deepEqual',after.conversion_events,before.conversion_events);
 });
 let concurrent;
 await step('concurrent same identifier requests wait for site transaction lock',async()=>{
  const client=await pool.connect();const pending=[];
  try{
   await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pixel.identity:'||$1,0))",[site]);
   pending.push(post(payload('concurrent-a',{email:'concurrent@example.test'})),post(payload('concurrent-b',{email:'concurrent@example.test'})));
   let waiters=[];
   for(let i=0;i<100;i++){waiters=await query("SELECT pid,locktype,granted FROM pg_locks WHERE locktype='advisory' AND NOT granted");if(waiters.length>=2)break;await new Promise(r=>setTimeout(r,10));}
   check('equal',waiters.length,2,'both native request transactions blocked on site lock');report.concurrent_waiters=waiters;
   await client.query('COMMIT');
  }finally{await client.query('ROLLBACK');client.release();}
  await Promise.all(pending);const rows=await query('SELECT * FROM pixel.contacts WHERE site_key=$1 AND email_hash=$2',[site,hash('concurrent@example.test')]);check('equal',rows.length,1);concurrent=rows[0];check('deepEqual',await linkIds('concurrent-a'),[concurrent.id]);check('deepEqual',await linkIds('concurrent-b'),[concurrent.id]);
 });
 expectContact(concurrent.id,{email:hash('concurrent@example.test'),emailFormat:fmt});
 await step('different sites remain separate',async()=>{
  await post(payload('other-site',{email:'main@example.test'},'identify','resolution_other'));
  const row=(await query("SELECT id FROM pixel.contacts WHERE site_key='resolution_other' AND email_hash=$1",[hash('main@example.test')]))[0];check('notEqual',row.id,main.id);
 });
 await step('schema provenance constraints and no historical default/backfill',async()=>{
  for(const [name,format] of [[unknown.id,fmt],[unknown.id,'unknown'],[partial.id,fmt]]){
   const column=name===partial.id?'phone_hash_format':'email_hash_format';await assert.rejects(query(`UPDATE pixel.contacts SET ${column}=$1 WHERE id=$2`,[format,name]),e=>{check('equal',e.code,'23514');return true;});
  }
  const before=await snapshot(),schema=await readFile(new URL('../assets/schema.sql',import.meta.url),'utf8');await query(schema);await query(schema);check('deepEqual',await snapshot(),before);
 });
 const exports=(await query(await readFile(new URL('../references/sql/identity_contacts.sql',import.meta.url),'utf8'))).filter(x=>x.source_scope===site);
 const times=new Map((await query("SELECT id::text AS id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp FROM pixel.contacts WHERE site_key=$1",[site])).map(x=>[x.id,x.stamp]));
 const expected=expectedSnapshots.map(x=>({...x,native_created_at:times.get(x.contact_key)}));
 const sort=(a,b)=>a.contact_key<b.contact_key?-1:1;
 check('deepEqual',[...exports].sort(sort),[...expected].sort(sort),'complete independent current contact export goldens, with actual native generated IDs/time as provenance');report.expected_contact_exports=expected;report.actual_contact_exports=exports;
 check('equal',JSON.stringify(exports).includes('@example.test'),false);check('equal',JSON.stringify(exports).includes('+1415555'),false);check('equal',exports.find(x=>x.contact_key===unknown.id).capture_status,'no_attested_identity');
 // Execute realistic old-policy mutants against native PostgreSQL inside an
 // enclosing rollback; no mutated runtime is deployed or retained in the server.
 scratch=await mkdtemp(join(tmpdir(),'pixel-resolver-mutants-'));await writeFile(join(scratch,'package.json'),'{"type":"module"}');
 for(const file of ['timestamp.mjs','identity-normalization.mjs','channel-taxonomy.mjs'])await copyFile(new URL('../assets/collector/'+file,import.meta.url),join(scratch,file));
 const source=await readFile(new URL('../assets/collector/core.js',import.meta.url),'utf8');
 const variants=[
  ['email-first','AND (email_hash = $2 OR phone_hash = $3)','AND (email_hash = $2 OR (FALSE AND phone_hash = $3))',payload('mutant-ambiguous',{email:'ambiguous@example.test',phone:'+14155551002'},'form_submit')],
  ['latest-link','let contactId = null;',"let contactId = (await tx.query('SELECT contact_id FROM pixel.identity_links WHERE visitor_id=$1 ORDER BY created_at DESC LIMIT 1',[visitorId])).rows[0]?.contact_id ?? null;",payload('shared',undefined,'pageview')],
  ['backfill','    // ---- consent',"    if (contactId !== null) await tx.query('UPDATE pixel.touchpoints SET contact_id=$1 WHERE visitor_id=$2 AND contact_id IS NULL',[contactId,visitorId]);\n    // ---- consent",payload('shared',{email:'main@example.test'})],
 ];
 for(const [name,from,to,p] of variants){
  check('equal',source.split(from).length,2);const path=join(scratch,name+'.js');await writeFile(path,source.replace(from,to));const mutant=await import(pathToFileURL(path));const before=await snapshot(),marker=new Error('rollback mutant');let detected=false,detail;
  try{await db.transaction(async(tx)=>{
   try{await mutant.handleCollect(p,{userAgent:'Mozilla/5.0',now:()=>new Date('2026-09-03T13:00:00Z')},{transaction:cb=>cb(tx)});
    const rows=(await tx.query('SELECT t.id,t.contact_id FROM pixel.touchpoints t JOIN pixel.visitors v ON v.id=t.visitor_id WHERE v.site_key=$1 AND v.visitor_uid=$2',[site,'shared'])).rows;
    if(name==='latest-link')detected=rows.length>before.touchpoints.filter(x=>x.site_key===site&&x.visitor_id===before.visitors.find(v=>v.site_key===site&&v.visitor_uid==='shared').id).length&&rows.some(x=>!before.touchpoints.some(y=>y.id===x.id)&&x.contact_id!==null);
    if(name==='backfill')detected=rows.some(x=>before.touchpoints.some(y=>y.id===x.id&&y.contact_id===null)&&x.contact_id!==null);
    detail={rows};
   }catch(error){if(name==='email-first'&&error.code==='23505')detected=true;detail={error:{message:error.message,code:error.code}};}
   throw marker;
  });}catch(error){check('equal',error,marker);}
  check('equal',detected,true,`${name}: native mutant violates independent no-ambiguity/ownership invariant`);check('deepEqual',await snapshot(),before,'mutant native writes rolled back');report.mutants.push({name,detected,detail});
 }
 report.assertions=assertions;report.status='passed';report.completed_at=new Date().toISOString();report.final_snapshot=await snapshot();await save();console.log(`PASS native identity resolution: ${assertions} assertions, ${expected.length} complete contact export goldens, ${report.mutants.length} executed native old-policy mutants; evidence ${reportPath}`);
}catch(error){report.status='failed';report.failure=String(error.stack||error);report.completed_at=new Date().toISOString();await save();throw error;}finally{if(scratch)await rm(scratch,{recursive:true,force:true});await pool.end();}

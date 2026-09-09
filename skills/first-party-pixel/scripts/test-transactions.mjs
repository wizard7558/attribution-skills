import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgDatabase, createPostgresDatabase } from '../assets/collector/transaction-db.mjs';
import { handleCollect } from '../assets/collector/core.js';

if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--connected') throw new TypeError('Usage: test-transactions.mjs [--connected]');
let assertions = 0;
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const input = (visitor_uid = 'atomic-synthetic', event_type = 'pageview') => ({ site_key: 'atomic_test', visitor_uid, event_type, occurred_at: '2026-09-03T12:00:00.000Z', url: 'https://example.test/', click_ids: { gclid: 'Synthetic+Click' } });
const context = { origin: 'https://example.test', userAgent: 'Mozilla/5.0', now: () => new Date('2026-09-03T13:00:00Z'), ip: null };

for (const failure of ['none', 'connect', 'BEGIN', 'callback', 'COMMIT', 'ROLLBACK', 'release']) {
  const history = [], original = new Error(`synthetic ${failure}`), rollback = new Error('synthetic rollback');
  let released;
  const client = { async query(text, params) {
    history.push([text, params]);
    if (text === failure || (failure === 'ROLLBACK' && text === 'ROLLBACK')) throw text === 'ROLLBACK' ? rollback : original;
    return { rows: [{ value: 'synthetic' }] };
  }, release(destroy) { history.push(['release']); released = destroy; if (failure === 'release') throw original; } };
  const pool = { query() { throw new Error('transaction escaped to pool.query'); }, async connect() { history.push(['connect']); if (failure === 'connect') throw original; return client; } };
  const db = createPgDatabase(pool);
  const callback = async (tx) => { const result = await tx.query('work', [1]); check('deepEqual', result.rows, [{ value: 'synthetic' }]); if (failure === 'callback' || failure === 'ROLLBACK') throw original; return 42; };
  if (failure === 'none') check('equal', await db.transaction(callback), 42);
  else await assert.rejects(db.transaction(callback), (error) => { check('equal', error, original, 'original failure preserved'); return true; });
  const expected = failure === 'connect' ? ['connect'] : failure === 'BEGIN' ? ['connect','BEGIN','release'] : failure === 'callback' || failure === 'ROLLBACK' ? ['connect','BEGIN','work','ROLLBACK','release'] : failure === 'COMMIT' ? ['connect','BEGIN','work','COMMIT','ROLLBACK','release'] : ['connect','BEGIN','work','COMMIT','release'];
  check('deepEqual', history.map(([label]) => label), expected);
  if (failure !== 'connect') check('equal', released, failure === 'BEGIN' || failure === 'ROLLBACK', 'uncertain/rollback-failed connection discarded');
}
// Even a throwing release cannot replace a callback failure.
{
  const original = new Error('original'); let releases = 0;
  const db = createPgDatabase({ query() {}, async connect() { return { async query() {}, release() { releases += 1; throw new Error('release'); } }; } });
  await assert.rejects(db.transaction(async () => { throw original; }), (error) => { check('equal', error, original); return true; });
  check('equal', releases, 1);
}
{
  const entered = gate(), proceed = gate(), clients = [], external = [];
  const db = createPgDatabase({ query: (...args) => { external.push(args); return 'outside'; }, async connect() {
    const record = []; clients.push(record); return { async query(text) { record.push(text); return { rows: [] }; }, release(destroy) { record.push(['release',destroy]); } };
  } });
  check('equal', db.query('outside', []), 'outside');
  const one = db.transaction(async (tx) => { await tx.query('one'); entered.resolve(); await proceed.promise; return 'one'; });
  await entered.promise;
  const two = db.transaction(async (tx) => { await tx.query('two'); return 'two'; });
  check('equal', await two, 'two');
  check('deepEqual', clients[0], ['BEGIN','one'], 'callback awaited before COMMIT');
  proceed.resolve(); check('equal', await one, 'one');
  check('deepEqual', clients, [['BEGIN','one','COMMIT',['release',false]],['BEGIN','two','COMMIT',['release',false]]]);
  check('deepEqual', external, [['outside',[]]], 'no transactional query used pool.query');
  await assert.rejects(db.transaction(null), TypeError); assertions += 1;
}
for (const bad of [null, {}, { query() {} }, { connect() {} }]) check('throws', () => createPgDatabase(bad), TypeError);
for (const bad of [null, {}, { unsafe() {} }, { begin() {} }]) check('throws', () => createPostgresDatabase(bad), TypeError);
{
  const events = [], rows = Object.assign([{ value: 7 }], { count: 1 });
  const sql = { async unsafe(text, params) { events.push(['outside',text,params]); return rows; }, async begin(callback) {
    events.push('BEGIN');
    try { const value = await callback({ async unsafe(text, params) { events.push(['inside',text,params]); return rows; } }); events.push('COMMIT'); return value; }
    catch (error) { events.push('ROLLBACK'); throw error; }
  } };
  const db = createPostgresDatabase(sql);
  const out = await db.query('outside'); check('deepEqual', out, { rows: [{ value: 7 }] }); check('notEqual', out.rows, rows);
  const done = gate(), entered = gate();
  const pending = db.transaction(async (tx) => { const result = await tx.query('inside', ['parameter']); entered.resolve(); await done.promise; return result; });
  await entered.promise; check('equal', events.includes('COMMIT'), false);
  done.resolve(); check('deepEqual', await pending, { rows: [{ value: 7 }] });
  const error = new Error('postgres callback');
  await assert.rejects(db.transaction(async () => { throw error; }), (actual) => { check('equal', actual, error); return true; });
  check('deepEqual', events, [['outside','outside',[]],'BEGIN',['inside','inside',['parameter']],'COMMIT','BEGIN','ROLLBACK']);
  await assert.rejects(db.transaction(null), TypeError); assertions += 1;
}
{
  let begun = 0, outside = 0, queries = 0;
  const db = { query() { outside += 1; throw new Error('outside'); }, transaction: async (callback) => { begun += 1; return callback({ query: async () => { queries += 1; return { rows: [] }; } }); } };
  check('equal', (await handleCollect({}, context, db)).status, 400); check('equal', begun, 0);
  await assert.rejects(handleCollect(input(), context, { query() {} }), /interactive transactions/); assertions += 1;
  check('equal', (await handleCollect(input(), context, db)).status, 403); check('equal', begun, 1); check('equal', queries, 1); check('equal', outside, 0);
  const results = async (allowed_origins, ctx) => handleCollect(input(), ctx, { transaction: async (callback) => callback({ query: async (text) => { check('match', text, /^SELECT allowed_origins/); return { rows: [{ allowed_origins }] }; } }) });
  check('equal', (await results(['https://other.test'], context)).status, 403);
  check('equal', (await results([], { ...context, userAgent: 'syntheticbot' })).status, 204);
}
const deterministicAssertions = assertions;
console.log(`PASS transaction helper/core deterministic checks: ${deterministicAssertions} assertions; pg lifecycle/concurrency, postgres.js transaction-local delegation, prevalidation and rejected requests`);

if (process.argv[2] === '--connected') {
  const url = new URL(process.env.DATABASE_URL || 'missing://invalid');
  if (process.env.PIXEL_DISPOSABLE_TEST !== '1' || !['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/pixel_test' || !process.env.PIXEL_TRANSACTION_RUNTIME) throw new Error('Native test requires roundtrip-owned disposable localhost pixel_test database');
  const require = createRequire(join(process.env.PIXEL_TRANSACTION_RUNTIME, 'package.json'));
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const db = createPgDatabase(pool);
  const started = new Date().toISOString();
  const reportPath = join(homedir(), 'Downloads', `first-party-pixel-transaction-native-evidence-${started.replaceAll(/[^0-9]/g,'')}.json`);
  const source = new URL('../assets/collector/', import.meta.url);
  const hashes = Object.fromEntries(await Promise.all(['core.js','timestamp.mjs','transaction-db.mjs','node/server.js','vercel/api/collect.js','cloudflare/worker.js','supabase/index.ts'].map(async (name) => [name,createHash('sha256').update(await readFile(new URL(name,source))).digest('hex')])));
  const report = { started_at: started, completed_at: null, status: 'running', scope: 'roundtrip-owned disposable local PostgreSQL; synthetic data only', driver: { pg: require('pg/package.json').version, postgres_js: 'mocked only; no native postgres.js/Deno runtime claim' }, source_sha256: hashes, deterministic_assertions: deterministicAssertions, queries: [], rollback_cases: [], concurrency: null };
  const save = async () => { await mkdir(join(homedir(),'Downloads'), { recursive:true }); await writeFile(reportPath,JSON.stringify(report,null,2)+'\n'); };
  const tables = ['visitors','events','contacts','identity_links','touchpoints','conversion_events','consent_state','identity_observations'];
  async function snapshot(connection = db) {
    const result = {};
    for (const table of tables) result[table] = (await connection.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), '[]'::jsonb) AS rows FROM pixel.${table} r`)).rows[0].rows;
    return result;
  }
  const logQuery = async (tx,text,params) => { const result = await tx.query(text,params); report.queries.push({ text,params:params??[],rows:result.rows,rowCount:result.rowCount??null }); return result; };
  try {
    report.server_version = (await db.query('SHOW server_version')).rows[0].server_version;
    await db.query("INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES ('atomic_test','example.test','{}'),('atomic_concurrent_success','example.test','{}'),('atomic_concurrent_failure','example.test','{}')");
    // Seed prior state so failed provenance attestation and consent overwrite are also checked.
    check('equal', (await handleCollect(input('existing'), context, db)).status,204);
    check('equal', (await handleCollect({ ...input('existing','consent'),consent:{ analytics:true,ads:false } },context,db)).status,204);
    await db.query("INSERT INTO pixel.contacts(site_key,email_canonical,email_hash) VALUES ('atomic_test','atomic.provenance@example.test',$1)",[createHash('sha256').update('atomic.provenance@example.test').digest('hex')]);
    await db.query("INSERT INTO pixel.contacts(site_key,email_hash) VALUES ('atomic_test',$1)",[createHash('sha256').update('atomic.ambiguous@example.test').digest('hex')]);
    await db.query("INSERT INTO pixel.contacts(site_key,phone_hash) VALUES ('atomic_test',$1)",[createHash('sha256').update('+14155550126').digest('hex')]);
    const rollbackCases = [
      ['observation','INSERT INTO pixel.identity_observations',{ ...input('new-observation','identify'),identity:{email:'atomic.observation@example.test'} }],
      ['event','INSERT INTO pixel.events',input('new-event')],
      ['identity-link','INSERT INTO pixel.identity_links',{ ...input('new-identity','identify'),identity:{email:'atomic.new@example.test'} }],
      ['identity-provenance','UPDATE pixel.contacts',{ ...input('existing','identify'),identity:{email:'atomic.provenance@example.test'} }],
      ['ambiguous-provenance','UPDATE pixel.contacts',{ ...input('ambiguous','identify'),identity:{email:'atomic.ambiguous@example.test',phone:'+14155550126'} }],
      ['touch','INSERT INTO pixel.touchpoints',input('new-touch')],
      ['conversion','INSERT INTO pixel.conversion_events',{ ...input('existing','form_submit'),identity:{email:'atomic.conversion@example.test'},properties:{value:5,currency:'USD'} }],
      ['consent','INSERT INTO pixel.consent_state',{ ...input('existing','consent'),consent:{analytics:false,ads:true} }],
    ];
    for (const [label,needle,payload] of rollbackCases) {
      const before = await snapshot(), failure = new Error(`injected after ${label}`); let injected = false, inside;
      const beforePid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const failingDb = { query() { throw new Error('core used pool query'); }, transaction: (callback) => db.transaction((tx) => callback({ query: async (text,params) => {
        const result = await logQuery(tx,text,params);
        if (text.includes(needle)) { injected=true; inside=await snapshot(tx); throw failure; }
        return result;
      } })) };
      await assert.rejects(handleCollect(payload,context,failingDb), (error) => { check('equal',error,failure); return true; });
      const after = await snapshot();
      check('equal',injected,true,label); check('notDeepEqual',inside,before,`${label}: real writes occurred before failure`);
      check('deepEqual',after,before,`${label}: no partial changes across all eight tables`);
      const afterPid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      check('equal',afterPid,beforePid,'rolled-back connection reusable');
      report.rollback_cases.push({ label,before,inside_before_injected_failure:inside,after,backend_pid_before:beforePid,backend_pid_after:afterPid,passed:true }); await save();
    }
    const good = { ...input('committed','form_submit'), identity:{email:'atomic.committed@example.test'}, properties:{value:0,currency:'USD'} };
    check('equal',(await handleCollect(good,context,db)).status,204);
    const committed = await snapshot();
    const visitor = committed.visitors.find((row)=>row.site_key==='atomic_test'&&row.visitor_uid==='committed');check('ok',visitor);
    check('equal',committed.events.filter((row)=>row.visitor_id===visitor.id).length,1);
    check('equal',committed.identity_links.filter((row)=>row.visitor_id===visitor.id).length,1);
    check('equal',committed.conversion_events.filter((row)=>row.visitor_id===visitor.id).length,1);
    report.successful_commit_snapshot=committed;
    // Both requests have real writes in progress on separate pinned connections.
    const ready = gate(); let arrivals=0; const pids=[]; const failure=new Error('concurrent injected failure');
    function concurrentDb(shouldFail) { return { transaction: (callback) => db.transaction(async (tx) => {
      pids.push((await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      return callback({query: async(text,params)=>{
        const result=await logQuery(tx,text,params);
        if(text.includes('INSERT INTO pixel.visitors')) { arrivals+=1; if(arrivals===2)ready.resolve(); await ready.promise; }
        if(shouldFail&&text.includes('INSERT INTO pixel.conversion_events'))throw failure;
        return result;
      }});
    }) }; }
    const requests=await Promise.allSettled([false,true].map((shouldFail)=>handleCollect({...good,site_key:shouldFail?'atomic_concurrent_failure':'atomic_concurrent_success'},context,concurrentDb(shouldFail))));
    check('equal',requests[0].status,'fulfilled');check('equal',requests[0].value.status,204);check('equal',requests[1].status,'rejected');check('equal',requests[1].reason,failure);check('equal',new Set(pids).size,2);
    const final=await snapshot();
    for(const table of ['visitors','events','contacts','touchpoints','conversion_events'])check('equal',final[table].filter((row)=>row.site_key==='atomic_concurrent_failure').length,0,`${table}: failed request absent`);
    const success=final.visitors.find((row)=>row.site_key==='atomic_concurrent_success');check('ok',success);
    check('equal',final.events.filter((row)=>row.visitor_id===success.id).length,1);check('equal',final.identity_links.filter((row)=>row.visitor_id===success.id).length,1);check('equal',final.conversion_events.filter((row)=>row.visitor_id===success.id).length,1);
    check('equal',(await db.query('SELECT 1 AS reusable')).rows[0].reusable,1);
    report.concurrency={pinned_backend_pids:pids,success_status:204,failure:'injected after conversion write',final_snapshot:final,passed:true};
    report.native_assertions=assertions-deterministicAssertions;report.status='passed';report.completed_at=new Date().toISOString();await save();
    console.log(`PASS native pg atomic transactions: ${rollbackCases.length} injected post-write rollbacks, successful commit, concurrent independent requests; ${report.native_assertions} assertions; evidence ${reportPath}`);
  } catch(error) { report.status='failed';report.failure=String(error.stack||error);report.completed_at=new Date().toISOString();await save();throw error; }
  finally { await pool.end(); }
}

import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { makeConversionId, prepareConversion } from './conversion-events.mjs';

const runtime = process.env.CAPI_OUTBOX_RUNTIME;
const cluster = process.env.CAPI_OUTBOX_CLUSTER;
const port = Number(process.env.CAPI_OUTBOX_PORT);
const evidencePath = process.env.CAPI_OUTBOX_EVIDENCE;
if (!runtime?.startsWith('/tmp/capi-outbox-test-') || cluster !== `${runtime}/cluster` || !fs.existsSync(`${cluster}/PG_VERSION`)
  || !Number.isInteger(port) || port < 1 || !evidencePath) throw new Error('Run the owned-cluster shell harness');
const require = createRequire(`${runtime}/package.json`);
const { Client } = require('pg');
const pgVersion = require('pg/package.json').version;
const sqlPath = new URL('../references/sql/conversion_outbox.sql', import.meta.url);
const sql = fs.readFileSync(sqlPath, 'utf8');
const clients = [];
const evidence = { status: 'running', started_at: new Date().toISOString(), engine: 'isolated local PostgreSQL', node_version: process.version, pg_package: pgVersion, groups: [], source_hashes: {}, external_conversion_calls: 0 };
for (const file of ['../references/sql/conversion_outbox.sql', './test-conversion-outbox.mjs', './test-conversion-outbox.sh', './conversion-events.mjs']) {
  evidence.source_hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex');
}
let assertions = 0;
let currentGroup = 'initialization';
function check(condition, label) { if (!condition) throw new Error(label); assertions += 1; }
function equal(actual, expected, label) { check(isDeepStrictEqual(actual, expected), label); }
async function reject(callback, label, code) {
  let error; try { await callback(); } catch (caught) { error = caught; }
  check(Boolean(error?.code) && (!code || error.code === code), label);
}
async function test(name, fn) {
  currentGroup = name; const start = Date.now(); const before = assertions;
  await fn(); evidence.groups.push({ name, assertions: assertions - before, duration_ms: Date.now() - start, status: 'passed' });
}
async function connect(user = 'capi_test_worker') {
  const client = new Client({ host: '127.0.0.1', port, user, database: 'postgres', password: '', application_name: 'capi-outbox-owned-local-test', options: '-c timezone=UTC -c statement_timeout=5000' });
  await client.connect(); clients.push(client); return client;
}
const destination = (name) => ['meta', 'synthetic-account', name, 'SyntheticPurchase'];
const business = (key) => makeConversionId({ source_system: 'synthetic', source_scope: 'local', conversion_key: key });
const args = (name, key = 'event-1', body = '{"synthetic":true,"amount":0}') => [...destination(name), business(key), `Browser+${key}`, body];
async function enqueue(client, values) { return (await client.query('SELECT * FROM capi_outbox.enqueue_conversion($1,$2,$3,$4,$5,$6,$7)', values)).rows[0]; }
async function claim(client, scope, worker = 'worker-a', lease = 2, batch = 100) {
  return (await client.query('SELECT to_jsonb(c) AS snapshot FROM capi_outbox.claim_conversions($1,$2,$3,$4,$5,$6::numeric,$7::integer) c', [...scope, worker, lease, batch])).rows.map((r) => r.snapshot);
}
async function complete(client, scope, id, worker, token, outcome = 'succeeded', available = null, result = 'OK') {
  return (await client.query('SELECT * FROM capi_outbox.complete_conversion($1,$2,$3,$4,$5,$6,$7::integer,$8,$9,$10::timestamptz)', [...scope, id, worker, token, outcome, result, available])).rows[0];
}
async function snapshot(client, id) { return (await client.query('SELECT to_jsonb(e) AS row FROM capi_outbox.events e WHERE outbox_id=$1', [id])).rows[0]?.row; }
async function histories(client, id) {
  const attempts = (await client.query('SELECT to_jsonb(a) AS row FROM capi_outbox.attempts a WHERE outbox_id=$1 ORDER BY attempt_token', [id])).rows.map((r) => r.row);
  const audit = (await client.query('SELECT to_jsonb(a) AS row FROM capi_outbox.audit a WHERE outbox_id=$1 ORDER BY audit_id', [id])).rows.map((r) => r.row);
  return { attempts, audit };
}
async function until(callback, label, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await callback()) { check(true, label); return; } await new Promise((resolve) => setTimeout(resolve, 15)); }
  check(false, label);
}
let admin;
let c;
try {
  admin = await connect('postgres');
  const server = (await admin.query("SELECT version() AS version,current_setting('server_version_num')::int AS version_num,current_setting('data_directory') AS data_directory,host(inet_server_addr()) AS address,current_setting('server_encoding') AS encoding")).rows[0];
  check(fs.realpathSync(server.data_directory) === fs.realpathSync(cluster) && server.address === '127.0.0.1', 'owned cluster and loopback verified');
  check(server.version_num >= 170000 && server.encoding === 'UTF8', 'PostgreSQL 17+ UTF8');
  check(pgVersion === '8.16.3', 'pinned pg dependency');
  evidence.server_version = server.version; evidence.server_version_num = server.version_num;
  await admin.query(sql); await admin.query(sql);
  check(true, 'DDL applied twice');
  // This role exists only inside the newly owned throwaway cluster, never in reference DDL.
  await admin.query("CREATE ROLE capi_test_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE ON SCHEMA capi_outbox TO capi_test_worker; GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA capi_outbox TO capi_test_worker; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA capi_outbox TO capi_test_worker; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA capi_outbox TO capi_test_worker; CREATE TABLE public.capi_test_business(id integer PRIMARY KEY,value integer); INSERT INTO public.capi_test_business VALUES(1,0); GRANT SELECT,UPDATE ON public.capi_test_business TO capi_test_worker;");
  c = await connect();
  const [a, b, d] = await Promise.all([connect(), connect(), connect()]);
  await test('security-invoker and native schema', async () => {
    check((await c.query("SELECT NOT rolsuper AS ordinary FROM pg_roles WHERE rolname=current_user")).rows[0].ordinary, 'ordinary runtime role');
    check((await c.query("SELECT bool_and(NOT p.prosecdef) AS invoker FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='capi_outbox'")).rows[0].invoker, 'all functions SECURITY INVOKER');
    const constraints = (await c.query("SELECT conname FROM pg_constraint WHERE conrelid='capi_outbox.events'::regclass")).rows.map((r) => r.conname);
    check(constraints.includes('business_destination_unique') && constraints.includes('provider_destination_unique'), 'both destination unique constraints present');
  });
  await test('full persisted enqueue snapshot and exact UTF8 replay', async () => {
    const input = args('persisted', 'exact', ' {"z":"雪+","a":1,"a":2} ');
    const first = await enqueue(c, input); const r = first.snapshot;
    equal(first.disposition, 'inserted', 'initial enqueue inserted');
    equal(r, { outbox_id: r.outbox_id, platform: input[0], account_key: input[1], destination_key: input[2], event_type: input[3], business_conversion_id: input[4], provider_event_id: input[5], request_body: input[6], request_fingerprint: crypto.createHash('sha256').update(input[6], 'utf8').digest('hex'), state: 'queued', attempt_token: 0, worker_key: null, lease_until: null, available_at: r.created_at, created_at: r.created_at, updated_at: r.created_at, completed_at: null }, 'entire initial row contract');
    equal(await snapshot(c, r.outbox_id), r, 'persisted row matches full returned snapshot');
    equal(await enqueue(c, input), { disposition: 'replayed', snapshot: r }, 'exact replay returns unchanged snapshot');
    const h = await histories(c, r.outbox_id);
    equal(h.attempts, [], 'enqueue creates no claims');
    equal(h.audit, [{ audit_id: h.audit[0].audit_id, outbox_id: r.outbox_id, attempt_token: 0, action: 'enqueued', previous_state: null, next_state: 'queued', worker_key: null, result_code: null, recorded_at: r.created_at }], 'full append-only enqueue audit');
    await reject(() => enqueue(c, [...input.slice(0, 6), '{"a":2,"z":"雪+"}']), 'equivalent object different bytes conflict', 'P0001');
    const changedProvider = [...input]; changedProvider[5] = 'changed';
    await reject(() => enqueue(c, changedProvider), 'same business changed provider ID conflict', 'P0001');
    const changedBusiness = [...input]; changedBusiness[4] = business('other');
    await reject(() => enqueue(c, changedBusiness), 'same provider ID other business conflict', 'P0001');
    equal(await snapshot(c, r.outbox_id), r, 'all conflicts preserve the exact persisted row');
  });
  await test('concurrent enqueue unique-index waiting and identical fanout', async () => {
    const input = args('concurrent-held');
    await a.query('BEGIN'); const first = await enqueue(a, input);
    const pending = enqueue(b, input);
    await until(async () => (await admin.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [b.processID])).rows[0]?.waiting, 'concurrent insert actually waits on native lock');
    await a.query('COMMIT'); const second = await pending;
    equal(second, { disposition: 'replayed', snapshot: first.snapshot }, 'concurrent waiter replays committed winner');
    const peers = await Promise.all(Array.from({ length: 8 }, () => connect()));
    const results = await Promise.all(peers.map((client) => enqueue(client, args('concurrent-fanout'))));
    equal(results.filter((r) => r.disposition === 'inserted').length, 1, 'fanout inserts exactly one row');
    equal(new Set(results.map((r) => r.snapshot.outbox_id)).size, 1, 'fanout has one durable identity');
    equal((await histories(c, results[0].snapshot.outbox_id)).audit.length, 1, 'fanout enqueues one audit row');
    const conflictInput = args('concurrent-conflict');
    const conflict = await Promise.allSettled([enqueue(a, conflictInput), enqueue(b, [...conflictInput.slice(0, 6), '{"different":true}'])]);
    equal(conflict.filter((r) => r.status === 'fulfilled').length, 1, 'conflicting race has one winner');
    check(conflict.some((r) => r.status === 'rejected' && r.reason.code === 'P0001'), 'conflicting race explicitly rejected');
  });
  await test('all four destination dimensions remain independent', async () => {
    const original = args('scope-baseline');
    const variants = [original, ...['google', 'other-account', 'other-destination', 'OtherEvent'].map((value, index) => { const row = [...original]; row[index] = value; return row; })];
    const results = await Promise.all(variants.map((row) => enqueue(c, row)));
    equal(new Set(results.map((r) => r.snapshot.outbox_id)).size, 5, 'platform account destination and event type each split identity');
    check(results.every((r) => r.disposition === 'inserted'), 'same business/provider IDs accepted independently by domain');
  });
  await test('pinned transaction business update enqueue and rollback atomicity', async () => {
    await a.query('BEGIN'); await a.query('UPDATE public.capi_test_business SET value=1 WHERE id=1');
    const discarded = await enqueue(a, args('rollback'));
    await a.query('ROLLBACK');
    equal(await snapshot(c, discarded.snapshot.outbox_id), undefined, 'rollback removes event');
    equal(await histories(c, discarded.snapshot.outbox_id), { attempts: [], audit: [] }, 'rollback removes audit and attempts');
    equal((await c.query('SELECT value FROM public.capi_test_business WHERE id=1')).rows[0].value, 0, 'business update rolled back with enqueue');
    await a.query('BEGIN'); await a.query('UPDATE public.capi_test_business SET value=2 WHERE id=1');
    const committed = await enqueue(a, args('commit'));
    await a.query('COMMIT');
    equal((await c.query('SELECT value FROM public.capi_test_business WHERE id=1')).rows[0].value, 2, 'business update committed');
    equal(await snapshot(c, committed.snapshot.outbox_id), committed.snapshot, 'outbox committed with business update');
  });
  await test('SKIP LOCKED excludes actual locks and concurrent claims are disjoint', async () => {
    const scope = destination('locked-claims');
    const rows = [];
    for (let i = 0; i < 4; i += 1) rows.push((await enqueue(c, args(scope[2], `lock-${i}`))).snapshot);
    await a.query('BEGIN'); await a.query('SELECT outbox_id FROM capi_outbox.events WHERE outbox_id=$1 FOR UPDATE', [rows[0].outbox_id]);
    const claimed = await claim(b, scope, 'worker-b');
    equal(claimed.length, 3, 'locked row skipped while others claimed');
    check(claimed.every((r) => r.outbox_id !== rows[0].outbox_id), 'actual locked identity absent');
    await a.query('ROLLBACK');
    equal((await claim(d, scope, 'worker-d')).map((r) => r.outbox_id), [rows[0].outbox_id], 'released row claimable');
    const concurrentScope = destination('parallel-claims');
    for (let i = 0; i < 6; i += 1) await enqueue(c, args(concurrentScope[2], `parallel-${i}`));
    await a.query('BEGIN'); await b.query('BEGIN');
    const [left, right] = await Promise.all([claim(a, concurrentScope, 'left', 2, 3), claim(b, concurrentScope, 'right', 2, 3)]);
    equal([left.length, right.length], [3, 3], 'concurrent batches each claim three');
    equal(new Set([...left, ...right].map((r) => r.outbox_id)).size, 6, 'concurrent claimed identities disjoint');
    equal(await claim(d, concurrentScope, 'observer'), [], 'held claims cannot be claimed by third connection');
    await a.query('COMMIT'); await b.query('COMMIT');
    for (const r of [...left, ...right]) {
      equal(await snapshot(c, r.outbox_id), r, 'full claim snapshot persisted');
      const h = await histories(c, r.outbox_id);
      equal(h.attempts, [{ outbox_id: r.outbox_id, attempt_token: 1, worker_key: r.worker_key, claimed_at: r.updated_at, lease_until: r.lease_until }], 'full immutable attempt snapshot');
      equal(h.audit.map((x) => x.action), ['enqueued', 'claimed'], 'claim audit persisted transactionally');
    }
  });
  await test('claim rollback leaves no attempts or state changes', async () => {
    const inserted = (await enqueue(c, args('claim-rollback'))).snapshot;
    await a.query('BEGIN'); equal((await claim(a, destination('claim-rollback'))).length, 1, 'claim exists inside transaction');
    equal(await claim(b, destination('claim-rollback')), [], 'other connection skips uncommitted claim');
    await a.query('ROLLBACK');
    equal(await snapshot(c, inserted.outbox_id), inserted, 'claim rollback restores entire queued row');
    equal((await histories(c, inserted.outbox_id)).attempts, [], 'claim attempt rolled back');
    equal((await histories(c, inserted.outbox_id)).audit.map((r) => r.action), ['enqueued'], 'claim audit rolled back');
  });
  await test('retry not-before and terminal success replay', async () => {
    const input = args('retry'); const scope = input.slice(0, 4);
    await enqueue(c, input); const r = (await claim(c, scope))[0];
    const future = (await c.query("SELECT (clock_timestamp()+interval '0.3 seconds')::text AS time")).rows[0].time;
    const completed = await complete(c, scope, input[4], 'worker-a', 1, 'retry', future, 'RATE_LIMIT');
    check(completed.applied, 'retry applied');
    check(completed.snapshot.state === 'retry' && completed.snapshot.worker_key === null && completed.snapshot.lease_until === null && completed.snapshot.completed_at === null, 'retry clears lease and remains nonterminal');
    equal(await snapshot(c, r.outbox_id), completed.snapshot, 'full retry snapshot persisted');
    equal(await claim(c, scope), [], 'retry not claimable before available_at');
    await until(async () => (await c.query('SELECT clock_timestamp()>$1::timestamptz AS due', [future])).rows[0].due, 'database retry boundary reached');
    const next = (await claim(c, scope, 'retry-worker'))[0]; equal(next.attempt_token, 2, 'retry increments fencing token');
    const success = await complete(c, scope, input[4], 'retry-worker', 2);
    check(success.applied && success.snapshot.state === 'succeeded' && success.snapshot.completed_at !== null, 'success terminal persisted');
    equal(await snapshot(c, r.outbox_id), success.snapshot, 'full succeeded snapshot persisted');
    equal(await claim(c, scope), [], 'succeeded unclaimable');
    equal(await enqueue(c, input), { disposition: 'replayed', snapshot: success.snapshot }, 'terminal replay does not reset state');
    equal((await histories(c, r.outbox_id)).audit.map((x) => x.action), ['enqueued', 'claimed', 'retry', 'claimed', 'succeeded'], 'retry and success append distinct history');
  });
  await test('permanent failure is terminal and has no implicit resend', async () => {
    const input = args('permanent'); const scope = input.slice(0, 4);
    await enqueue(c, input); await claim(c, scope);
    const result = await complete(c, scope, input[4], 'worker-a', 1, 'permanent_failure', null, 'INVALID_EVENT');
    check(result.applied && result.snapshot.state === 'permanent_failure', 'permanent failure applied');
    equal(await claim(c, scope), [], 'permanent failure unclaimable');
    equal(await enqueue(c, input), { disposition: 'replayed', snapshot: result.snapshot }, 'same payload does not restart permanent failure');
    equal((await histories(c, result.snapshot.outbox_id)).audit.at(-1).result_code, 'INVALID_EVENT', 'only caller sanitized result code stored');
  });
  await test('expired reclaim fences old attempts with immutable expiry history', async () => {
    const input = args('reclaim'); const scope = input.slice(0, 4);
    await enqueue(c, input); const first = (await claim(c, scope, 'old-worker', 0.2))[0];
    check(!(await complete(c, scope, input[4], 'wrong-worker', 1)).applied, 'wrong worker cannot complete');
    check(!(await complete(c, scope, input[4], 'old-worker', 2)).applied, 'wrong attempt cannot complete');
    const oldHistory = await histories(c, first.outbox_id);
    await until(async () => (await c.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [first.lease_until])).rows[0].expired, 'database lease expiry reached');
    equal(await complete(c, scope, input[4], 'old-worker', 1), { applied: false, snapshot: first }, 'expired completion has no effect');
    equal(await histories(c, first.outbox_id), oldHistory, 'expired completion adds no history');
    const next = (await claim(c, scope, 'new-worker'))[0]; equal(next.attempt_token, 2, 'reclaim advances token');
    equal(await complete(c, scope, input[4], 'old-worker', 1), { applied: false, snapshot: next }, 'old worker fenced after reclaim');
    check((await complete(c, scope, input[4], 'new-worker', 2)).applied, 'new worker can complete');
    const h = await histories(c, first.outbox_id);
    equal(h.attempts[0], oldHistory.attempts[0], 'original claim remains immutable');
    equal(h.attempts.length, 2, 'reclaim records new attempt');
    equal(h.audit.map((r) => r.action), ['enqueued', 'claimed', 'lease_expired', 'claimed', 'succeeded'], 'expiry and new claim are separate immutable events');
  });
  await test('completion resamples database clock after an actual lock wait', async () => {
    const input = args('completion-wait'); const scope = input.slice(0, 4);
    await enqueue(c, input); const r = (await claim(c, scope, 'waiting-worker', 0.3))[0];
    await a.query('BEGIN'); await a.query('SELECT outbox_id FROM capi_outbox.events WHERE outbox_id=$1 FOR UPDATE', [r.outbox_id]);
    const pending = complete(b, scope, input[4], 'waiting-worker', 1);
    await until(async () => (await admin.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [b.processID])).rows[0]?.waiting, 'completion actually waits on row lock');
    await until(async () => (await c.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [r.lease_until])).rows[0].expired, 'lease expires during completion wait');
    await a.query('COMMIT');
    equal(await pending, { applied: false, snapshot: r }, 'post-lock clock prevents expired completion');
    equal((await histories(c, r.outbox_id)).audit.map((x) => x.action), ['enqueued', 'claimed'], 'expired waiter makes no durable changes');
  });
  await test('concurrent completions apply once', async () => {
    const input = args('double-completion'); const scope = input.slice(0, 4);
    await enqueue(c, input); const r = (await claim(c, scope))[0];
    const results = await Promise.all([complete(a, scope, input[4], 'worker-a', 1), complete(b, scope, input[4], 'worker-a', 1)]);
    equal(results.filter((x) => x.applied).length, 1, 'only one concurrent completion applies');
    equal(results[0].snapshot, results[1].snapshot, 'both callers observe same final state');
    equal((await histories(c, r.outbox_id)).audit.filter((x) => x.action === 'succeeded').length, 1, 'one completion audit');
  });
  await test('native constraints immutable fields and append-only history', async () => {
    const input = args('native-constraints'); const scope = input.slice(0, 4);
    const r = (await enqueue(c, input)).snapshot; await claim(c, scope);
    for (const sql of ['UPDATE capi_outbox.events SET request_body=\'{}\' WHERE outbox_id=$1', 'UPDATE capi_outbox.events SET provider_event_id=\'other\' WHERE outbox_id=$1', 'DELETE FROM capi_outbox.events WHERE outbox_id=$1', 'UPDATE capi_outbox.attempts SET worker_key=\'other\' WHERE outbox_id=$1', 'DELETE FROM capi_outbox.attempts WHERE outbox_id=$1', 'UPDATE capi_outbox.audit SET result_code=\'OTHER\' WHERE outbox_id=$1', 'DELETE FROM capi_outbox.audit WHERE outbox_id=$1']) {
      await reject(() => c.query(sql, [r.outbox_id]), 'immutable data rejects direct modification', '22023');
    }
    await reject(() => c.query('TRUNCATE capi_outbox.audit'), 'audit truncate rejected', '22023');
    await reject(() => c.query('TRUNCATE capi_outbox.attempts'), 'attempt truncate rejected', '22023');
    await reject(() => c.query('UPDATE capi_outbox.events SET state=\'unknown\' WHERE outbox_id=$1', [r.outbox_id]), 'native state constraint rejects invalid state', '23514');
    await reject(() => c.query('UPDATE capi_outbox.events SET request_fingerprint=\'fake\' WHERE outbox_id=$1', [r.outbox_id]), 'generated fingerprint cannot be overwritten', '428C9');
    await reject(() => c.query("INSERT INTO capi_outbox.audit(outbox_id,attempt_token,action,next_state,worker_key) VALUES($1,99,'claimed','inflight','worker')", [r.outbox_id]), 'native audit constraint rejects null previous state', '23514');
  });
  await test('invalid parameters validated even with no matching rows', async () => {
    const valid = args('invalid-inputs');
    for (let index = 0; index < 4; index += 1) for (const value of [null, '', ' padded ', 'bad\nkey', '\u00a0padded']) {
      const input = [...valid]; input[index] = value;
      await reject(() => enqueue(c, input), 'invalid enqueue destination');
      await reject(() => claim(c, input.slice(0, 4)), 'invalid empty claim destination');
      await reject(() => complete(c, input.slice(0, 4), valid[4], 'worker', 1), 'invalid missing completion destination');
    }
    for (const body of [null, '', 'null', '[]', 'true', '123', '"text"', '{bad}', '{} trailing']) await reject(() => enqueue(c, [...valid.slice(0, 6), body]), 'JSON object request required', '22023');
    for (const value of [null, '', 'A'.repeat(64), '0'.repeat(63), '0'.repeat(65)]) {
      const input = [...valid]; input[4] = value;
      await reject(() => enqueue(c, input), 'lower SHA business identity required', '22023');
      await reject(() => complete(c, destination('absent'), value, 'worker', 1), 'completion validates missing business ID', '22023');
    }
    for (const worker of [null, '', ' bad ', 'bad\u0085key']) {
      const input = [...valid]; input[5] = worker;
      await reject(() => enqueue(c, input), 'provider ID exact key required', '22023');
      await reject(() => claim(c, destination('absent'), worker), 'empty claim worker validated', '22023');
      await reject(() => complete(c, destination('absent'), valid[4], worker, 1), 'missing completion worker validated', '22023');
    }
    for (const lease of [null, 0, -1, 0.001, 3601, 'NaN', 'Infinity', '-Infinity']) await reject(() => claim(c, destination('absent'), 'worker', lease), 'lease bounds validated', '22023');
    for (const batch of [null, 0, -1, 101, 1.5]) await reject(() => claim(c, destination('absent'), 'worker', 1, batch), 'batch bounds validated');
    for (const token of [null, 0, -1, 1.5]) await reject(() => complete(c, destination('absent'), valid[4], 'worker', token), 'attempt token validated');
    for (const outcome of [null, 'queued', 'success', '']) await reject(() => complete(c, destination('absent'), valid[4], 'worker', 1, outcome), 'completion outcome validated', '22023');
    for (const code of [null, '', '200 OK', 'token=synthetic', 'x', 'A'.repeat(65)]) await reject(() => complete(c, destination('absent'), valid[4], 'worker', 1, 'succeeded', null, code), 'sanitized result code required', '22023');
    for (const time of [null, '2000-01-01T00:00:00Z', 'infinity', '-infinity']) await reject(() => complete(c, destination('absent'), valid[4], 'worker', 1, 'retry', time), 'explicit finite future retry required', '22023');
    await reject(() => complete(c, destination('absent'), valid[4], 'worker', 1, 'succeeded', '2099-01-01T00:00:00Z'), 'unused retry timestamp rejected', '22023');
    equal(await complete(c, destination('absent'), valid[4], 'worker', 1), { applied: false, snapshot: null }, 'well-formed absent completion is no-op');
  });
  await test('actual prepareConversion stable ID and browser override integration', async () => {
    const time = (await c.query('SELECT clock_timestamp()::text AS value')).rows[0].value.replace(' ', 'T').replace(/\+00$/, 'Z');
    const input = { conversion: { source_system: 'synthetic', source_scope: 'local', conversion_key: 'prepared-event', occurred_at: time, value: 0, currency: 'USD', value_status: 'known' }, platform: 'meta', browser_event_id: 'Browser+Opaque%2FExact', click_observations: [], policy: { as_of: time, max_event_age_days: 1, click_lookback_days: 1, click_scope_bindings: [] } };
    const prepared = prepareConversion(input); check(prepared.status === 'ready', 'real preparation ready');
    // Synthetic envelope only: not a provider request builder or external call.
    const request = JSON.stringify({ synthetic_test: true, event_id: prepared.event_id, value: prepared.conversion.value });
    const values = [...destination('prepared'), prepared.business_conversion_id, prepared.event_id, request];
    const inserted = await enqueue(c, values);
    equal(inserted.snapshot.provider_event_id, input.browser_event_id, 'browser event ID preserved into outbox');
    equal(inserted.snapshot.business_conversion_id, makeConversionId(input.conversion), 'accepted business ID retained separately');
    input.conversion.value = 12; const changed = prepareConversion(input);
    equal(changed.business_conversion_id, prepared.business_conversion_id, 'mutable amount retains business identity');
    await reject(() => enqueue(c, [...values.slice(0, 6), JSON.stringify({ synthetic_test: true, event_id: changed.event_id, value: changed.conversion.value })]), 'changed facts conflict instead of minting replacement', 'P0001');
    equal((await enqueue(c, values)).snapshot, inserted.snapshot, 'stored bytes are replay contract');
  });
  evidence.persisted_counts = (await c.query("SELECT (SELECT count(*)::int FROM capi_outbox.events) AS events,(SELECT count(*)::int FROM capi_outbox.attempts) AS attempts,(SELECT count(*)::int FROM capi_outbox.audit) AS audit")).rows[0];
  evidence.state_counts = (await c.query('SELECT state,count(*)::int AS count FROM capi_outbox.events GROUP BY state ORDER BY state')).rows;
  evidence.status = 'passed';
  console.log(`PASS ${evidence.groups.length} native PostgreSQL groups, ${assertions} assertions; separate-connection races, real locks, rollback, retries, lease fencing and prepared-event integration.`);
} catch (error) {
  evidence.status = 'failed'; evidence.failure = { group: currentGroup, code: error.code ?? 'ASSERTION', label: error.code ? 'database operation failed; raw database detail omitted' : error.message };
  console.error(`FAIL ${currentGroup} (${error.code ?? 'ASSERTION'}); raw database input omitted.`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  evidence.assertions = assertions; evidence.completed_at = new Date().toISOString();
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
}

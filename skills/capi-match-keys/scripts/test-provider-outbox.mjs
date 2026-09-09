import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { enqueueProviderConversion } from './provider-outbox.mjs';

const runtime = process.env.CAPI_OUTBOX_RUNTIME;
const cluster = process.env.CAPI_OUTBOX_CLUSTER;
const port = Number(process.env.CAPI_OUTBOX_PORT);
const evidencePath = process.env.CAPI_OUTBOX_EVIDENCE;
if (!runtime?.startsWith('/tmp/capi-outbox-test-') || cluster !== `${runtime}/cluster`
  || !fs.existsSync(`${cluster}/PG_VERSION`) || !Number.isInteger(port) || port < 1 || !evidencePath) throw new Error('Run the owned-cluster shell harness');
const require = createRequire(`${runtime}/package.json`);
const { Client } = require('pg');
const fixtures = JSON.parse(fs.readFileSync(new URL('../references/payload-fixtures.json', import.meta.url))).cases;
const selected = ['google', 'linkedin', 'meta', 'tiktok', 'reddit'].map((p) => fixtures.find((f) => f.platform === p && f.expected.status === 'ready'));
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const evidence = { status: 'running', started_at: new Date().toISOString(), groups: [], source_hashes: {}, queries: [], cases: [], receipts: [], external_provider_calls: 0, node_version: process.version };
for (const file of ['./provider-outbox.mjs', './test-provider-outbox.mjs', './test-conversion-outbox.sh', './provider-payloads.mjs', './conversion-events.mjs', './match-keys.mjs', '../references/payload-fixtures.json', '../references/sql/conversion_outbox.sql']) evidence.source_hashes[file] = digest(fs.readFileSync(new URL(file, import.meta.url)));
let assertions = 0;
function check(v, label) { if (!v) throw new Error(label); assertions++; }
function equal(a, b, label) { check(isDeepStrictEqual(a, b), label); }
async function rejects(fn, predicate, label) { let e; try { await fn(); } catch (x) { e = x; } check(e && predicate(e), label); }
async function group(name, fn) { const before = assertions; await fn(); evidence.groups.push({ name, assertions: assertions - before, status: 'passed' }); }
const clients = [];
async function connect(user) {
  const c = new Client({ host: '127.0.0.1', port, user, database: 'postgres', password: '', application_name: 'capi-provider-outbox-local-test', options: '-c timezone=UTC -c statement_timeout=5000' });
  await c.connect(); clients.push(c);
  const query = c.query.bind(c);
  c.query = async (sql, values) => {
    const record = { sql, query_sha256: digest(sql), values: values ?? [] };
    try { const result = await query(sql, values); record.rows = result.rows; return result; }
    catch (e) { record.error_code = e.code ?? 'CLIENT_ERROR'; throw e; }
    finally { evidence.queries.push(record); }
  };
  return c;
}
const scope = (s) => [s.platform, s.account_key, s.destination_key, s.event_type];
let stub, copyDir;
try {
  const admin = await connect('postgres');
  const worker = await connect('capi_test_worker');
  const observer = await connect('capi_test_worker');
  const server = (await admin.query("SELECT version() AS version,current_setting('data_directory') AS directory,host(inet_server_addr()) AS address")).rows[0];
  check(fs.realpathSync(server.directory) === fs.realpathSync(cluster) && server.address === '127.0.0.1', 'owned loopback cluster verified');
  evidence.server = server;
  const read = async (id) => (await observer.query('SELECT to_jsonb(e) AS row FROM capi_outbox.events e WHERE outbox_id=$1', [id])).rows[0]?.row;
  const history = async (id) => (await observer.query('SELECT to_jsonb(a) AS row FROM capi_outbox.audit a WHERE outbox_id=$1 ORDER BY audit_id', [id])).rows.map((r) => r.row);
  await group('bridge validation, parameterization and standalone copy', async () => {
    let calls = 0;
    const tx = { async query(sql, values) { calls++; equal(sql, 'SELECT * FROM capi_outbox.enqueue_conversion($1,$2,$3,$4,$5,$6,$7)', 'one exact parameterized call'); equal(values, [...Object.values(selected[0].expected.destination), selected[0].expected.preparation.business_conversion_id, selected[0].expected.preparation.event_id, selected[0].expected.request.request_body], 'exact builder arguments'); return { rows: [{ disposition: 'inserted', snapshot: { marker: true } }] }; } };
    const value = await enqueueProviderConversion(tx, 'google', selected[0].input);
    equal(value.payload, selected[0].expected, 'actual payload equals full independent golden'); equal(calls, 1, 'build and enqueue only once');
    for (const p of ['toString', 'unknown', null, {}]) await rejects(() => enqueueProviderConversion(tx, p, selected[0].input), (e) => e instanceof TypeError, 'platform allowlist');
    await rejects(() => enqueueProviderConversion({}, 'google', selected[0].input), (e) => e instanceof TypeError, 'query required');
    for (const f of fixtures.filter((f) => f.expected.status === 'blocked')) await rejects(() => enqueueProviderConversion(tx, f.platform, f.input), (e) => e.code === 'capi_payload_blocked' && e.message === 'capi_payload_blocked' && isDeepStrictEqual(e.reasons, f.expected.reasons), 'blocked reasons before query');
    const invalid = structuredClone(selected[0].input); invalid.configuration.unexpected = true;
    await rejects(() => enqueueProviderConversion(tx, 'google', invalid), (e) => e instanceof TypeError, 'invalid configuration retains TypeError'); await rejects(() => enqueueProviderConversion(tx, 'google', selected[0].expected), (e) => e instanceof TypeError, 'prebuilt payload cannot bypass actual builder');
    await rejects(() => enqueueProviderConversion(tx, 'meta', selected[0].input), (e) => e instanceof TypeError, 'platform mismatch rejected'); equal(calls, 1, 'invalid and blocked issue no SQL');
    for (const rows of [[], [{ disposition: 'inserted', snapshot: {} }, {}], [{ disposition: 'other', snapshot: {} }], [{ disposition: 'inserted', snapshot: null }]]) await rejects(() => enqueueProviderConversion({ query: async () => ({ rows }) }, 'google', selected[0].input), (e) => e.message === 'capi_outbox_invalid_result', 'invalid native result rejected');
    const failure = Object.assign(new Error('safe sentinel'), { code: 'P0001' });
    await rejects(() => enqueueProviderConversion({ query: async () => { throw failure; } }, 'google', selected[0].input), (e) => e === failure, 'SQL error propagates unchanged');
    copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capi-provider-outbox-standalone-'));
    for (const file of ['provider-outbox.mjs', 'provider-payloads.mjs', 'conversion-events.mjs', 'match-keys.mjs']) fs.copyFileSync(new URL(file, import.meta.url), path.join(copyDir, file));
    const copied = await import(pathToFileURL(path.join(copyDir, 'provider-outbox.mjs')).href);
    for (const f of selected) equal((await copied.enqueueProviderConversion({ query: async () => ({ rows: [{ disposition: 'replayed', snapshot: {} }] }) }, f.platform, f.input)).payload, f.expected, 'standalone actual builder golden');
  });
  const inserted = [];
  await group('five actual builders to native persisted bytes, replay and conflicts', async () => {
    for (const f of selected) {
      const input = structuredClone(f.input); const before = structuredClone(input);
      await worker.query('BEGIN'); const result = await enqueueProviderConversion(worker, f.platform, input); await worker.query('COMMIT');
      equal(input, before, 'caller input immutable'); equal(result.payload, f.expected, 'entire independent ready golden'); equal(result.disposition, 'inserted', 'native insert');
      const s = result.snapshot; equal(await read(s.outbox_id), s, 'entire persisted row');
      equal(scope(s), Object.values(f.expected.destination), 'native destination equals independent fixture');
      equal(s.request_body, f.expected.request.request_body, 'native exact wire'); equal(JSON.parse(s.request_body), f.expected.request.body, 'native entire body');
      equal(s.request_fingerprint, digest(Buffer.from(f.expected.request.request_body, 'utf8')), 'native UTF8 SHA equals independent Node hash');
      equal([s.business_conversion_id, s.provider_event_id], [f.expected.preparation.business_conversion_id, f.expected.preparation.event_id], 'both stable IDs');
      const audit = await history(s.outbox_id);
      const replay = await enqueueProviderConversion(worker, f.platform, input); equal(replay.disposition, 'replayed', 'identical input replay'); equal(replay.snapshot, s, 'replay exact original snapshot'); equal(await history(s.outbox_id), audit, 'replay no audit insertion');
      for (const field of ['business', 'provider', 'body']) {
        const changed = structuredClone(input);
        if (field === 'business') changed.preparation_input.conversion.conversion_key += '-changed';
        if (field === 'provider') changed.preparation_input.browser_event_id += '-changed';
        if (field === 'body') changed.preparation_input.conversion.value = '123.46';
        await rejects(() => enqueueProviderConversion(worker, f.platform, changed), (e) => e.code === 'P0001', 'changed identity or body conflict');
        equal(await read(s.outbox_id), s, 'conflict preserves entire row'); equal(await history(s.outbox_id), audit, 'conflict preserves entire audit');
      }
      evidence.cases.push({ fixture_id: f.id, input_sha256: digest(JSON.stringify(f.input)), input: f.input, expected_wire: f.expected.request.request_body, persisted: s }); inserted.push(s);
    }
  });
  await group('business transaction blocked preparation and injected post-enqueue rollback', async () => {
    const original = (await observer.query('SELECT value FROM public.capi_test_business WHERE id=1')).rows[0].value;
    const counts = async () => (await observer.query('SELECT (SELECT count(*) FROM capi_outbox.events) AS events,(SELECT count(*) FROM capi_outbox.audit) AS audit')).rows[0];
    const before = await counts();
    await worker.query('BEGIN'); await worker.query('UPDATE public.capi_test_business SET value=765 WHERE id=1');
    const blocked = fixtures.find((f) => f.expected.status === 'blocked');
    try { await enqueueProviderConversion(worker, blocked.platform, blocked.input); throw new Error('expected blocked'); } catch (e) { equal(e.code, 'capi_payload_blocked', 'blocked error propagated'); await worker.query('ROLLBACK'); }
    equal((await observer.query('SELECT value FROM public.capi_test_business WHERE id=1')).rows[0].value, original, 'blocked rollback business'); equal(await counts(), before, 'blocked no outbox or audit');
    const fresh = structuredClone(selected[0].input); fresh.preparation_input.conversion.conversion_key += '-rollback'; fresh.preparation_input.browser_event_id += '-rollback';
    let rolled;
    try { await worker.query('BEGIN'); await worker.query('UPDATE public.capi_test_business SET value=766 WHERE id=1'); rolled = await enqueueProviderConversion(worker, 'google', fresh); throw new Error('injected_after_enqueue'); } catch (e) { equal(e.message, 'injected_after_enqueue', 'failure injected after real enqueue'); await worker.query('ROLLBACK'); }
    equal(await read(rolled.snapshot.outbox_id), undefined, 'rollback removed inserted outbox'); equal(await history(rolled.snapshot.outbox_id), [], 'rollback removed audit'); equal(await counts(), before, 'counts fully restored'); equal((await observer.query('SELECT value FROM public.capi_test_business WHERE id=1')).rows[0].value, original, 'post-enqueue rollback business');
  });
  await group('loopback stored-byte sends, committed claims and native retry completion', async () => {
    const receiptCounts = new Map(); let current;
    stub = http.createServer(async (req, res) => {
      try {
        check(req.socket.localAddress === '127.0.0.1', 'stub only loopback');
        const chunks = []; for await (const part of req) chunks.push(part); const bytes = Buffer.concat(chunks);
        const activity = (await admin.query('SELECT state,xact_start FROM pg_stat_activity WHERE pid=$1', [worker.processID])).rows[0];
        equal(activity, { state: 'idle', xact_start: null }, 'claim transaction committed before send');
        const visible = await read(current.outbox_id); equal(visible, current, 'separate connection sees committed claim');
        equal(bytes, Buffer.from(current.request_body, 'utf8'), 'HTTP receives exact stored UTF8 bytes');
        const count = (receiptCounts.get(current.outbox_id) ?? 0) + 1; receiptCounts.set(current.outbox_id, count);
        const status = count === 1 ? 503 : 200;
        evidence.receipts.push({ outbox_id: current.outbox_id, platform: current.platform, attempt_token: current.attempt_token, status, body_base64: bytes.toString('base64'), body_sha256: digest(bytes), activity, committed_snapshot: visible });
        res.writeHead(status); res.end('synthetic');
      } catch (e) { evidence.stub_failure = e.message; res.writeHead(500); res.end('test failure'); }
    });
    await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve)); const stubPort = stub.address().port;
    evidence.transport = { host: '127.0.0.1', port: stubPort, routing: 'explicit test override; provider URL never used' };
    for (const s of inserted) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await worker.query('BEGIN');
        const claimed = (await worker.query('SELECT to_jsonb(c) AS snapshot FROM capi_outbox.claim_conversions($1,$2,$3,$4,$5,$6::numeric,$7::integer) c', [...scope(s), 'loopback-worker', 30, 1])).rows;
        equal(claimed.length, 1, 'one eligible real claim'); current = claimed[0].snapshot; equal(current.attempt_token, attempt, 'attempt token increases');
        await worker.query('COMMIT');
        const response = await new Promise((resolve, reject) => { const request = http.request({ host: '127.0.0.1', port: stubPort, path: '/synthetic', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }); request.on('error', reject); request.end(Buffer.from(current.request_body, 'utf8')); });
        equal(response, attempt === 1 ? 503 : 200, 'controlled stub classification'); check(!evidence.stub_failure, 'stub assertions passed');
        // Test-only classification; no claim about any provider response contract.
        const result = (await worker.query("SELECT * FROM capi_outbox.complete_conversion($1,$2,$3,$4,$5,$6,$7::integer,$8,$9,CASE WHEN $8='retry' THEN clock_timestamp()+interval '200 milliseconds' ELSE NULL END)", [...scope(s), s.business_conversion_id, 'loopback-worker', attempt, response === 503 ? 'retry' : 'succeeded', response === 503 ? 'HTTP_503' : 'HTTP_200'])).rows[0];
        check(result.applied, 'native completion applies'); equal(result.snapshot.state, attempt === 1 ? 'retry' : 'succeeded', 'native state after response');
        if (attempt === 1) {
          const bound = (await observer.query("SELECT available_at>clock_timestamp() AS future,available_at<=clock_timestamp()+interval '1 second' AS bounded FROM capi_outbox.events WHERE outbox_id=$1", [s.outbox_id])).rows[0]; equal(bound, { future: true, bounded: true }, 'retry actual database future bounded one second');
          const deadline = Date.now() + 2000; let eligible = false;
          while (Date.now() < deadline) { eligible = (await observer.query('SELECT available_at<=clock_timestamp() AS eligible FROM capi_outbox.events WHERE outbox_id=$1', [s.outbox_id])).rows[0].eligible; if (eligible) break; await new Promise((r) => setTimeout(r, 20)); }
          check(eligible, 'awaited real database eligibility');
        }
      }
      const final = await read(s.outbox_id); equal(final.state, 'succeeded', 'terminal native success'); equal(final.request_body, s.request_body, 'success preserves original bytes');
      const receipts = evidence.receipts.filter((r) => r.outbox_id === s.outbox_id); equal(receipts.length, 2, 'exactly two local sends'); equal(receipts[0].body_base64, receipts[1].body_base64, 'retry byte identical');
      equal([final.business_conversion_id, final.provider_event_id], [s.business_conversion_id, s.provider_event_id], 'retry IDs stable');
      const audit = await history(s.outbox_id); equal(audit.map((r) => r.action), ['enqueued', 'claimed', 'retry', 'claimed', 'succeeded'], 'complete native audit sequence');
      const attempts = (await observer.query('SELECT to_jsonb(a) AS row FROM capi_outbox.attempts a WHERE outbox_id=$1 ORDER BY attempt_token', [s.outbox_id])).rows.map((r) => r.row); equal(attempts.map((r) => r.attempt_token), [1, 2], 'native immutable attempt records');
      Object.assign(evidence.cases.find((c) => c.persisted.outbox_id === s.outbox_id), { final, audit, attempts });
    }
    equal(evidence.receipts.length, 10, 'five payloads each sent twice locally');
  });
  evidence.status = 'passed'; console.log(`PASS ${evidence.groups.length} provider-outbox groups, ${assertions} assertions; five actual builders, native persistence/rollback and ten loopback HTTP receipts.`);
} catch (e) { evidence.status = 'failed'; evidence.failure = { code: e.code ?? 'ASSERTION', message: e.code ? 'native operation failed; details omitted' : e.message }; console.error('FAIL provider-outbox integration', evidence.failure); process.exitCode = 1; }
finally {
  if (stub?.listening) await new Promise((resolve) => stub.close(resolve));
  await Promise.allSettled(clients.map((c) => c.end()));
  if (copyDir) fs.rmSync(copyDir, { recursive: true, force: true });
  evidence.cleanup = { loopback_stub_closed: !stub?.listening, standalone_removed: !copyDir || !fs.existsSync(copyDir), clients_closed: clients.every((c) => c._ending) };
  evidence.assertions = assertions; evidence.completed_at = new Date().toISOString();
  const combined = JSON.parse(fs.readFileSync(evidencePath)); combined.provider_integration = evidence; fs.writeFileSync(evidencePath, JSON.stringify(combined, null, 2) + '\n');
}

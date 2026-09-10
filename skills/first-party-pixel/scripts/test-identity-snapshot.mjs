import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readIdentitySnapshot } from './read-identity-snapshot.mjs';
import { projectIdentity } from './project-identity.mjs';
import { createPgDatabase } from '../assets/collector/transaction-db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const identityRoot = resolve(root, '../clickstream-identity-stitching');
const fixtures = JSON.parse(await readFile(new URL('../references/identity-snapshot-fixtures.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('./read-identity-snapshot.mjs', import.meta.url), 'utf8');
const hash = x => createHash('sha256').update(x).digest('hex');
let assertions = 0;
const check = (method, ...args) => { assertions++; return assert[method](...args); };
const good = { site_keys: ['snap_b', 'snap_a', 'snap_a'], snapshot_evidence_ref: 'snapshot-native-fixture' };
const sqlHashes = {};
for (const kind of ['touches', 'observations', 'contacts']) sqlHashes[kind] = hash(await readFile(new URL(`../references/sql/identity_${kind}.sql`, import.meta.url)));
check('deepEqual', sqlHashes, fixtures.snapshot_goldens.main.source_sql_sha256);
let transactions = 0, getterCalls = 0;
const offlineDb = { async transaction(callback) {
  transactions++; const calls = [];
  const out = await callback({ async query(text, params) {
    calls.push({ text, params });
    if (text.includes('pg_current_snapshot()')) return { rows: [{ transaction_started_at: 'native-time', database_snapshot: 'native-snapshot' }] };
    if (text.startsWith('SELECT site_key FROM pixel.sites')) return { rows: [{ site_key: 'snap_a' }] };
    return { rows: [] };
  } });
  check('equal', calls[0].text, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  check('equal', calls.length, 6);
  for (const call of calls.slice(2)) check('deepEqual', call.params, [['snap_a', 'snap_b']]);
  for (const call of calls.slice(3)) { check('ok', call.text.includes('WHERE exported.source_scope = ANY($1::text[])')); check('ok', !call.text.includes("'snap_a'")); }
  return out;
} };
const offline = await readIdentitySnapshot(offlineDb, Object.freeze({ site_keys: Object.freeze([...good.site_keys]), snapshot_evidence_ref: good.snapshot_evidence_ref }));
check('deepEqual', offline.site_presence, [{ site_key: 'snap_a', exists: true }, { site_key: 'snap_b', exists: false }]);
check('deepEqual', offline.source_sql_sha256, sqlHashes);
const invalid = [undefined, null, {}, { ...good, extra: true }, { ...good, site_keys: [] }, { ...good, site_keys: null }, { ...good, site_keys: [''] }, { ...good, site_keys: [' a '] }, { ...good, site_keys: [1] }, { ...good, snapshot_evidence_ref: '' }, { ...good, snapshot_evidence_ref: ' PII-SENTINEL ' }, { ...good, site_keys: new Set(['a']) }];
const sparse = { ...good, site_keys: ['a'] }; sparse.site_keys.length = 2; invalid.push(sparse);
const extraArray = { ...good, site_keys: ['a'] }; extraArray.site_keys.extra = 'PII-SENTINEL'; invalid.push(extraArray);
const numericExtra = { ...good, site_keys: ['a'] }; numericExtra.site_keys['4294967295'] = true; invalid.push(numericExtra);
const symbol = { ...good }; symbol[Symbol('x')] = true; invalid.push(symbol);
const accessor = { ...good }; Object.defineProperty(accessor, 'snapshot_evidence_ref', { enumerable: true, get() { getterCalls++; throw Error('PII-SENTINEL'); } }); invalid.push(accessor);
const arrayAccessor = { ...good, site_keys: ['a'] }; Object.defineProperty(arrayAccessor.site_keys, '0', { enumerable: true, get() { getterCalls++; throw Error('PII-SENTINEL'); } }); invalid.push(arrayAccessor);
for (const options of invalid) await check('rejects', readIdentitySnapshot(offlineDb, options), error => error instanceof TypeError && !error.message.includes('PII-SENTINEL'));
check('equal', transactions, 1); check('equal', getterCalls, 0);
for (const db of [null, {}, { query() {} }]) await check('rejects', readIdentitySnapshot(db, good), /interactive transaction/);
const original = new Error('original synthetic permission failure');
await check('rejects', readIdentitySnapshot({ async transaction(callback) { return callback({ async query() { throw original; } }); } }, good), error => error === original);
const missingSqlCopy = await mkdtemp(join(tmpdir(), 'pixel-snapshot-missing-sql-'));
try {
  await mkdir(join(missingSqlCopy, 'scripts'), { recursive: true });
  await writeFile(join(missingSqlCopy, 'scripts/read-identity-snapshot.mjs'), source);
  await cp(join(root, 'references/sql'), join(missingSqlCopy, 'references/sql'), { recursive: true });
  await rm(join(missingSqlCopy, 'references/sql/identity_contacts.sql'));
  const missingSqlReader = await import(pathToFileURL(join(missingSqlCopy, 'scripts/read-identity-snapshot.mjs')).href);
  let acquisitions = 0;
  await check('rejects', missingSqlReader.readIdentitySnapshot({ async transaction() { acquisitions++; } }, good), error => error.code === 'ENOENT');
  check('equal', acquisitions, 0, 'read all source SQL bytes before opening transaction');
} finally { await rm(missingSqlCopy, { recursive: true, force: true }); }
const captureOptions = { site_keys: ['site'], snapshot_evidence_ref: 'original-reference' };
const captureCalls = [];
const captureDb = { async transaction(callback) {
  return callback({ async query(text, params) {
    captureCalls.push({ text, params });
    if (text.includes('pg_current_snapshot()')) return { rows: [{ transaction_started_at: 'native-time', database_snapshot: 'native-snapshot' }] };
    return { rows: [] };
  } });
} };
const capturedPromise = readIdentitySnapshot(captureDb, captureOptions);
captureOptions.snapshot_evidence_ref = null;
captureOptions.site_keys[0] = 'changed-site'; captureOptions.site_keys.push('extra-site');
const captured = await capturedPromise;
check('equal', captured.snapshot_evidence_ref, 'original-reference');
check('deepEqual', captured.site_keys, ['site']);
check('deepEqual', captured.site_presence, [{ site_key: 'site', exists: false }]);
for (const call of captureCalls.slice(2)) check('deepEqual', call.params, [['site']]);
check('equal', Object.isFrozen(captureOptions), false); check('equal', Object.isFrozen(captureOptions.site_keys), false);
check('deepEqual', captureOptions, { site_keys: ['changed-site', 'extra-site'], snapshot_evidence_ref: null });
const captureMutantCopy = await mkdtemp(join(tmpdir(), 'pixel-snapshot-caller-reference-mutant-'));
let captureMutantEvidence;
try {
  await mkdir(join(captureMutantCopy, 'scripts'), { recursive: true });
  await cp(join(root, 'references/sql'), join(captureMutantCopy, 'references/sql'), { recursive: true });
  const needle = 'snapshot_evidence_ref: snapshotEvidenceRef,';
  check('equal', source.split(needle).length, 2);
  const file = join(captureMutantCopy, 'scripts/read-identity-snapshot.mjs');
  const mutantSource = source.replace(needle, 'snapshot_evidence_ref: options.snapshot_evidence_ref,');
  await writeFile(file, mutantSource);
  const mutant = await import(pathToFileURL(file).href);
  const originalOptions = { site_keys: ['site'], snapshot_evidence_ref: 'original-reference' };
  const promise = mutant.readIdentitySnapshot(captureDb, originalOptions);
  originalOptions.snapshot_evidence_ref = null;
  const result = await promise;
  check('equal', result.snapshot_evidence_ref, null, 'executed old post-await reference defect reproduced');
  check('notEqual', result.snapshot_evidence_ref, 'original-reference', 'original primitive reference check kills mutant');
  captureMutantEvidence = { killed: true, sha256: hash(mutantSource), old_reference: result.snapshot_evidence_ref, expected_reference: 'original-reference' };
} finally { await rm(captureMutantCopy, { recursive: true, force: true }); }
console.log(`PASS snapshot offline contract: ${assertions} assertions; ${invalid.length} invalid options, SQL hashes, exact first statement, scope parameters, and original errors`);
if (process.argv.length > 3 || process.argv[2] && !['--connected', '--native'].includes(process.argv[2])) throw new TypeError('Usage: test-identity-snapshot.mjs [--native|--connected]');
if (process.argv[2] === '--native') {
  const env = { ...process.env }; delete env.DATABASE_URL;
  const run = spawnSync('bash', [join(root, 'scripts/roundtrip.sh'), '--identity-snapshot'], { env, stdio: 'inherit' });
  if (run.error) throw run.error; process.exit(run.status ?? 1);
}
if (process.argv[2] !== '--connected') process.exit(0);
const database = new URL(process.env.DATABASE_URL || 'missing://invalid');
const collector = new URL(process.env.COLLECTOR_URL || 'missing://invalid');
if (process.env.PIXEL_DISPOSABLE_TEST !== '1' || database.hostname !== '127.0.0.1' || database.pathname !== '/pixel_test' || collector.hostname !== '127.0.0.1' || !process.env.PIXEL_TRANSACTION_RUNTIME) throw new Error('Native snapshot tests require owned disposable PostgreSQL and collector');
const require = createRequire(join(process.env.PIXEL_TRANSACTION_RUNTIME, 'package.json'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const started = new Date().toISOString();
const report = { invocation_capture_mutant: captureMutantEvidence, status: 'running', started_at: started, node: process.version, pg: require('pg/package.json').version, queries: [], requests: [], snapshots: [], projections: [], concurrency: [], mutations: [], source_sha256: {}, label_mapping: {} };
const evidence = join(homedir(), 'Downloads', `first-party-pixel-identity-snapshot-native-evidence-${started.replaceAll(/[^0-9]/g, '')}.json`);
const scratch = await mkdtemp(join(tmpdir(), 'pixel-snapshot-native-'));
const query = async (text, params = []) => { try { const result = await pool.query(text, params); report.queries.push({ text, params, rows: result.rows }); return result.rows; } catch (e) { report.queries.push({ text, params, error: { code: e.code, message: e.message } }); throw e; } };
const tables = ['sites', 'visitors', 'events', 'contacts', 'identity_links', 'touchpoints', 'conversion_events', 'consent_state', 'identity_observations'];
const fullRows = async () => { const rows = {}; for (const table of tables) rows[table] = (await query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM pixel.${table} r`))[0].rows; return rows; };
const A = 'person.a@example.test', B = 'person.b@example.test';
const post = async (site, visitor, event_type, label, occurred_at, email) => {
  const payload = { site_key: site, visitor_uid: visitor, event_type, event_name: null, occurred_at, url: 'https://example.test/', click_ids: { gclid: 'Snapshot+Click' }, properties: { snapshot_label: label }, identity: email ? { email } : null };
  const response = await fetch(collector, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify(payload) });
  const body = await response.text(); report.requests.push({ payload, status: response.status, body }); check('equal', response.status, 204, body);
};
const time = minute => `2026-09-03T00:${minute}:00.000000001Z`;
function trackedDb(label, afterQuery) {
  const trace = { label, statements: [], releases: [], pool_queries: 0, settings: [] }; report.queries.push({ transaction_trace: trace });
  const db = createPgDatabase({ query(...args) { trace.pool_queries++; return pool.query(...args); }, async connect() {
    const client = await pool.connect(); trace.backend_pid = client.processID;
    return { async query(text, params) {
      try {
        const result = await client.query(text, params); trace.statements.push({ text, params, rows: result.rows });
        if (text.startsWith('SET TRANSACTION')) {
          const settings = await client.query("SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only"); trace.settings.push(settings.rows[0]);
        }
        if (afterQuery) await afterQuery(text, result, client);
        return result;
      } catch (e) { trace.statements.push({ text, params, error: { code: e.code, message: e.message } }); throw e; }
    }, release(destroy) { trace.releases.push(destroy); client.release(destroy); } };
  } });
  return { db, trace };
}
const normalizedKey = (row, kind) => JSON.stringify([row.source_system, row.source_scope, ...(kind === 'contact' ? [row.contact_key] : [row.visitor_key, row[kind === 'touch' ? 'touch_key' : 'observation_key']])]);
function normalize(value, key) {
  if (key === 'native_created_at') return value === null ? null : '<native-created-at>';
  if (key === 'transaction_started_at') return '<transaction-started-at>';
  if (key === 'database_snapshot') return '<database-snapshot>';
  if (typeof value === 'string') {
    if (report.label_mapping[value]) return report.label_mapping[value];
    if (key === 'edge_key' || value.startsWith('["first_party_pixel"')) { try { return JSON.stringify(JSON.parse(value).map(part => report.label_mapping[part] || part)); } catch {} }
    return value;
  }
  if (Array.isArray(value)) {
    const rows = value.map(item => normalize(item));
    const kind = ['touches', 'touch_links', 'suppressed_touches', 'excluded_touches'].includes(key) ? 'touch' : ['observations', 'excluded_observations'].includes(key) ? 'observation' : ['contacts', 'contact_diagnostics'].includes(key) ? 'contact' : null;
    if (kind && key !== 'touch_links' && key !== 'observations' && key !== 'contacts') rows.sort((a, b) => normalizedKey(a, kind) < normalizedKey(b, kind) ? -1 : normalizedKey(a, kind) > normalizedKey(b, kind) ? 1 : 0);
    if (['edges', 'observations', 'touch_links', 'shared_devices', 'contacts', 'candidates', 'edge_evidence_keys'].includes(key)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return rows;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, normalize(item, field)]));
  return value;
}
function normalizeSnapshot(snapshot) {
  const result = normalize(snapshot);
  for (const [field, kind] of [['touches', 'touch'], ['observations', 'observation'], ['contacts', 'contact']]) result[field].sort((a, b) => normalizedKey(a, kind) < normalizedKey(b, kind) ? -1 : normalizedKey(a, kind) > normalizedKey(b, kind) ? 1 : 0);
  return result;
}
async function refreshLabels() {
  for (const row of await query("SELECT id::text,site_key,visitor_uid FROM pixel.visitors WHERE site_key=ANY($1::text[])", [['snap_a', 'snap_b', 'snap_consistency']])) report.label_mapping[row.id] = row.visitor_uid === 'shared-browser' ? 'v-shared' : row.visitor_uid === 'consistency-browser' ? 'v-consistency' : 'v-unique';
  for (const row of await query("SELECT t.id::text, v.visitor_uid FROM pixel.touchpoints t JOIN pixel.visitors v ON v.id=t.visitor_id WHERE t.site_key=ANY($1::text[])", [['snap_a', 'snap_b', 'snap_consistency']])) report.label_mapping[row.id] = row.visitor_uid === 'shared-browser' ? 't-shared' : row.visitor_uid === 'consistency-browser' ? 't-consistency' : 't-unique';
  for (const row of await query("SELECT o.event_id::text, e.properties->>'snapshot_label' AS label FROM pixel.identity_observations o JOIN pixel.events e ON e.id=o.event_id AND e.site_key=o.site_key WHERE o.site_key=ANY($1::text[])", [['snap_a', 'snap_b', 'snap_consistency']])) report.label_mapping[row.event_id] = row.label;
  for (const row of await query("SELECT id::text,site_key,email_hash FROM pixel.contacts WHERE site_key=ANY($1::text[])", [['snap_a', 'snap_b', 'snap_consistency']])) report.label_mapping[row.id] = row.site_key === 'snap_consistency' ? 'c-consistency' : row.email_hash === hash(A) ? 'c-a' : row.email_hash === hash(B) ? 'c-b' : 'c-legacy';
}
async function take(label, site_keys, helper = readIdentitySnapshot, afterQuery) {
  const { db, trace } = trackedDb(label, afterQuery);
  const result = await helper(db, { site_keys, snapshot_evidence_ref: site_keys.includes('snap_consistency') ? 'consistency-snapshot' : 'snapshot-native-fixture' });
  report.snapshots.push({ label, result });
  check('equal', trace.pool_queries, 0); check('deepEqual', trace.releases, [false]);
  check('equal', trace.statements[0].text, 'BEGIN');
  check('equal', trace.statements[1].text, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  check('equal', trace.statements.at(-1).text, 'COMMIT');
  check('deepEqual', trace.settings, [{ pid: trace.backend_pid, isolation: 'repeatable read', read_only: 'on' }]);
  return result;
}
try {
  report.postgres_version = (await query('SHOW server_version'))[0].server_version;
  for (const file of ['scripts/read-identity-snapshot.mjs', 'scripts/test-identity-snapshot.mjs', 'scripts/project-identity.mjs', 'assets/collector/core.js', 'assets/collector/transaction-db.mjs', 'assets/schema.sql', 'references/sql/identity_touches.sql', 'references/sql/identity_observations.sql', 'references/sql/identity_contacts.sql', 'references/identity-snapshot-fixtures.json']) report.source_sha256[file] = hash(await readFile(join(root, file)));
  for (const file of ['identity-primitives.mjs', 'identity-graph.mjs', 'identity-normalization.mjs']) report.source_sha256[`identity-skill/${file}`] = hash(await readFile(join(identityRoot, 'scripts', file)));
  await query("INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES('snap_a','example.test','{}'),('snap_b','example.test','{}'),('snap_consistency','example.test','{}')");
  for (const site of ['snap_a', 'snap_b']) {
    await post(site, 'same-browser', 'pageview', 't-unique', time('00'));
    await post(site, 'same-browser', 'identify', 'o-unique-identify', time('10'), A);
    if (site === 'snap_a') await post(site, 'same-browser', 'form_submit', 'o-unique-form', time('20'), A);
  }
  await post('snap_a', 'shared-browser', 'pageview', 't-shared', time('00'));
  await post('snap_a', 'shared-browser', 'identify', 'o-shared-a', time('10'), A);
  await post('snap_a', 'shared-browser', 'identify', 'o-shared-b', time('20'), B);
  await post('snap_a', 'shared-browser', 'form_submit', 'o-shared-form', time('30'), B);
  await query("INSERT INTO pixel.contacts(site_key,email_hash,email_canonical) VALUES('snap_a','legacy-unverified-digest','legacy@example.test')");
  await refreshLabels();
  const before = await fullRows();
  const main = await take('main', ['snap_missing', 'snap_b', 'snap_a', 'snap_a']);
  check('deepEqual', normalizeSnapshot(main), fixtures.snapshot_goldens.main, 'full native snapshot golden');
  check('deepEqual', normalizeSnapshot(await take('only_a', ['snap_a'])), fixtures.snapshot_goldens.only_a, 'site filter full golden');
  check('deepEqual', normalizeSnapshot(await take('missing', ['snap_missing'])), fixtures.snapshot_goldens.missing, 'explicit missing site full golden');
  for (const row of fixtures.projection_cases) {
    const input = { snapshot_evidence_ref: main.snapshot_evidence_ref, config: row.config, touches: main.touches, observations: main.observations, contacts: main.contacts };
    if (row.external_contacts) Object.assign(input, { external_contacts: row.external_contacts, external_contact_evidence_ref: row.external_contact_evidence_ref });
    const output = await projectIdentity(input, { identitySkillRoot: identityRoot });
    report.projections.push({ name: row.name, input, output });
    check('deepEqual', normalize(output), row.expected, `full native projection ${row.name}`);
  }
  check('deepEqual', await fullRows(), before, 'snapshot plus projection is read-only across complete rows');
  const nativeForms = await query("SELECT v.visitor_uid,c.contact_id::text,ct.email_hash FROM pixel.conversion_events c JOIN pixel.visitors v ON v.id=c.visitor_id JOIN pixel.contacts ct ON ct.id=c.contact_id WHERE c.site_key='snap_a' ORDER BY v.visitor_uid");
  check('deepEqual', nativeForms.map(row => [row.visitor_uid, row.email_hash]), [['same-browser', hash(A)], ['shared-browser', hash(B)]], 'own form IDs remain intact');
  check('ok', main.touches.every(row => row.native_contact_id === null));
  report.before_read_only = before; report.after_read_only = await fullRows();

  // Pause after the actual touch export. A separate HTTP transaction commits before
  // the reader is permitted to issue its observation/contact exports.
  await post('snap_consistency', 'consistency-browser', 'pageview', 't-consistency', time('00'));
  await refreshLabels();
  const consistencyBefore = await fullRows(); let writes = 0;
  const consistent = await take('repeatable_read_concurrent_writer', ['snap_consistency'], readIdentitySnapshot, async text => {
    if (text.startsWith('SELECT exported.*') && text.includes('FROM pixel.touchpoints t')) {
      writes++; await post('snap_consistency', 'consistency-browser', 'identify', 'o-consistency', time('10'), A);
    }
  });
  check('equal', writes, 1); await refreshLabels();
  check('deepEqual', normalizeSnapshot(consistent), fixtures.snapshot_goldens.consistency_before, 'all reads retain prewriter snapshot');
  const fresh = await take('fresh_after_concurrent_commit', ['snap_consistency']);
  check('deepEqual', normalizeSnapshot(fresh), fixtures.snapshot_goldens.consistency_after, 'fresh snapshot includes writer commit');
  report.concurrency.push({ before: consistencyBefore, reader_snapshot: consistent, fresh_snapshot: fresh, after: await fullRows(), synchronization: 'Writer HTTP completion awaited inside reader touch-query callback before observation/contact reads; no timing sleeps.' });

  // Copy the exact pixel directory and independently installed identity directory.
  const copiedPixel = join(scratch, 'pixel'), copiedIdentity = join(scratch, 'installed-identity');
  await cp(root, copiedPixel, { recursive: true }); await cp(identityRoot, copiedIdentity, { recursive: true });
  const copiedReader = await import(pathToFileURL(join(copiedPixel, 'scripts/read-identity-snapshot.mjs')).href);
  const copiedProjector = await import(pathToFileURL(join(copiedPixel, 'scripts/project-identity.mjs')).href);
  const copiedSnapshot = await take('standalone_copied_pixel', ['snap_a', 'snap_b', 'snap_missing'], copiedReader.readIdentitySnapshot);
  check('deepEqual', normalizeSnapshot(copiedSnapshot), fixtures.snapshot_goldens.main);
  const copiedOutput = await copiedProjector.projectIdentity({ snapshot_evidence_ref: copiedSnapshot.snapshot_evidence_ref, config: fixtures.projection_cases[0].config, touches: copiedSnapshot.touches, observations: copiedSnapshot.observations, contacts: copiedSnapshot.contacts }, { identitySkillRoot: copiedIdentity });
  check('deepEqual', normalize(copiedOutput), fixtures.projection_cases[0].expected);
  report.standalone = { snapshot: copiedSnapshot, projection: copiedOutput };

  // Mutant sources live only in temporary copies with unchanged trusted SQL.
  async function mutant(name, needle, replacement) {
    check('equal', source.split(needle).length, 2);
    const folder = join(scratch, name); await mkdir(join(folder, 'scripts'), { recursive: true });
    await cp(join(root, 'references/sql'), join(folder, 'references/sql'), { recursive: true });
    const file = join(folder, 'scripts/read-identity-snapshot.mjs'); await writeFile(file, source.replace(needle, replacement));
    const module = await import(pathToFileURL(file).href); return { run: module.readIdentitySnapshot, sha256: hash(await readFile(file)) };
  }
  // Remove isolation: old touch read cannot be paired with postwriter identity rows.
  await query("DELETE FROM pixel.identity_observations WHERE site_key='snap_consistency'");
  await query("DELETE FROM pixel.contacts WHERE site_key='snap_consistency'");
  const noIsolation = await mutant('no-repeatable-read', 'ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ISOLATION LEVEL READ COMMITTED READ ONLY');
  const inconsistentBefore = await fullRows();
  const readCommitted = trackedDb('mutant_read_committed', async text => { if (text.startsWith('SELECT exported.*') && text.includes('FROM pixel.touchpoints t')) await post('snap_consistency', 'consistency-browser', 'identify', 'o-consistency', time('10'), A); });
  const inconsistent = await noIsolation.run(readCommitted.db, { site_keys: ['snap_consistency'], snapshot_evidence_ref: 'consistency-snapshot' }); await refreshLabels();
  check('notDeepEqual', normalizeSnapshot(inconsistent), fixtures.snapshot_goldens.consistency_before);
  check('equal', inconsistent.observations.length, 1); check('equal', inconsistent.contacts.length, 1);
  report.mutations.push({ name: 'remove_repeatable_read', killed: true, sha256: noIsolation.sha256, before: inconsistentBefore, inconsistent_snapshot: inconsistent, after: await fullRows() });

  const noReadOnly = await mutant('no-read-only', 'REPEATABLE READ READ ONLY', 'REPEATABLE READ READ WRITE');
  for (const [name, helper, expected] of [['actual_read_only', readIdentitySnapshot, '25006'], ['mutant_read_write', noReadOnly.run, 'probe-permitted']]) {
    const probeBefore = await fullRows(); const probeSql = "INSERT INTO pixel.sites(site_key,domain,allowed_origins) VALUES('snap_write_probe','example.test','{}')"; let probeResult; const permitted = new Error('probe-permitted'); let inserted = false;
    const instrument = trackedDb(name, async (text, result, client) => {
      if (text.startsWith('SET TRANSACTION')) {
        try { const result = await client.query(probeSql); probeResult = { rowCount: result.rowCount, rows: result.rows }; }
        catch (error) { probeResult = { error: { code: error.code, message: error.message } }; throw error; }
        inserted = true; throw permitted;
      }
    });
    await check('rejects', helper(instrument.db, good), error => expected === '25006' ? error.code === '25006' : error === permitted);
    check('equal', inserted, expected === 'probe-permitted'); check('deepEqual', await fullRows(), probeBefore, 'write probe always rolls back');
    check('equal', instrument.trace.statements.at(-1).text, 'ROLLBACK'); check('deepEqual', instrument.trace.releases, [false]);
    report.mutations.push({ name, controlled_insert_permitted: inserted, expected, probe_sql: probeSql, probe_result: probeResult, trace: instrument.trace });
  }
  const noFilter = await mutant('no-site-filter', 'WHERE exported.source_scope = ANY($1::text[])', 'WHERE ($1::text[]) IS NOT NULL');
  const leaked = await noFilter.run(createPgDatabase(pool), { site_keys: ['snap_a'], snapshot_evidence_ref: 'snapshot-native-fixture' });
  check('notDeepEqual', normalizeSnapshot(leaked), fixtures.snapshot_goldens.only_a); check('ok', leaked.touches.some(row => row.source_scope !== 'snap_a'));
  report.mutations.push({ name: 'remove_site_filter', killed: true, sha256: noFilter.sha256, leaked_snapshot: leaked });

  const failBefore = await fullRows(); const failure = new Error('injected original export failure'); let partial = 'not-returned';
  const failing = trackedDb('export_failure', async text => { if (text.startsWith('SELECT exported.*') && text.includes('FROM pixel.identity_observations o')) throw failure; });
  await check('rejects', (async () => { partial = await readIdentitySnapshot(failing.db, good); })(), error => error === failure);
  check('equal', partial, 'not-returned'); check('equal', failing.trace.statements.at(-1).text, 'ROLLBACK'); check('deepEqual', failing.trace.releases, [false]); check('deepEqual', await fullRows(), failBefore);
  check('equal', (await query('SELECT 1 AS reusable'))[0].reusable, 1);
  report.failure_injection = { same_error_object: true, partial_result: partial, trace: failing.trace, before: failBefore, after: await fullRows() };
  report.status = 'passed'; report.assertions = assertions; report.full_snapshot_goldens = 5; report.full_projection_goldens = 3;
  console.log(`PASS native identity snapshot: 5 full snapshot goldens, 3 full actual projection goldens, concurrent snapshot proof, 3 executed scoped mutants, copied standalone chain; ${assertions} assertions`);
} catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; throw error; }
finally {
  await pool.end(); await rm(scratch, { recursive: true, force: true }); report.scratch_removed = true; report.finished_at = new Date().toISOString();
  await mkdir(join(homedir(), 'Downloads'), { recursive: true }); await writeFile(evidence, JSON.stringify(report, null, 2) + '\n'); console.log(`Evidence: ${evidence}`);
}

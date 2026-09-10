import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCollectorTimestamp } from '../assets/collector/timestamp.mjs';

if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--connected') throw new TypeError('Usage: node scripts/test-touch-integration.mjs');
let dedupeTouches;
try { ({ dedupeTouches } = await import('../../clickstream-identity-stitching/scripts/identity-primitives.mjs')); }
catch { throw new Error('Repository integration requires the sibling clickstream-identity-stitching skill; the SQL export itself is standalone.'); }
if (process.argv[2] !== '--connected') {
  const env = { ...process.env, PIXEL_TOUCH_INTEGRATION: '1' };
  delete env.DATABASE_URL; // Always let roundtrip own a new disposable local cluster.
  const result = spawnSync('bash', [fileURLToPath(new URL('./roundtrip.sh', import.meta.url))], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const database = new URL(process.env.DATABASE_URL || 'missing://invalid');
const collector = new URL(process.env.COLLECTOR_URL || 'missing://invalid');
if (process.env.PIXEL_DISPOSABLE_TEST !== '1' || !['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/pixel_test' || collector.hostname !== '127.0.0.1') throw new Error('Connected mode requires the roundtrip-owned disposable localhost test database and collector');
const psql = process.env.PIXEL_PSQL_BIN || 'psql';
let assertions = 0, posted = 0;
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
const started = new Date().toISOString();
const evidencePath = join(homedir(),'Downloads',`first-party-pixel-touch-nanosecond-native-evidence-${started.replaceAll(/[^0-9]/g,'')}.json`);
const evidence = { started_at:started, status:'running', node:process.version, queries:[], requests:[], source_sha256:{}, native_goldens:[] };
for (const [name,path] of [
  ['identity-primitives.mjs','../../clickstream-identity-stitching/scripts/identity-primitives.mjs'],
  ['identity-normalization.mjs','../../clickstream-identity-stitching/scripts/identity-normalization.mjs'],
  ['identity-graph.mjs','../../clickstream-identity-stitching/scripts/identity-graph.mjs'],
  ['collector/core.js','../assets/collector/core.js'],['collector/timestamp.mjs','../assets/collector/timestamp.mjs'],
  ['schema.sql','../assets/schema.sql'],['identity_touches.sql','../references/sql/identity_touches.sql']
]) evidence.source_sha256[name] = createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex');
mkdirSync(join(homedir(),'Downloads'),{recursive:true});
process.once('exit',(code)=>{
  evidence.status=code===0?'passed':'failed';evidence.completed_at=new Date().toISOString();
  evidence.assertions=assertions;evidence.posted_pageviews=posted;
  writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
});
const sql = (text) => {
  try {
    const raw=execFileSync(psql,[process.env.DATABASE_URL,'-X','-q','-tA','-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'}).trim();
    evidence.queries.push({sql:text,raw_output:raw});return raw;
  } catch(error) { evidence.queries.push({sql:text,error:String(error),stderr:String(error.stderr||'')});throw error; }
};
evidence.postgres_version=sql('SHOW server_version');

const rows = (query) => JSON.parse(sql(`SELECT coalesce(json_agg(result), '[]'::json) FROM (${query}) result`));
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const sourceSql = (await readFile(new URL('../references/sql/identity_touches.sql', import.meta.url), 'utf8')).trim().replace(/;$/, '');
const timestamp = (minute) => new Date(Date.parse('2026-09-03T12:00:00Z') + minute * 60_000).toISOString();
const paid = (label, minute, campaign = 'A', click = 'CLICK') => ({ label, minute, utm: { source: 'google', medium: 'cpc', campaign }, click_ids: { gclid: click } });
const direct = (label, minute) => ({ label, minute, utm: {}, click_ids: {} });
const email = (label, minute) => ({ label, minute, utm: { source: 'newsletter', medium: 'email', campaign: 'B' }, click_ids: {} });
const repeat = 'consecutive_duplicate_within_30_minutes';
const directRepeat = 'direct_first_touch_only';
const cases = [
  { name: 'url_clicks', events: [{ label: 'url-one', minute: 0, url: 'https://example.com/?gclid=One&utm_campaign=A' }, { label: 'url-two', minute: 1, url: 'https://example.com/?gclid=Two&utm_campaign=A' }], kept: ['url-one', 'url-two'], suppressed: [], sessions: [['Paid Search', 2]] },
  { name: 'url_campaigns', events: [{ label: 'url-A', minute: 0, url: 'https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=A' }, { label: 'url-B', minute: 1, url: 'https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=B' }], kept: ['url-A', 'url-B'], suppressed: [], sessions: [['Paid Search', 2]] },
  { name: 'url_plus', events: [{ label: 'url-space', minute: 0, url: 'https://example.com/?gclid=A+B&utm_campaign=A' }, { label: 'url-plus', minute: 1, url: 'https://example.com/?gclid=A%2BB&utm_campaign=A' }], kept: ['url-space', 'url-plus'], suppressed: [], sessions: [['Paid Search', 2]] },
  { name: 'bounded_raw', events: [{ label: 'deep-url', minute: 0, url: 'https://example.com/?gclid=%252525252541&utm_campaign=%252525252541' }, paid('shallow-payload', 1, '%41', '%41')], kept: ['deep-url', 'shallow-payload'], suppressed: [], sessions: [['Paid Search', 2]] },
  { name: 'campaigns', events: [paid('A', 0, 'A'), paid('B', 1, 'B')], kept: ['A', 'B'], suppressed: [], sessions: [['Paid Search', 2]] },
  { name: 'opaque', events: [paid('plus', 0, 'A', 'Ab+C'), paid('space', 1, 'A', 'Ab C'), paid('case', 2, 'A', 'ab+C')], kept: ['plus', 'space', 'case'], suppressed: [], sessions: [['Paid Search', 3]] },
  { name: 'normalized', events: [paid('raw', 0, ' Summer+Launch '), paid('encoded', 1, 'summer%20launch')], kept: ['raw'], suppressed: [['encoded', repeat]], sessions: [['Paid Search', 2]] },
  { name: 'aba', events: [paid('A1', 0), email('B', 1), paid('A2', 2)], kept: ['A1', 'B', 'A2'], suppressed: [], sessions: [['Paid Search', 3]] },
  { name: 'window', events: [paid('at0', 0), paid('at29', 29), paid('at30', 30), paid('at59', 59)], kept: ['at0', 'at30'], suppressed: [['at29', repeat], ['at59', repeat]], sessions: [['Paid Search', 4]] },
  { name: 'returning_direct', events: [paid('paid', 0), direct('return', 180)], kept: ['paid'], suppressed: [['return', directRepeat]], sessions: [['Paid Search', 1], ['Direct', 1]] },
  { name: 'initial_direct', events: [direct('first', 0), paid('paid', 1), direct('return', 180)], kept: ['first', 'paid'], suppressed: [['return', directRepeat]], sessions: [['Direct', 2], ['Direct', 1]] },
  { name: 'late', events: [paid('late', 20), paid('early', 0), email('middle', 10)], kept: ['early', 'middle', 'late'], suppressed: [], sessions: [['Paid Search', 3]] },
  { name: 'scope_a', visitor: 'same-browser', events: [direct('direct-a', 0)], kept: ['direct-a'], suppressed: [], sessions: [['Direct', 1]] },
  { name: 'scope_b', visitor: 'same-browser', events: [direct('direct-b', 0)], kept: ['direct-b'], suppressed: [], sessions: [['Direct', 1]] },
  { name: 'transport_duplicates', concurrent: true, events: [paid('duplicate', 0), paid('duplicate', 0)], kept: ['duplicate'], suppressed: [['duplicate', repeat]], sessions: [['Paid Search', 2]] },
  { name: 'ns_below', events: [{ ...paid('ns-first',0), occurred_at:'2026-09-03T12:00:00.000000001Z' }, { ...paid('ns-under',30), occurred_at:'2026-09-03T12:30:00.000000000Z' }], kept:['ns-first'], suppressed:[['ns-under',repeat]], sessions:[['Paid Search',2]] },
  { name: 'ns_exact', events: [{ ...paid('ns-first',0), occurred_at:'2026-09-03T12:00:00.000000001Z' }, { ...paid('ns-exact',30), occurred_at:'2026-09-03T12:30:00.000000001Z' }], kept:['ns-first','ns-exact'], suppressed:[], sessions:[['Paid Search',2]] },
  { name: 'ns_above', events: [{ ...paid('ns-first',0), occurred_at:'2026-09-03T12:00:00.000000001Z' }, { ...paid('ns-over',30), occurred_at:'2026-09-03T12:30:00.000000002Z' }], kept:['ns-first','ns-over'], suppressed:[], sessions:[['Paid Search',2]] },
  { name: 'sanitized', events: [{ label: 'raw-sanitized', minute: 0, utm: { source: ' Google ', medium: ' CPC ', campaign: 'Raw%2520+Case', content: 42, term: { email: 'private@example.com' }, extra: 'private@example.com' }, click_ids: { gclid: ' Ab%252BC ', fbclid: { email: 'private@example.com' }, ttclid: 42, extra: 'private@example.com' } }], kept: ['raw-sanitized'], suppressed: [], sessions: [['Paid Search', 1]] },
];
for (const test of cases) {
  const site = `touch_test_${test.name}`;
  sql(`INSERT INTO pixel.sites (site_key, domain, allowed_origins) VALUES (${literal(site)}, 'example.com', '{}')`);
  const post = async (event) => {
    const payload = { site_key: site, visitor_uid: test.visitor || 'browser', event_type: 'pageview', occurred_at: event.occurred_at ?? timestamp(event.minute), url: event.url || 'https://example.com/', referrer: null, utm: event.utm, click_ids: event.click_ids, properties: { test_label: event.label } };
    const result = await fetch(collector, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify(payload) });
    evidence.requests.push({payload,status:result.status,body:await result.text()});
    check('equal', result.status, 204, `${test.name}: accepted pageview`); posted += 1;
  };
  if (test.concurrent) await Promise.all(test.events.map(post));
  else for (const event of test.events) await post(event);
}
const exported = rows(sourceSql);
const sourceTimes = new Map(rows(`SELECT id::text AS touch_key, occurred_at_iso,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS native_time
  FROM pixel.touchpoints`).map((row) => [row.touch_key, row]));
for (const row of exported) check('equal', row.occurred_at, sourceTimes.get(row.touch_key).occurred_at_iso ?? sourceTimes.get(row.touch_key).native_time, 'exact original or six-digit legacy native timestamp');
const eligible = exported.filter((row) => row.export_status === 'eligible');
check('ok', exported.some((row) => row.export_status === 'legacy_requires_reclassification' && row.taxonomy_version === null), 'actual legacy export stays explicitly noncanonical');
for (const row of exported) {
  check('equal', row.source_system, 'first_party_pixel');
  check('equal', parseCollectorTimestamp(row.occurred_at).original, row.occurred_at, 'strict calendar/offset timestamp preserved');
  check('equal', Object.keys(row.click_ids).length, 13, 'all recognized click fields exported');
  check('equal', Object.keys(row).some((key) => key.startsWith('subject_')), false, 'native contact is never subject ownership');
}
const nativeRows = rows(`SELECT t.id::text AS touch_key, t.site_key, t.channel, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term, t.gclid, t.fbclid, t.ttclid, e.utm, e.click_ids, e.properties->>'test_label' AS label FROM pixel.touchpoints t JOIN pixel.events e ON e.id = t.event_id AND e.occurred_at = t.occurred_at WHERE t.site_key LIKE 'touch_test_%' ORDER BY t.occurred_at, t.id`);
const byId = new Map(nativeRows.map((row) => [row.touch_key, row]));
// Strip only export control/native evidence fields; ownership is never manufactured.
const toTouch = ({ export_status, native_contact_id, ...touch }) => touch;
for (const test of cases) {
  const site = `touch_test_${test.name}`, sourceRows = eligible.filter((row) => row.source_scope === site);
  check('equal', sourceRows.length, test.events.length, `${test.name}: one native touch per accepted pageview`);
  check('equal', rows(`SELECT id FROM pixel.events WHERE site_key = ${literal(site)} AND event_type = 'pageview'`).length, test.events.length, `${test.name}: event count unchanged`);
  for (const row of sourceRows) {
    const event = test.events.find((entry) => entry.label === byId.get(row.touch_key).label);
    check('equal', row.occurred_at, event.occurred_at ?? timestamp(event.minute), `${test.name}: literal source event timestamp remains exact`);
  }
  const touches = sourceRows.map(toTouch), before = structuredClone(touches);
  const actual = dedupeTouches(touches);
  const label = (touch) => byId.get(touch.touch_key).label;
  check('deepEqual', actual.touches.map(label), test.kept, `${test.name}: actual SQL export -> real dedupe kept golden`);
  evidence.native_goldens.push({name:test.name,source_rows:sourceRows,expected_kept:test.kept,expected_suppressed:test.suppressed,actual,labels:Object.fromEntries(touches.map((row)=>[row.touch_key,label(row)]))});
  check('deepEqual', actual.suppressed.map((row) => [label(row), row.reason]), test.suppressed, `${test.name}: actual suppressed golden`);
  check('deepEqual', touches, before, `${test.name}: export remains immutable`);
  check('deepEqual', dedupeTouches([...touches].reverse()), actual, `${test.name}: full chronological replay independent of input order`);
  check('deepEqual', rows(`SELECT channel, pageviews FROM pixel.sessions WHERE source_scope = ${literal(site)} ORDER BY session_start_ts`).map((row) => [row.channel, row.pageviews]), test.sessions, `${test.name}: native source session golden`);
  const expectedDaily = [...new Set(test.sessions.map(([channel]) => channel))].sort().map((channel) => ({ channel, sessions: test.sessions.filter(([item]) => item === channel).length, conversions: 0 }));
  check('deepEqual', rows(`SELECT channel, sessions, conversions FROM pixel.channel_daily WHERE source_scope = ${literal(site)} ORDER BY channel`), expectedDaily, `${test.name}: daily source totals remain native`);
}
const urlClickRows = nativeRows.filter((row) => row.site_key === 'touch_test_url_clicks');
check('deepEqual', urlClickRows.map((row) => [row.gclid, row.utm_campaign]), [['One', 'A'], ['Two', 'A']], 'URL-only selected raw clicks/campaign preserved for export');
check('ok', urlClickRows.every((row) => row.utm.campaign === null && row.click_ids.gclid === null), 'event source fields remain raw supplied payload, not fabricated URL fields');
check('deepEqual', nativeRows.filter((row) => row.site_key === 'touch_test_url_plus').map((row) => row.gclid), ['A B', 'A%2BB'], 'selected URL raw values preserve parser plus versus encoded-plus distinction');
check('deepEqual', nativeRows.filter((row) => row.site_key === 'touch_test_bounded_raw').map((row) => [row.utm_campaign, row.gclid]), [['%252525252541', '%252525252541'], ['%41', '%41']], 'raw selected evidence is never replaced by decoded classifier values');
const sanitized = nativeRows.find((row) => row.site_key === 'touch_test_sanitized');
check('deepEqual', sanitized.utm, { source: ' Google ', medium: ' CPC ', campaign: 'Raw%2520+Case', content: null, term: null }, 'recognized raw UTM strings only');
check('equal', Object.keys(sanitized.click_ids).length, 13);
check('equal', sanitized.click_ids.gclid, ' Ab%252BC ', 'opaque encoded raw click remains unchanged');
check('equal', sanitized.click_ids.fbclid, null); check('equal', sanitized.click_ids.ttclid, null);
check('equal', JSON.stringify(sanitized).includes('private@example.com'), false, 'arbitrary nested tracking PII is not copied');
check('deepEqual', [sanitized.utm_source, sanitized.utm_medium, sanitized.utm_campaign, sanitized.utm_content, sanitized.utm_term, sanitized.gclid, sanitized.fbclid, sanitized.ttclid], [' Google ', ' CPC ', 'Raw%2520+Case', null, null, ' Ab%252BC ', null, null], 'touch columns receive the same sanitized raw strings');
check('deepEqual', nativeRows.filter((row) => row.site_key === 'touch_test_normalized').map((row) => row.utm.campaign), [' Summer+Launch ', 'summer%20launch'], 'redundant native event source evidence retained');
const scoped = eligible.filter((row) => ['touch_test_scope_a', 'touch_test_scope_b'].includes(row.source_scope));
check('equal', new Set(scoped.map((row) => row.visitor_key)).size, 2, 'same source visitor_uid remains site-scoped in database');
check('equal', dedupeTouches(scoped.map(toTouch)).touches.length, 2, 'site-scoped first Direct touch survives in each site');
const late = eligible.filter((row) => row.source_scope === 'touch_test_late').map(toTouch);
check('throws', () => dedupeTouches([late[0]], { existing_touches: [late.at(-1)] }), /full replay is required/, 'late source addition cannot use incremental shortcut');
// Existing duplicate payloads have distinct event/touch keys. Only stable business
// IDs could establish transport idempotency; signature suppression is attribution.
const duplicateRows = nativeRows.filter((row) => row.site_key === 'touch_test_transport_duplicates');
check('equal', new Set(duplicateRows.map((row) => row.touch_key)).size, 2, 'concurrent duplicate payloads are two native observations');
// Exercise nullable historical evidence and real repeated schema application.
sql(`INSERT INTO pixel.events (site_key, visitor_id, event_type, occurred_at) SELECT 'touch_test_scope_a', id, 'identify', '2026-09-02T00:00:00Z' FROM pixel.visitors WHERE site_key='touch_test_scope_a';
INSERT INTO pixel.touchpoints (site_key, visitor_id, channel, occurred_at) SELECT 'touch_test_scope_a', id, 'Display', '2026-09-02T00:00:00Z' FROM pixel.visitors WHERE site_key='touch_test_scope_a'`);
const snapshotQuery = `SELECT row_to_json(e)::text AS original FROM pixel.events e WHERE site_key='touch_test_scope_a' AND event_type='identify'`;
const historicalBefore = rows(snapshotQuery);
const exportBefore = rows(sourceSql);
for (let i = 0; i < 2; i += 1) execFileSync(psql, [process.env.DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', fileURLToPath(new URL('../assets/schema.sql', import.meta.url))], { stdio: ['ignore', 'ignore', 'pipe'] });
check('deepEqual', rows(snapshotQuery), historicalBefore, 'repeated migration preserves complete historical event');
check('deepEqual', rows(sourceSql), exportBefore, 'repeated schema application does not delete or reclassify native/legacy touches');
check('deepEqual', rows(`SELECT utm, click_ids FROM pixel.events WHERE site_key='touch_test_scope_a' AND event_type='identify'`), [{ utm: null, click_ids: null }], 'legacy missing raw evidence stays NULL, never fabricated objects');
check('ok', rows(sourceSql).some((row) => row.source_scope === 'touch_test_scope_a' && row.export_status === 'legacy_requires_reclassification' && row.taxonomy_version === null && row.channel === 'Display'), 'legacy label/version remains intact and excluded');
console.log(`PASS touch integration: ${cases.length} persisted journey goldens, ${posted} pageviews, ${assertions} assertions; actual SQL export -> identity dedupe; source sessions/daily and twice-reapplied legacy migration verified`);

console.log(`Saved full native touch evidence: ${evidencePath}`);

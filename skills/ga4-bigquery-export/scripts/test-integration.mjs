#!/usr/bin/env node
// Executes the actual standalone templates over synthetic nested GA4 events only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFile(path.join(here, file), 'utf8');
const fixture = JSON.parse(await read('../references/integration-fixtures.json'));
const templates = {};
for (const name of ['sessions', 'channel_daily']) {
  templates[name] = await read(`../references/sql/${name}.sql`);
  const body = templates[name].match(/AS r'''\n([\s\S]*?)\n''';/)[1];
  const classify = new Function('input_json', body);
  const parserBody = templates[name].match(/CREATE TEMP FUNCTION extract_landing_click_ids[\s\S]*?AS r'''\n([\s\S]*?)\n''';/)[1];
  const parseIds = new Function('landing_url', parserBody);
  assert.equal(parseIds('https://example.test/#?gclid=forged').gclid, null);
  assert.equal(parseIds('invalid?gclid=forged').gclid, null);
  assert.equal(parseIds('https://example.test/?%64clid=encoded').dclid, 'encoded');
  for (const item of fixture.classifier_cases) assert.equal(classify(JSON.stringify(item.input)), item.expected, `${name}: ${item.id}`);
}
assert.equal(templates.sessions.match(/-- BEGIN GENERATED SESSION CTES([\s\S]*?)-- END GENERATED SESSION CTES/)[1], templates.channel_daily.match(/-- BEGIN GENERATED SESSION CTES([\s\S]*?)-- END GENERATED SESSION CTES/)[1]);
console.log(`PASS generated UDFs: ${fixture.classifier_cases.length * 2} cases; identical session reduction`);
if (!process.argv.includes('--bigquery')) process.exit(0);
const setup = `CREATE TEMP TABLE synthetic_events AS
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
FROM UNNEST(JSON_QUERY_ARRAY(r'''${JSON.stringify(fixture.events)}''')) e;\n`;
const results = {};
for (const [name, template] of Object.entries(templates)) {
  let sql = template.replace('`PROJECT.analytics_PROPERTY_ID.events_*`', '(SELECT e.*, event_date AS _TABLE_SUFFIX FROM synthetic_events e)')
    .replace("'YYYYMMDD' AND 'YYYYMMDD'", "'20260901' AND '20260902'");
  // DECLARE must precede CREATE TEMP TABLE; all query logic remains verbatim.
  const end = sql.indexOf(';', sql.indexOf('DECLARE key_event_names')) + 1;
  sql = sql.slice(0, end) + '\n' + setup + sql.slice(end);
  const result = spawnSync('bq', ['query', '--use_legacy_sql=false', '--maximum_bytes_billed=20971520', '--format=json', '--max_rows=100'], { input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, `${name}: ${result.stderr}\n${result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  // bq may include CREATE TEMP TABLE status before the final SELECT's result array.
  results[name] = parsed.filter(Array.isArray).at(-1) || parsed;
}
const sessions = new Map(results.sessions.map((s) => [s.visitor_key, s]));
assert.equal(sessions.size, fixture.expected.sessions);
for (const [visitor, expected] of Object.entries(fixture.expected.visitors)) {
  const row = sessions.get(visitor); assert.ok(row, visitor);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(row[key], value, `${visitor}.${key}`);
}
const first = sessions.get('synthetic-multi');
assert.deepEqual(Object.keys(first.click_ids).sort(), fixture.click_id_names.slice().sort());
for (const key of fixture.click_id_names) assert.equal(first.click_ids[key], `synthetic-${key}`, key);
assert.equal(first.landing_gclid, 'synthetic-gclid');
assert.equal(first.landing_fbclid, 'synthetic-fbclid');
assert.equal(first.landing_ttclid, 'synthetic-ttclid');
for (const row of results.sessions) {
  assert.equal(row.source_system, 'ga4'); assert.equal(row.source_scope, 'PROJECT.analytics_PROPERTY_ID');
  assert.equal(row.attribution_basis, 'session_last_click'); assert.equal(row.taxonomy_version, '0.1.0');
  assert.match(row.event_date, /^2026-09-0[12]$/); assert.equal(row.reporting_timezone, null);
}
const daily = new Map(results.channel_daily.map((r) => [`${r.event_date}/${r.channel}`, r]));
assert.equal(daily.size, fixture.expected.daily.length);
for (const expected of fixture.expected.daily) {
  const row = daily.get(`${expected.event_date}/${expected.channel}`); assert.ok(row, expected.channel);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(row[key], value, `${expected.channel}.${key}`);
  assert.equal(row.currency, 'USD');
  const matching = results.sessions.filter((s) => s.channel === row.channel && s.event_date === row.event_date);
  assert.equal(Number(row.sessions), matching.length);
  assert.equal(Number(row.engaged_sessions), matching.filter((s) => s.engaged === 'true' || s.engaged === true).length);
  assert.equal(Number(row.key_events), matching.reduce((sum, s) => sum + Number(s.key_events), 0));
}
console.log(`PASS BigQuery actual templates: ${sessions.size} sessions, ${daily.size} canonical daily rows; no fanout, revenue NULLs, click IDs, and date boundaries`);

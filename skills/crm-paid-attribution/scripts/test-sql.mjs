import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { attributeLeads } from './attribute-leads.mjs';
import { TAXONOMY_VERSION } from './channel-taxonomy.mjs';
import { buildSql, generatedRuntime, fixtureInputCtes, outputPath, queryWithInputs, sqlString } from './build-sql.mjs';

const flags = process.argv.slice(2);
const option = (name, fallback) => { const index = flags.indexOf(name); return index < 0 ? fallback : flags[index + 1]; };
const live = flags.includes('--live');
function parseQueryOutput(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) && Array.isArray(parsed.at(-1)) ? parsed.at(-1) : parsed;
}
assert.deepEqual(parseQueryOutput(JSON.stringify(['Created temporary table', 'Assertion successful', [{ value: '2' }]])), [{ value: '2' }], 'mixed CLI script results');
assert.deepEqual(parseQueryOutput(JSON.stringify([{ value: '2' }])), [{ value: '2' }], 'plain CLI query results');
const { cases } = JSON.parse(await readFile(new URL('../references/fixtures.json', import.meta.url), 'utf8'));
const runtime = await generatedRuntime();
const artifact = await readFile(outputPath, 'utf8');
assert.equal(artifact, await buildSql(), 'generated SQL drift');
const udf = vm.runInNewContext(`(function (lead_json, options_json) { ${runtime.body} })`);
const plain = (value) => JSON.parse(JSON.stringify(value));
const key = (row) => JSON.stringify([row.source_system, row.source_scope, row.lead_key]);
function executeVm(fixture) {
  udf(null, JSON.stringify(fixture.input.options));
  const resolved = fixture.input.leads.map((lead) => plain(udf(JSON.stringify(lead), JSON.stringify(fixture.input.options))));
  const keys = new Set(); const winners = new Map();
  for (const row of resolved) {
    if (keys.has(key(row))) throw new TypeError('duplicate lead key'); keys.add(key(row));
    if (row._selected_click_value === null) continue;
    const group = JSON.stringify([row.source_system, row.source_scope, row.match_key, row._selected_click_value]);
    const prior = winners.get(group);
    const rank = row._created_at_epoch_seconds ?? Infinity; const priorRank = prior?._created_at_epoch_seconds ?? Infinity;
    const fraction = row._created_at_nanosecond ?? Infinity; const priorFraction = prior?._created_at_nanosecond ?? Infinity;
    if (!prior || rank < priorRank || (rank === priorRank && (fraction < priorFraction || (fraction === priorFraction && row.lead_key < prior.lead_key)))) winners.set(group, row);
  }
  return resolved.map((row) => {
    const { _selected_click_value, _created_at_epoch_seconds, _created_at_nanosecond, ...output } = row;
    const group = JSON.stringify([row.source_system, row.source_scope, row.match_key, _selected_click_value]);
    output.is_attribution_primary = _selected_click_value === null || winners.get(group) === row;
    return output;
  });
}
function assertGolden(actual, fixture) {
  for (const [field, expected] of Object.entries(fixture.expected)) {
    assert.deepEqual(field.split('.').reduce((value, key) => value?.[key], actual), expected, `${fixture.id}: independent golden ${field}`);
  }
}
const componentGoldens = [
  ['2026-01-01T00:00:00.000000001Z', 1767225600, 1],
  ['2025-12-31T19:00:00.123456789-05:00', 1767225600, 123456789],
  ['1969-12-31T23:59:59.999999999Z', -1, 999999999],
  ['9999-12-31T23:59:59.123456789Z', 253402300799, 123456789],
  [null, null, null]
];
for (const [created_at, seconds, nanosecond] of componentGoldens) {
  const row = plain(udf(JSON.stringify({ source_system: 'crm', source_scope: 'synthetic', lead_key: 'components', created_at }), '{}'));
  assert.equal(row._created_at_epoch_seconds, seconds, 'literal whole-second component');
  assert.equal(row._created_at_nanosecond, nanosecond, 'literal fractional component');
  if (seconds !== null) {
    assert.ok(Number.isSafeInteger(row._created_at_epoch_seconds));
    assert.ok(Number.isSafeInteger(row._created_at_nanosecond));
  }
}
const successes = cases.filter((fixture) => fixture.expectedError === undefined);
let vmErrors = 0;
for (const fixture of cases) {
  if (fixture.expectedError !== undefined) {
    assert.throws(() => executeVm(fixture), (error) => error.message.includes(fixture.expectedError), fixture.id); vmErrors += 1;
  } else {
    const actual = executeVm(fixture);
    assert.deepEqual(actual, attributeLeads(fixture.input.leads, fixture.input.options), `${fixture.id}: full VM result parity`);
    assertGolden(actual, fixture);
  }
}
// Executed regression mutant: millisecond truncation recreates the prior ranking bug.
const mutantUdf = vm.runInNewContext(`(function (lead_json, options_json) { ${runtime.body.replace("Number(fraction.padEnd(9, '0'))", "Number(fraction.slice(0, 3).padEnd(9, '0'))")} })`);
let precisionMutants = 0;
for (const fixture of successes.filter((entry) => entry.id.startsWith('temporal-') && entry.rejectMillisecondMutant)) {
  const rows = fixture.input.leads.map((lead) => plain(mutantUdf(JSON.stringify(lead), JSON.stringify(fixture.input.options))));
  const ordered = [...rows].sort((a, b) => a._created_at_epoch_seconds - b._created_at_epoch_seconds || a._created_at_nanosecond - b._created_at_nanosecond || (a.lead_key < b.lead_key ? -1 : 1));
  const expectedPrimary = Object.values(fixture.expected).find((row) => row.is_attribution_primary).lead_key;
  assert.notEqual(ordered[0].lead_key, expectedPrimary, `${fixture.id}: old millisecond mutant must select the wrong primary`);
  precisionMutants += 1;
}
assert.ok(precisionMutants >= 3, 'microsecond, nanosecond and pre-epoch mutants required');
assert.ok(!runtime.udf.includes('BigInt'), 'native JavaScript runtime must not require BigInt');
assert.ok(!artifact.includes('_created_at_epoch_ms'), 'no millisecond ordering remains');
console.log(`PASS ${precisionMutants} executed millisecond regression mutants rejected`);
console.log(`PASS generated UDF VM parity: ${successes.length} complete fixture results and ${vmErrors} structural failures`);
if (!live) {
  console.log('Live BigQuery not requested; run --live --project YOUR_BILLING_PROJECT for authenticated execution.');
} else {
  const project = option('--project');
  if (!project || project.startsWith('--')) throw new TypeError('--live requires --project YOUR_BILLING_PROJECT');
  const location = option('--location', 'US');
  const startedAt = new Date().toISOString();
  const reportPath = option('--report', join(homedir(), 'Downloads', `crm-paid-attribution-bigquery-evidence-${startedAt.replaceAll(/[^0-9]/g, '').slice(0, 14)}.json`));
  let report = { startedAt, completedAt: null, status: 'running', project, location, taxonomyVersion: TAXONOMY_VERSION, sourceSha256: runtime.digest, sqlSha256: createHash('sha256').update(artifact).digest('hex'), maximumBytesBilledPerJob: 1073741824, vmSuccessfulCases: successes.length, vmErrorCases: vmErrors, jobs: [] };
  const resumePath = option('--resume-report');
  if (resumePath) {
    const previous = JSON.parse(await readFile(resumePath, 'utf8'));
    assert.equal(previous.sourceSha256, runtime.digest, 'resume source digest must match');
    assert.equal(previous.sqlSha256, report.sqlSha256, 'resume published SQL digest must match');
    assert.equal(previous.project, project, 'resume project must match');
    assert.equal(previous.location, location, 'resume location must match');
    assert.notEqual(reportPath, resumePath, 'resume must preserve the prior evidence file');
    report = { ...previous, resumedFrom: resumePath, resumedAt: startedAt, previousFailure: previous.failure ?? null, failure: null, status: 'running', completedAt: null };
  }
  async function save() { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
  function command(args, input = '') {
    return new Promise((resolve, reject) => {
      const child = spawn('bq', args, { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
    });
  }
  async function query(label, sql, expectedError = null) {
    const sqlDigest = createHash('sha256').update(sql).digest('hex');
    if (expectedError && resumePath) {
      const prior = report.jobs.find((job) => job.label === label && job.sqlSha256 === sqlDigest && job.state === 'DONE' && job.actualError?.message?.includes(expectedError));
      if (prior) { console.log(`PASS preserved live failure evidence: ${label}`); return null; }
    }
    const jobId = `crm_paid_synthetic_${label.replaceAll(/[^a-zA-Z0-9_]/g, '_')}_${randomUUID().replaceAll('-', '')}`;
    const common = [`--project_id=${project}`, `--location=${location}`, '--format=json', '--quiet'];
    const execution = await command([...common, 'query', '--use_legacy_sql=false', '--use_cache=false', '--maximum_bytes_billed=1073741824', `--job_id=${jobId}`, '--max_rows=10000'], sql);
    const metadata = await command([...common, 'show', '--job', jobId]);
    let details = null;
    if (metadata.code === 0) details = JSON.parse(metadata.stdout);
    const record = { sql, rawQueryOutput: execution.stdout, rawQueryError: execution.stderr, rawJobMetadata: details, label, jobId, jobReference: details?.jobReference ?? null, state: details?.status?.state ?? null, expectedError, actualError: details?.status?.errorResult ?? null, totalBytesProcessed: details?.statistics?.query?.totalBytesProcessed ?? null, totalBytesBilled: details?.statistics?.query?.totalBytesBilled ?? null, totalSlotMs: details?.statistics?.totalSlotMs ?? null, cacheHit: details?.statistics?.query?.cacheHit ?? null, cliExitCode: execution.code, configuredMaximumBytesBilled: details?.configuration?.query?.maximumBytesBilled ?? null, useLegacySql: details?.configuration?.query?.useLegacySql ?? null, sqlSha256: createHash('sha256').update(sql).digest('hex') };
    report.jobs.push(record); await save();
    assert.equal(metadata.code, 0, `Cannot capture job evidence: ${metadata.stderr || metadata.stdout}`);
    assert.equal(record.state, 'DONE', `${label}: job did not finish`);
    assert.equal(String(record.configuredMaximumBytesBilled), '1073741824', `${label}: billed-bytes cap not confirmed`);
    assert.equal(record.useLegacySql, false, `${label}: Standard SQL not confirmed`);
    if (expectedError) {
      assert.notEqual(execution.code, 0, `${label}: invalid SQL input unexpectedly passed`);
      assert.ok(record.actualError, `${label}: missing actual BigQuery error`);
      assert.ok(`${record.actualError.message} ${execution.stdout} ${execution.stderr}`.includes(expectedError), `${label}: wrong BigQuery error: ${JSON.stringify(record.actualError)}`);
      console.log(`PASS live BigQuery expected failure: ${label}`); return null;
    }
    assert.equal(execution.code, 0, `${label}: ${execution.stdout}\n${execution.stderr}`);
    assert.equal(record.actualError, null, `${label}: unexpected BigQuery job error`);
    // bq mixes statement-status strings and nested SELECT arrays in script output.
    return parseQueryOutput(execution.stdout);
  }
  try {
    report.bqVersion = (await command(['version'])).stdout.trim(); await save();
    const expectedFixtureSqlHash = createHash('sha256').update(queryWithInputs(runtime.udf, fixtureInputCtes(successes), true)).digest('hex');
    const hasVerifiedFixtureJob = report.jobs.some((job) => job.label === 'all_successful_fixtures' && job.sqlSha256 === expectedFixtureSqlHash && job.state === 'DONE' && job.actualError === null);
    const hasVerifiedExampleJob = report.jobs.some((job) => job.label === 'standalone_example' && job.sqlSha256 === report.sqlSha256 && job.state === 'DONE' && job.actualError === null);
    const alreadyCompared = resumePath && hasVerifiedFixtureJob && hasVerifiedExampleJob && report.liveSuccessfulCases === successes.length && report.liveComparedLeadRows === successes.reduce((sum, fixture) => sum + fixture.input.leads.length, 0);
    if (!alreadyCompared) {
    // Execute the published standalone script itself before the fixture-adapted query.
    const example = await query('standalone_example', artifact);
    assert.equal(example.length, 3, 'standalone example retains all synthetic leads');
    assert.equal(example.find((row) => row.lead_key === 'demo-first').ad_key, 'DemoAd+Case');
    assert.equal(String(example.find((row) => row.lead_key === 'demo-later').is_attribution_primary), 'false');
    const fixtureSql = queryWithInputs(runtime.udf, fixtureInputCtes(successes), true);
    const rows = await query('all_successful_fixtures', fixtureSql);
    let comparedRows = 0;
    for (const fixture of successes) {
      const actual = rows.filter((row) => row.fixture_id === fixture.id).sort((a, b) => Number(a.input_position) - Number(b.input_position)).map((row) => JSON.parse(row.result_json));
      const expected = attributeLeads(fixture.input.leads, fixture.input.options);
      assert.deepEqual(actual, expected, `${fixture.id}: full authenticated BigQuery/JS parity`);
      assertGolden(actual, fixture); comparedRows += actual.length;
    }
    assert.equal(rows.length, comparedRows, 'no extra BigQuery fixture rows');
    report.liveSuccessfulCases = successes.length; report.liveComparedLeadRows = comparedRows;
    console.log(`PASS authenticated BigQuery parity: ${successes.length} full fixture cases, ${comparedRows} lead rows`);
    } else console.log(`PASS preserved authenticated parity: ${report.liveSuccessfulCases} cases, ${report.liveComparedLeadRows} rows`);
    for (const id of ['duplicate-scoped-lead-key', 'conflicting-catalog-campaign_key', 'missing-binding-ad_source_scope', 'invalid-date-calendar', 'invalid-date-naive']) {
      const fixture = cases.find((entry) => entry.id === id); assert.ok(fixture, `required error fixture ${id}`);
      await query(id, queryWithInputs(runtime.udf, fixtureInputCtes([fixture]), true), fixture.expectedError);
    }
    const one = successes[0];
    const optionsJson = sqlString(JSON.stringify(one.input.options));
    const leadJson = sqlString(JSON.stringify(one.input.leads[0]));
    for (const fixtureMode of [false, true]) for (const mode of ['missing', 'duplicate']) {
      const namespace = fixtureMode ? `${sqlString(one.id)} AS fixture_id, ` : '';
      const configuration = `SELECT ${namespace}${optionsJson} AS options_json`;
      const inputCtes = { configuration: mode === 'missing' ? `SELECT * FROM (${configuration}) WHERE FALSE` : `${configuration} UNION ALL ${configuration}`, leads: `SELECT ${namespace}0 AS input_position, ${leadJson} AS lead_json` };
      const expectedError = fixtureMode ? `${mode} fixture configuration` : 'exactly one configuration row is required';
      await query(`${fixtureMode ? 'fixture' : 'production'}_${mode}_configuration`, queryWithInputs(runtime.udf, inputCtes, fixtureMode), expectedError);
    }
    report.liveErrorCases = 9; report.status = 'passed'; report.completedAt = new Date().toISOString(); await save();
    const document = new URL('../references/sql.md', import.meta.url);
    const text = await readFile(document, 'utf8');
    const status = `<!-- execution-status:start -->\nAuthenticated synthetic BigQuery execution passed on ${report.completedAt.slice(0, 10)} using\ntaxonomy ${TAXONOMY_VERSION}: the standalone example, ${successes.length} successful API fixture cases\n(${report.liveComparedLeadRows} full lead outputs), and ${report.liveErrorCases} expected SQL failures. Local generated-UDF VM checks\ncovered all ${cases.length} fixtures. Every live job had a 1 GiB billed-bytes cap.\nThis is correctness evidence, not a large-scale performance benchmark. Private job identifiers,\nbilling project, and measured bytes remain in the local execution report.\n<!-- execution-status:end -->`;
    assert.ok(text.includes('<!-- execution-status:start -->'), 'public status marker required');
    await writeFile(document, text.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/, status));
    console.log(`Saved private execution evidence: ${reportPath}`);
  } catch (error) {
    report.status = 'failed'; report.completedAt = new Date().toISOString(); report.failure = error.message; await save(); throw error;
  }
}

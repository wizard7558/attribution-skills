import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const sqlFile = new URL('../references/sql/stage_truth.sql', import.meta.url);
const fixtureFile = new URL('../references/stage-fixtures.json', import.meta.url);
const sql = await readFile(sqlFile, 'utf8');
const fixtureText = await readFile(fixtureFile, 'utf8');
const { cases } = JSON.parse(fixtureText);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
const metadata = ['channel', 'taxonomy_version', 'network_id', 'campaign_key', 'ad_source_system', 'ad_source_scope', 'ad_key'];
const schemas = {
  invocation_input: { source_system: 'STRING', source_scope: 'STRING', report_timezone: 'STRING', as_of: 'TIMESTAMP', opportunities_complete: 'BOOL' },
  lead_input: { source_system: 'STRING', source_scope: 'STRING', lead_key: 'STRING', created_at: 'TIMESTAMP', status: 'STRING', is_converted: 'BOOL', converted_at: 'TIMESTAMP', qualified_at: 'TIMESTAMP', is_attribution_primary: 'BOOL', ...Object.fromEntries(metadata.map((key) => [key, 'STRING'])) },
  stage_input: { stage_key: 'STRING', stage_order: 'FLOAT64', stage_kind: 'STRING' },
  exclusion_input: { stage_key: 'STRING', status: 'STRING' },
  opportunity_input: { source_system: 'STRING', source_scope: 'STRING', opportunity_key: 'STRING', lead_source_system: 'STRING', lead_source_scope: 'STRING', lead_key: 'STRING', is_won: 'BOOL', won_at: 'TIMESTAMP', value: 'NUMERIC', currency: 'STRING', value_status: 'STRING' },
  event_input: { source_system: 'STRING', source_scope: 'STRING', event_key: 'STRING', lead_source_system: 'STRING', lead_source_scope: 'STRING', lead_key: 'STRING', stage_key: 'STRING', occurred_at: 'TIMESTAMP' }
};
function literal(value, type) {
  if (value === undefined || value === null) return `CAST(NULL AS ${type})`;
  if (type === 'BOOL' && typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `CAST(${quote(value)} AS ${type})`;
}
function renderTable(name, rows) {
  const fields = { invocation_key: 'STRING', ...schemas[name] };
  const select = (row) => `SELECT ${Object.entries(fields).map(([key, type]) => `${literal(row[key], type)} AS ${key}`).join(', ')}`;
  return `CREATE TEMP TABLE ${name} AS\n${rows.length ? rows.map(select).join('\nUNION ALL\n') : `${select({})} FROM UNNEST(ARRAY<INT64>[])`};`;
}
function fixtureQuery(fixtures) {
  const inputs = Object.fromEntries(Object.keys(schemas).map((key) => [key, []]));
  const names = { lead_input: 'leads', stage_input: 'stages', exclusion_input: 'exclusions', opportunity_input: 'opportunities', event_input: 'events' };
  for (const fixture of fixtures) {
    const configRows = fixture.input.configuration_rows ?? [fixture.input.configuration];
    for (const row of configRows) inputs.invocation_input.push({ ...row, invocation_key: fixture.id });
    for (const [table, field] of Object.entries(names)) for (const row of fixture.input[field]) inputs[table].push({ ...row, invocation_key: fixture.id });
  }
  return sql.replace(/-- BEGIN REPLACEABLE INPUTS[\s\S]*?-- END REPLACEABLE INPUTS/, () => Object.entries(inputs).map(([name, rows]) => renderTable(name, rows)).join('\n'))
    .replace(/-- BEGIN INVOCATION CARDINALITY CHECK[\s\S]*?-- END INVOCATION CARDINALITY CHECK/, "-- Independent synthetic test invocations only; production retains its single-invocation assertion.");
}
const flags = process.argv.slice(2);
const option = (name, fallback) => { const index = flags.indexOf(name); return index < 0 ? fallback : flags[index + 1]; };
const successes = cases.filter((fixture) => fixture.expected !== undefined);
const failures = cases.filter((fixture) => fixture.expectedError !== undefined);
assert.equal(new Set(cases.map((fixture) => fixture.id)).size, cases.length, 'unique fixture IDs');
assert.equal(successes.length + failures.length, cases.length, 'every fixture has executable expected output or error');
assert.ok(!/LANGUAGE\s+js/i.test(sql), 'stage logic must remain native SQL');
for (const fixture of successes) {
  assert.ok(Array.isArray(fixture.expected.ledger)); assert.ok(fixture.expected.diagnostics);
  assert.ok(Array.isArray(fixture.input.leads)); assert.ok(Array.isArray(fixture.input.stages));
}
if (!flags.includes('--live')) {
  console.log(`Validated ${cases.length} fixture definitions; native SQL has not been executed. Use --live --project YOUR_BILLING_PROJECT.`);
} else {
  const project = option('--project'); if (!project || project.startsWith('--')) throw new TypeError('--live requires --project');
  const location = option('--location', 'US'); const now = new Date().toISOString();
  const reportPath = option('--report', join(homedir(), 'Downloads', `funnel-stage-truth-bigquery-evidence-${now.replaceAll(/[^0-9]/g, '').slice(0, 14)}.json`));
  let report = { startedAt: now, completedAt: null, status: 'running', project, location, stageContractVersion: '0.1.0', sqlSha256: hash(sql), fixtureSha256: hash(fixtureText), maximumBytesBilledPerJob: 1073741824, jobs: [] };
  const resumePath = option('--resume-report');
  if (resumePath) {
    const old = JSON.parse(await readFile(resumePath, 'utf8'));
    assert.equal(old.sqlSha256, report.sqlSha256); assert.equal(old.fixtureSha256, report.fixtureSha256);
    assert.equal(old.project, project); assert.equal(old.location, location); assert.notEqual(resumePath, reportPath);
    report = { ...old, resumedFrom: resumePath, resumedAt: now, previousFailure: old.failure ?? null, failure: null, status: 'running', completedAt: null };
  }
  let saveQueue = Promise.resolve();
  async function save() {
    const snapshot = `${JSON.stringify(report, null, 2)}\n`;
    saveQueue = saveQueue.then(async () => { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, snapshot); });
    await saveQueue;
  }
  async function command(args, input = '') {
    return new Promise((resolve, reject) => {
      const child = spawn('bq', args, { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
    });
  }
  const deltaPath = option('--validation-delta-report');
  let priorDelta = null;
  if (deltaPath) {
    assert.ok(!resumePath, 'choose resume or validation-delta mode');
    priorDelta = JSON.parse(await readFile(deltaPath, 'utf8'));
    const removeValidation = (text) => text.replace(/     -- BEGIN OPTIONAL KEY VALIDATION\n[\s\S]*?     -- END OPTIONAL KEY VALIDATION\n/, '');
    assert.notEqual(removeValidation(sql), sql, 'explicit optional-key validation delta required');
    assert.equal(hash(removeValidation(sql)), priorDelta.sqlSha256, 'only the reviewed optional-key validation may differ');
    assert.equal(priorDelta.project, project); assert.equal(priorDelta.location, location);
    const oldJob = priorDelta.jobs.find((job) => job.label === 'all_successful_fixtures' && job.verification === 'passed');
    assert.ok(oldJob); assert.equal(hash(removeValidation(fixtureQuery(successes))), oldJob.sqlSha256, 'successful fixture inputs must match the prior completed SQL job');
    const result = await command([`--project_id=${project}`, `--location=${location}`, '--format=json', '--quiet', 'head', '--job', '--max_rows=10000', oldJob.jobId]);
    assert.equal(result.code, 0, result.stderr); let rows = JSON.parse(result.stdout);
    if (Array.isArray(rows.at(-1))) rows = rows.at(-1);
    let ledgerRows = 0;
    for (const fixture of successes) {
      const actual = JSON.parse(rows.find((row) => row.invocation_key === fixture.id).result_json);
      assert.deepEqual(actual, fixture.expected, `${fixture.id}: preserved native evidence`); ledgerRows += actual.ledger.length;
    }
    report.priorStageEvidence = { reportPath: deltaPath, sqlSha256: priorDelta.sqlSha256, jobId: oldJob.jobId, successfulFixtureCases: successes.length, comparedLedgerRows: ledgerRows, validationDeltaProof: 'Removing only the explicitly marked optional network/campaign identity validation exactly reproduces the prior SQL and successful fixture query hashes.' };
    report.successfulFixtureCases = successes.length; report.comparedLedgerRows = ledgerRows; report.fullGoldenComparisons = successes.length;
    console.log(`PASS preserved native golden results: ${successes.length} fixtures, ${ledgerRows} rows; exact validation-only SQL delta proved`);
  }
  async function run(label, query, expectedError = null) {
    const queryHash = hash(query);
    const prior = report.jobs.find((job) => job.label === label && job.sqlSha256 === queryHash && job.verification === 'passed');
    if (resumePath && prior) { console.log(`PASS preserved native SQL evidence: ${label}`); return { prior, rows: null }; }
    const jobId = `funnel_stage_synthetic_${label.replaceAll(/[^a-zA-Z0-9_]/g, '_')}_${randomUUID().replaceAll('-', '')}`;
    const common = [`--project_id=${project}`, `--location=${location}`, '--format=json', '--quiet'];
    const execution = await command([...common, 'query', '--use_legacy_sql=false', '--use_cache=false', '--maximum_bytes_billed=1073741824', `--job_id=${jobId}`, '--max_rows=10000'], query);
    const shown = await command([...common, 'show', '--job', jobId]);
    const detail = shown.code === 0 ? JSON.parse(shown.stdout) : null;
    const record = { label, jobId, jobReference: detail?.jobReference ?? null, state: detail?.status?.state ?? null, expectedError, actualError: detail?.status?.errorResult ?? null, totalBytesProcessed: detail?.statistics?.query?.totalBytesProcessed ?? null, totalBytesBilled: detail?.statistics?.query?.totalBytesBilled ?? null, totalSlotMs: detail?.statistics?.totalSlotMs ?? null, configuredMaximumBytesBilled: detail?.configuration?.query?.maximumBytesBilled ?? null, useLegacySql: detail?.configuration?.query?.useLegacySql ?? null, sqlSha256: queryHash, verification: 'pending' };
    report.jobs.push(record); await save();
    assert.equal(shown.code, 0, shown.stderr || shown.stdout); assert.equal(record.state, 'DONE');
    assert.equal(record.useLegacySql, false); assert.equal(String(record.configuredMaximumBytesBilled), '1073741824');
    if (expectedError) {
      assert.notEqual(execution.code, 0, `${label}: invalid input unexpectedly succeeded`);
      assert.ok(record.actualError?.message?.includes(expectedError), `${label}: wrong error: ${JSON.stringify(record.actualError)}`);
      record.verification = 'passed'; await save(); console.log(`PASS live native SQL failure: ${label}`); return { record, rows: null };
    }
    assert.equal(execution.code, 0, `${label}: ${execution.stdout}\n${execution.stderr}`); assert.equal(record.actualError, null);
    const parsed = JSON.parse(execution.stdout); return { record, rows: Array.isArray(parsed.at(-1)) ? parsed.at(-1) : parsed };
  }
  try {
    report.bqVersion = (await command(['version'])).stdout.trim(); await save();
    const example = await run('standalone_example', sql);
    if (example.rows) {
      assert.equal(example.rows.length, 1); const result = JSON.parse(example.rows[0].result_json);
      assert.equal(result.ledger.length, 5); const won = result.ledger.find((row) => row.stage_kind === 'won');
      assert.equal(won.achieved, true); assert.equal(won.value, 150); assert.equal(won.evidence_keys.length, 2);
      assert.ok(result.ledger.every((row) => row.is_attribution_primary === false));
      example.record.verification = 'passed'; await save(); console.log('PASS standalone native stage ledger');
    }
    const activeSuccesses = priorDelta ? successes.filter((fixture) => fixture.id === 'incomplete-feed-and-nonprimary-metadata') : successes;
    const batch = await run(priorDelta ? 'affected_metadata_fixture' : 'all_successful_fixtures', fixtureQuery(activeSuccesses));
    if (batch.rows) {
      assert.equal(batch.rows.length, activeSuccesses.length);
      let ledgerRows = 0;
      for (const fixture of activeSuccesses) {
        const found = batch.rows.find((row) => row.invocation_key === fixture.id); assert.ok(found, `${fixture.id}: missing invocation result`);
        const actual = JSON.parse(found.result_json);
        assert.deepEqual(actual, fixture.expected, `${fixture.id}: full independent golden ledger and diagnostics`);
        ledgerRows += actual.ledger.length; console.log(`PASS native SQL fixture: ${fixture.id}`);
      }
      report.currentSqlSuccessfulFixtureCases = activeSuccesses.length; report.currentSqlComparedLedgerRows = ledgerRows;
      if (!priorDelta) { report.successfulFixtureCases = successes.length; report.comparedLedgerRows = ledgerRows; report.fullGoldenComparisons = successes.length; }
      batch.record.verification = 'passed'; await save();
    }
    for (let index = 0; index < failures.length; index += 3) {
      const settled = await Promise.allSettled(failures.slice(index, index + 3).map((fixture) => run(fixture.id, fixtureQuery([fixture]), fixture.expectedError)));
      for (const result of settled) if (result.status === 'rejected') throw result.reason;
    }
    // The production-only cardinality guard is independently exercised, not replaced by test namespaces.
    const missingProduction = sql.replace(/CREATE TEMP TABLE invocation_input AS[\s\S]*?;/,()=> renderTable('invocation_input', []));
    const duplicateProduction = sql.replace(/CREATE TEMP TABLE invocation_input AS([\s\S]*?);/, 'CREATE TEMP TABLE invocation_input AS SELECT * FROM ($1) UNION ALL SELECT * FROM ($1);');
    await run('production_missing_configuration', missingProduction, 'exactly one invocation configuration is required');
    await run('production_duplicate_configuration', duplicateProduction, 'exactly one invocation configuration is required');
    report.structuralFailureCases = failures.length + 2; report.executedFixtureCases = cases.length;
    report.status = 'passed'; report.completedAt = new Date().toISOString(); await save();
    const doc = new URL('../references/stage-contract.md', import.meta.url);
    const content = await readFile(doc, 'utf8');
    const revisionNote = priorDelta ? `The ${successes.length} successful golden fixtures (${report.comparedLedgerRows} ledger rows) were preserved\nfrom the verified stage-logic revision. Removing only the added optional-key validation\nexactly reproduces that prior SQL hash. Final SQL independently reran the standalone\nreference and the affected metadata fixture (${report.currentSqlComparedLedgerRows} ledger rows).` : `The standalone reference and ${successes.length} successful fixtures (${report.comparedLedgerRows} ledger rows) passed on this SQL revision.`;
    const status = `<!-- execution-status:start -->\nAuthenticated native BigQuery checks passed on ${report.completedAt.slice(0, 10)}.\n${revisionNote}\nFinal SQL also passed ${failures.length} structural fixture failures and two production\nconfiguration failures. Every job confirmed Standard SQL and a 1 GiB billed-bytes cap.\nPrivate job IDs, billing project, CLI version, revision hashes, and measured bytes remain\nin the Downloads reports. This is correctness evidence, not a scale or cost benchmark.\n<!-- execution-status:end -->`;
    assert.ok(content.includes('<!-- execution-status:start -->'));
    await writeFile(doc, content.replace(/<!-- execution-status:start -->[\s\S]*?<!-- execution-status:end -->/, status));
    console.log(`PASS ${cases.length} executed fixture cases and 2 production failure cases; saved ${reportPath}`);
  } catch (error) { report.status = 'failed'; report.completedAt = new Date().toISOString(); report.failure = error.message; await save(); throw error; }
}

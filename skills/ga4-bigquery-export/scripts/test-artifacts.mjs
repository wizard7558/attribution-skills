#!/usr/bin/env node
// Repository-only regression for the bundler; never mutates working-tree artifacts.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const skills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(path.join(tmpdir(), 'attribution-artifacts-'));
const generator = 'channel-taxonomy/scripts/build-artifacts.mjs';
const artifacts = [
  'channel-taxonomy/references/sql/classify_channels.sql',
  'first-party-pixel/assets/collector/channel-taxonomy.mjs',
  'ga4-bigquery-export/references/channel-contract.md',
  'first-party-pixel/references/channel-contract.md',
  'ga4-bigquery-export/references/sql/sessions.sql',
  'ga4-bigquery-export/references/sql/channel_daily.sql',
  'ga4-bigquery-export/references/sql/landing_pages.sql',
  'ga4-bigquery-export/references/sql/traffic_source_compare.sql',
  'ga4-bigquery-export/references/sql/params.sql',
  'ga4-bigquery-export/references/sql/key_events.sql',
  'ga4-bigquery-export/references/sql/ui_reconciliation.sql'
];
const run = (root, args) => spawnSync(process.execPath, [path.join(root, generator), ...args], { encoding: 'utf8' });
try {
  const isolated = path.join(temp, 'isolated');
  await mkdir(isolated);
  await cp(path.join(skills, 'channel-taxonomy'), path.join(isolated, 'channel-taxonomy'), { recursive: true });
  for (const args of [[], ['--check']]) {
    const result = run(isolated, args); assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(await readdir(isolated), ['channel-taxonomy']);
  assert.notEqual(run(isolated, ['--repository', '--check']).status, 0);
  const repository = path.join(temp, 'repository');
  const files = [generator, 'channel-taxonomy/scripts/channel-taxonomy.mjs',
    'channel-taxonomy/references/channel-contract.md', 'ga4-bigquery-export/scripts/session-ctes.sql',
    'ga4-bigquery-export/scripts/parameter-helpers.sql',
    'ga4-bigquery-export/SKILL.md', 'first-party-pixel/SKILL.md', ...artifacts];
  for (const file of files) {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await cp(path.join(skills, file), path.join(repository, file));
  }
  let result = run(repository, ['--repository', '--check']); assert.equal(result.status, 0, result.stderr);
  for (const artifact of artifacts) {
    const target = path.join(repository, artifact); const original = await readFile(target, 'utf8');
    const stale = artifact.endsWith('.sql') ? (original.includes("const TAXONOMY_VERSION =") ? original.replace("const TAXONOMY_VERSION =", "const STALE_TAXONOMY_VERSION =") : original.replace("SELECT p.value", "SELECT STALE.value")) : original + '\nSTALE\n';
    assert.notEqual(stale, original); await writeFile(target, stale);
    result = run(repository, ['--repository', '--check']); assert.notEqual(result.status, 0, artifact);
    await writeFile(target, original);
  }
  for (const [name, marker] of [['landing_pages.sql', 'COUNTIF(event_name IN UNNEST(key_event_names))'], ['traffic_source_compare.sql', "result.landing_url_status = 'valid'"]]) {
    const target = path.join(repository, 'ga4-bigquery-export/references/sql', name);
    const original = await readFile(target, 'utf8');
    assert.ok(original.includes(marker));
    await writeFile(target, original.replace(marker, marker + ' STALE'));
    assert.notEqual(run(repository, ['--repository', '--check']).status, 0, name);
    await writeFile(target, original);
  }
  for (const name of ['sessions', 'channel_daily', 'landing_pages', 'traffic_source_compare', 'params', 'key_events', 'ui_reconciliation']) {
    const target = path.join(repository, `ga4-bigquery-export/references/sql/${name}.sql`);
    const original = await readFile(target, 'utf8');
    const mutated = original.replace('ORDER BY parameter_offset LIMIT 1', 'ORDER BY parameter_offset DESC LIMIT 1');
    assert.notEqual(mutated, original);
    await writeFile(target, mutated);
    assert.notEqual(run(repository, ['--repository', '--check']).status, 0, name + ' helper drift');
    await writeFile(target, original);
  }
  const authority = path.join(repository, 'ga4-bigquery-export/scripts/parameter-helpers.sql');
  const authorityText = await readFile(authority, 'utf8');
  await rm(authority);
  assert.notEqual(run(repository, ['--repository', '--check']).status, 0, 'missing GA4 parameter authority');
  await writeFile(authority, authorityText + '\n-- authority drift\n');
  assert.notEqual(run(repository, ['--repository', '--check']).status, 0, 'authority drift');
  await writeFile(authority, authorityText);
  console.log(`PASS standalone generator isolation and drift detection for all ${artifacts.length} shared artifacts both companion blocks and all seven parameter-helper blocks`);
} finally { await rm(temp, { recursive: true, force: true }); }

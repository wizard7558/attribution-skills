#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, GROUPS, writeManifest } from './build-eval-cases.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(dir, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(skillDir, 'references', 'fixtures.json'), 'utf8'));
const manifestPath = path.join(skillDir, 'references', 'eval-cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const rebuilt = buildManifest(fixtures);

assert.deepEqual(manifest, rebuilt, 'manifest is stale; run build-eval-cases.mjs');
assert.deepEqual(manifest.context_files, ['SKILL.md', 'references/api.md', 'scripts/profile.mjs']);
assert.equal(manifest.groups.length, 3);
assert.deepEqual(manifest.groups.map((group) => group.id), GROUPS.map((group) => group.id));
assert.deepEqual(manifest.groups.map((group) => group.input.cases.length), [4, 3, 3]);

const serialized = JSON.stringify(manifest);
for (const forbidden of ['authorized-cross-system', 'unauthorized-ad-source_scope', 'opaque-plus-distinct-from-space', 'conservative-exclusion-denominator', 'pre-window-real-recent-cohort']) {
  assert.equal(serialized.includes(forbidden), false, `fixture name leaked into manifest: ${forbidden}`);
}
assert.equal(serialized.includes('email'), false, 'unrelated fixture data leaked into context/input');
for (const group of manifest.groups) {
  assert.match(group.prompt, /independently/);
  assert.match(group.prompt, /snake_case/);
  assert.equal(group.input.cases.every((item, i) => item.case_id === String.fromCharCode(65 + i)), true);
  assert.equal(group.checks.length, group.input.cases.length * 9);
  assert.deepEqual(group.output_schema.properties.results.required, group.input.cases.map((item) => item.case_id));
  assert.equal(group.output_schema.properties.results.additionalProperties, false);
  for (const item of group.input.cases) assert.equal(Object.hasOwn(group.output_schema.properties.results.properties, item.case_id), true);
}

for (const group of GROUPS) {
  for (const fixtureId of group.fixtureIds) {
    const mutated = JSON.parse(JSON.stringify(fixtures));
    const fixture = mutated.cases.find((candidate) => candidate.id === fixtureId);
    fixture.input.source.rows = fixture.input.source.rows?.length ? fixture.input.source.rows.map((row) => ({ ...row, [fixture.input.timestampField ?? 'at']: '2026-01-15T12:00:00Z' })) : [{ at: '2026-01-15T12:00:00Z' }];
    if (fixture.expected?.['candidates.0.verdict']) fixture.expected['candidates.0.verdict'] = fixture.expected['candidates.0.verdict'] === 'reject' ? 'propose' : 'reject';
    else fixture.expected['candidates.0.verdict'] = 'reject';
    assert.throws(() => buildManifest(mutated), /Golden drift/, `mutation must fail for ${fixtureId}`);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiler-eval-'));
const tempManifest = path.join(tempDir, 'eval-cases.json');
writeManifest({ target: tempManifest });
const beforeCheck = fs.readFileSync(tempManifest, 'utf8');
writeManifest({ check: true, target: tempManifest });
assert.equal(fs.readFileSync(tempManifest, 'utf8'), beforeCheck, 'successful --check must not rewrite bytes');
fs.writeFileSync(tempManifest, `${beforeCheck}\n`);
assert.throws(() => writeManifest({ check: true, target: tempManifest }), /stale evaluation manifest/);
assert.equal(fs.readFileSync(tempManifest, 'utf8'), `${beforeCheck}\n`, 'failed --check must not rewrite bytes');
fs.rmSync(tempDir, { recursive: true, force: true });

const scorer = `
import importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location('harness', 'scripts/run-skill-evals.py')
harness = importlib.util.module_from_spec(spec); spec.loader.exec_module(harness)
m = json.loads(pathlib.Path(sys.argv[1]).read_text())
for group in m['groups']:
    result = {}
    for check in group['checks']:
        parts = check['path'].split('/')[1:]
        case_id, field = parts[1], parts[2]
        result.setdefault(case_id, {})[field] = check['expected']
    parsed = {'results': result}
    for check in group['checks']:
        assert harness.compare(check, parsed)['passed'], (group['id'], check)
    for check in group['checks']:
        bad = json.loads(json.dumps(parsed)); bad['results'][check['path'].split('/')[2]][check['path'].split('/')[3]] = '__mutated__'
        assert not harness.compare(check, bad)['passed'], (group['id'], check)
print('PASS generic scorer projected goldens and per-field mutations')
`;
const scored = spawnSync('python3', ['-c', scorer, manifestPath], { cwd: path.resolve(dir, '../../..'), encoding: 'utf8' });
assert.equal(scored.status, 0, scored.stdout + scored.stderr);
assert.match(scored.stdout, /PASS generic scorer/);

console.log('PASS profiler eval manifest: exact groups/cases, neutral inputs, independent golden checks, and mutation guards');

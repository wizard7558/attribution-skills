#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, GROUPS, writeManifest } from './build-eval-cases.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(dir, '..');
const repoDir = path.resolve(skillDir, '../..');
const manifestPath = path.join(skillDir, 'references/eval-cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const rebuilt = await buildManifest();
assert.deepEqual(manifest, rebuilt, 'manifest is stale; run build-eval-cases.mjs');
assert.deepEqual(manifest.context_files, ['SKILL.md', 'references/audit-contract.md', 'references/entrypoints.json']);
assert.deepEqual(manifest.groups.map((group) => group.id), GROUPS.map((group) => group.id));
assert.deepEqual(manifest.groups.map((group) => group.input.cases.length), [3, 3, 3]);
for (const group of manifest.groups) {
  assert.match(group.prompt, /independently/);
  assert.ok(group.checks.some((check) => check.path === '/cases' && check.op === 'array_length_equals'));
}
const scorer = `
import importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location('harness', 'scripts/run-skill-evals.py')
harness = importlib.util.module_from_spec(spec); spec.loader.exec_module(harness)
m = json.loads(pathlib.Path(sys.argv[1]).read_text())
for group in m['groups']:
    parsed = {'cases': []}
    for check in group['checks']:
        if check['path'] == '/cases' and check['op'] == 'array_length_equals':
            continue
        parts = check['path'].split('/')[1:]
        index = int(parts[1])
        while len(parsed['cases']) <= index:
            parsed['cases'].append({'case_id': chr(65 + len(parsed['cases'])), 'output': {}})
        if parts[2] == 'case_id':
            parsed['cases'][index]['case_id'] = check['expected']
        else:
            field = parts[3]
            parsed['cases'][index]['output'][field] = check['expected']
    for check in group['checks']:
        assert harness.compare(check, parsed)['passed'], (group['id'], check)
print('PASS generic scorer projected goldens')
`;
const scored = spawnSync('python3', ['-c', scorer, manifestPath], { cwd: repoDir, encoding: 'utf8' });
assert.equal(scored.status, 0, scored.stdout + scored.stderr);
console.log('PASS attribution-audit eval manifest');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, EXPECTED_PROJECTIONS, GROUPS, writeManifest } from './build-eval-cases.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const skillDir = path.resolve(dir, '..');
const repoDir = path.resolve(skillDir, '../..');
const fixtures = JSON.parse(fs.readFileSync(path.join(skillDir, 'references', 'fixtures.json'), 'utf8'));
const manifestPath = path.join(skillDir, 'references', 'eval-cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const evalDoc = fs.readFileSync(path.join(skillDir, 'references', 'eval.md'), 'utf8');
const rebuilt = buildManifest(fixtures);

assert.deepEqual(manifest, rebuilt, 'manifest is stale; run build-eval-cases.mjs');
assert.deepEqual(manifest.context_files, ['SKILL.md', 'references/contract.md', 'scripts/attribute-leads.mjs', 'scripts/channel-taxonomy.mjs']);
assert.equal(manifest.groups.length, 3);
assert.deepEqual(manifest.groups.map((group) => group.id), GROUPS.map((group) => group.id));
assert.deepEqual(manifest.groups.map((group) => group.input.cases.length), [3, 4, 3]);
assert.equal(manifest.groups.every((group) => group.input.cases.every((item, index) => item.case_id === String.fromCharCode(65 + index))), true);
assert.equal(manifest.context_files.some((file) => /fixture|eval-results|eval-cases/i.test(file)), false, 'expected-answer files leaked into model context');
assert.equal(manifest.groups.every((group) => group.input.cases.every((item) => item.case_id.length === 1 && /^[A-Z]$/.test(item.case_id))), true);
for (const group of GROUPS) assert.equal(evalDoc.includes(`“${group.prompt}”`), true, `${group.id}: eval.md prompt drift`);

const selectedIds = GROUPS.flatMap((group) => group.fixtureIds);
const serialized = JSON.stringify(manifest);
for (const id of selectedIds) assert.equal(serialized.includes(id), false, `fixture name leaked into prompt manifest: ${id}`);

for (const group of manifest.groups) {
  const expectedCheckCount = group.input.cases.reduce((count, item) => count + item.input.leads.length, 0) * 11 + group.input.cases.length * 2 + 1;
  assert.equal(group.checks.length, expectedCheckCount, `${group.id}: every projected field must be checked`);
  assert.equal(group.checks.every((check) => check.op === 'equals'), true, `${group.id}: scalar projections use exact checks`);
  assert.equal(group.checks.every((check) => check.path === '/cases' || /^\/cases\/\d+\/(?:case_id|leads(?:\/\d+\/[^/]+)?)$/.test(check.path)), true);
  assert.equal(group.checks.every((check) => check.provenance === 'fixture-literal' || check.provenance === 'pinned-projection-literal' || check.provenance === 'manifest-literal'), true);
  assert.deepEqual(group.input.cases.map((item) => item.case_id), group.input.cases.map((item, index) => String.fromCharCode(65 + index)));
  assert.equal(group.input.cases.every((item, index) => item.input.leads.length === EXPECTED_PROJECTIONS[GROUPS.find((candidate) => candidate.id === group.id).fixtureIds[index]].length), true);
  assert.equal(group.input.cases.every((item) => item.input && item.input.leads && item.input.options !== undefined), true);
  assert.equal(group.output_schema.properties.cases.items.properties.leads.items.required.length, 11);
  assert.deepEqual(group.output_schema.properties.cases.items.properties.leads.items.required, [
    'channel', 'quality_status', 'ad_match_status', 'ad_confidence', 'ad_key',
    'campaign_key', 'ad_source_system', 'ad_source_scope', 'is_attribution_primary',
    'confidence', 'match_key',
  ]);
}

// Every chosen fixture has at least one authored literal expected value represented
// by an active projected check. Mutating that literal must prevent regeneration.
for (const group of GROUPS) {
  for (const fixtureId of group.fixtureIds) {
    const fixture = fixtures.cases.find((candidate) => candidate.id === fixtureId);
    const projectedLiteral = Object.keys(fixture.expected ?? {}).find((key) => /^(?:\d+)\.(?:channel|quality_status|ad_match_status|ad_confidence|ad_key|campaign_key|ad_source_system|ad_source_scope|is_attribution_primary|confidence|match_key)$/.test(key));
    assert.ok(projectedLiteral, `no projected authored literal for ${fixtureId}`);
    const mutated = structuredClone(fixtures);
    const selected = mutated.cases.find((candidate) => candidate.id === fixtureId);
    const old = selected.expected[projectedLiteral];
    selected.expected[projectedLiteral] = typeof old === 'boolean' ? !old : old === null ? '__mutated__' : '__mutated__';
    assert.throws(() => buildManifest(mutated), /Golden drift/, `fixture golden mutation must fail for ${fixtureId}`);
  }
}

// The whole-cases equality check must reject cardinality, label, and ordering drift.
for (const group of manifest.groups) {
  const wholeCases = group.checks.find((check) => check.path === '/cases');
  assert.ok(wholeCases, `${group.id}: missing top-level cases cardinality check`);
  const expectedCases = wholeCases.expected;
  const multiLeadIndex = expectedCases.findIndex((item) => item.leads.length > 1);
  const variants = [
    expectedCases.slice(0, -1),
    [...expectedCases, { case_id: 'Z', leads: [] }],
    expectedCases.map((item, index) => index === 0 ? { ...item, case_id: 'Z' } : item),
    expectedCases.map((item, index) => index === 0 ? { ...item, leads: [...item.leads, item.leads[0]] } : item),
    expectedCases.map((item, index) => index === 0 ? { ...item, leads: item.leads.slice(1) } : item),
    [...expectedCases].reverse(),
  ];
  if (multiLeadIndex >= 0) variants.push(expectedCases.map((item, index) => index === multiLeadIndex ? { ...item, leads: [...item.leads].reverse() } : item));
  for (const variant of variants) assert.notDeepEqual(variant, expectedCases, `${group.id}: case/lead mutation must fail whole-cases equality`);
}

// Build an exact parsed response from checks, then prove every active pointer is
// mutation-sensitive through the same comparison semantics as the generic harness.
const scorer = `
import importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location('harness', 'scripts/run-skill-evals.py')
harness = importlib.util.module_from_spec(spec); spec.loader.exec_module(harness)
m = json.loads(pathlib.Path(sys.argv[1]).read_text())
for group in m['groups']:
    parsed = {'cases': []}
    for case in group['input']['cases']:
        parsed['cases'].append({'case_id': case['case_id'], 'leads': [{} for _ in case['input']['leads']]})
    for check in group['checks']:
        parts = check['path'].split('/')[1:]
        if len(parts) == 5:
            parsed['cases'][int(parts[1])]['leads'][int(parts[3])][parts[4]] = check['expected']
    for check in group['checks']:
        assert harness.compare(check, parsed)['passed'], (group['id'], check)
    for check in group['checks']:
        bad = json.loads(json.dumps(parsed))
        parts = check['path'].split('/')[1:]
        if parts == ['cases']:
            bad['cases'] = []
        elif parts[2] == 'case_id':
            bad['cases'][int(parts[1])]['case_id'] = '__mutated__'
        elif parts[2] == 'leads':
            bad['cases'][int(parts[1])]['leads'] = []
        else:
            current = bad['cases'][int(parts[1])]['leads'][int(parts[3])][parts[4]]
            bad['cases'][int(parts[1])]['leads'][int(parts[3])][parts[4]] = ('__mutated__' if current != '__mutated__' else '__mutated__2')
        assert not harness.compare(check, bad)['passed'], (group['id'], check)
print('PASS generic scorer projected goldens and per-field mutations')
`;
const scored = spawnSync('python3', ['-c', scorer, manifestPath], { cwd: repoDir, encoding: 'utf8' });
assert.equal(scored.status, 0, scored.stdout + scored.stderr);
assert.match(scored.stdout, /PASS generic scorer/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-paid-eval-'));
const tempManifest = path.join(tempDir, 'eval-cases.json');
writeManifest({ target: tempManifest });
const beforeCheck = fs.readFileSync(tempManifest, 'utf8');
writeManifest({ check: true, target: tempManifest });
assert.equal(fs.readFileSync(tempManifest, 'utf8'), beforeCheck);
fs.writeFileSync(tempManifest, `${beforeCheck}\n`);
assert.throws(() => writeManifest({ check: true, target: tempManifest }), /stale evaluation manifest/);
assert.equal(fs.readFileSync(tempManifest, 'utf8'), `${beforeCheck}\n`);
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('PASS CRM paid attribution eval manifest: exact groups/cases, neutral labels, literal golden guards, typed projections, and mutation-sensitive checks');

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileCrmAttribution } from './profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const fixturesPath = path.join(skillDir, 'references', 'fixtures.json');
const outputPath = path.join(skillDir, 'references', 'eval-cases.json');

export const GROUPS = [
  { id: 'scoped-normalization', fixtureIds: ['authorized-cross-system', 'unauthorized-ad-source_scope', 'opaque-plus-distinct-from-space', 'property-wrapper'] },
  { id: 'population-exclusions', fixtureIds: ['conservative-exclusion-denominator', 'malformed-outside-denominator', 'empty-paid-population'] },
  { id: 'temporal-archetypes', fixtureIds: ['pre-window-real-recent-cohort', 'archetype-omitted-paid-field', 'outbound-archetype-ip-irrelevant'] },
];

const CONTEXT_FILES = ['SKILL.md', 'references/api.md', 'scripts/profile.mjs'];
const OUTPUT_FIELDS = {
  verdict: { type: ['string', 'null'] },
  weighted_rate: { type: ['number', 'null'] },
  distinct_rate: { type: ['number', 'null'] },
  populated_pct: { type: ['number', 'null'] },
  recent_distinct_rate: { type: ['number', 'null'] },
  archetype: { type: ['string', 'null'] },
  valid_in_window: { type: ['integer', 'null'] },
  excluded_count: { type: ['integer', 'null'] },
  logical_field: { type: ['string', 'null'] },
};

function outputSchema(caseIds) {
  const properties = Object.fromEntries(caseIds.map((id) => [id, {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(OUTPUT_FIELDS),
    properties: clone(OUTPUT_FIELDS),
  }]));
  return {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'object',
      additionalProperties: false,
      required: caseIds,
      properties,
    },
  },
};
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function atPath(value, dotted) {
  return dotted.split('.').reduce((current, part) => current?.[part], value);
}

function pointer(parts) {
  return `/${parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function resultPath(caseId, fixturePath) {
  const candidate = fixturePath.match(/^candidates\.0\.(.+)$/)?.[1];
  if (candidate === 'verdict') return pointer(['results', caseId, 'verdict']);
  if (candidate === 'logicalField') return pointer(['results', caseId, 'logical_field']);
  if (candidate === 'joinRates.weightedRate') return pointer(['results', caseId, 'weighted_rate']);
  if (candidate === 'joinRates.distinctRate') return pointer(['results', caseId, 'distinct_rate']);
  if (candidate === 'population.populatedPct' || candidate === 'joinRates.populatedPct') return pointer(['results', caseId, 'populated_pct']);
  if (candidate === 'joinRates.recentDistinctRate') return pointer(['results', caseId, 'recent_distinct_rate']);
  if (candidate === 'joinRates.excludedCount') return pointer(['results', caseId, 'excluded_count']);
  if (fixturePath === 'archetype') return pointer(['results', caseId, 'archetype']);
  if (fixturePath === 'rowCounts.validInWindow') return pointer(['results', caseId, 'valid_in_window']);
  return null;
}

function checksFor(fixture, caseId, actual) {
  const checks = [];
  const projected = {
    verdict: actual.candidates?.[0]?.verdict ?? null,
    weighted_rate: actual.candidates?.[0]?.joinRates?.weightedRate ?? null,
    distinct_rate: actual.candidates?.[0]?.joinRates?.distinctRate ?? null,
    populated_pct: actual.candidates?.[0]?.population?.populatedPct ?? null,
    recent_distinct_rate: actual.candidates?.[0]?.joinRates?.recentDistinctRate ?? null,
    archetype: actual.archetype ?? null,
    valid_in_window: actual.rowCounts?.validInWindow ?? null,
    excluded_count: actual.candidates?.[0]?.joinRates?.excludedCount ?? null,
    logical_field: actual.candidates?.[0]?.logicalField ?? null,
  };
  for (const [field, expected] of Object.entries(projected)) {
    checks.push({ path: pointer(['results', caseId, field]), op: typeof expected === 'number' ? 'approximately' : 'equals', expected, ...(typeof expected === 'number' ? { tolerance: 1e-9 } : {}) });
  }
  return checks;
}

function validateFixtureGoldens(fixture) {
  if (fixture.operation !== 'profileCrmAttribution' || !fixture.input || !fixture.expected || fixture.expectedError) throw new Error(`Selected fixture ${fixture.id} must be a successful profiler case`);
  const actual = profileCrmAttribution(clone(fixture.input));
  for (const [dotted, expected] of Object.entries(fixture.expected)) {
    const observed = atPath(actual, dotted);
    if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error(`Golden drift in ${fixture.id} at ${dotted}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`);
  }
}

export function buildManifest(fixtures) {
  const byId = new Map(fixtures.cases.map((fixture) => [fixture.id, fixture]));
  const groups = GROUPS.map((group) => {
    const cases = group.fixtureIds.map((fixtureId, index) => {
      const fixture = byId.get(fixtureId);
      if (!fixture) throw new Error(`Missing selected fixture ${fixtureId}`);
      validateFixtureGoldens(fixture);
      return { case_id: String.fromCharCode(65 + index), input: clone(fixture.input) };
    });
    const caseIds = cases.map((item) => item.case_id);
    const actuals = group.fixtureIds.map((fixtureId) => profileCrmAttribution(clone(byId.get(fixtureId).input)));
    return {
      id: group.id,
      prompt: 'Profile each supplied input independently using its policy. Return a snake_case result for every input keyed by its case_id, mapping candidate 0 to the candidate fields and root rowCounts.validInWindow and archetype to the corresponding output fields. Use null for undefined values. Do not execute code, use tools, infer missing fields, or include explanations.',
      input: { cases },
      output_schema: outputSchema(caseIds),
      checks: group.fixtureIds.flatMap((fixtureId, index) => checksFor(byId.get(fixtureId), caseIds[index], actuals[index])),
    };
  });
  return { context_files: CONTEXT_FILES, groups };
}

export function writeManifest({ check = false, target = outputPath } = {}) {
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const manifest = buildManifest(fixtures);
  const generated = `${JSON.stringify(manifest, null, 2)}\n`;
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== generated) throw new Error(`stale evaluation manifest: ${target}`);
  } else fs.writeFileSync(target, generated);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const manifest = writeManifest({ check });
  console.log(`${check ? 'Checked' : 'Wrote'} ${outputPath} (${manifest.groups.length} groups, ${manifest.groups.reduce((n, g) => n + g.input.cases.length, 0)} cases)`);
}

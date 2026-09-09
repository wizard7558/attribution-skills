#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { composeAudit } from './compose-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const repoDir = path.resolve(skillDir, '../..');
const outputPath = path.join(skillDir, 'references/eval-cases.json');

export const GROUPS = [
  { id: 'partial-inventory-routing', fixtureIds: ['recorded-unavailable-quality', 'required-missing-dependency-partial', 'all-inventory-unavailable-no-skills-requested'] },
  { id: 'fresh-invocation-gating', fixtureIds: ['explicit-missing-installed-root', 'source-integrity-failure-keeps-native-fail-unverified', 'attestation-integrity-failure-not-promoted'] },
  { id: 'evidence-preservation', fixtureIds: ['stable-topological-order', 'complete-recorded-execution-native-fail', 'optional-recorded-failure-does-not-rewrite-required-execution'] },
];

const CONTEXT_FILES = ['SKILL.md', 'references/audit-contract.md', 'references/entrypoints.json'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function pointer(parts) { return `/${parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`; }

function originalRoots() {
  const registry = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/entrypoints.json'), 'utf8'));
  const names = [...new Set(registry.entries.map((entry) => entry.skill))];
  return Object.fromEntries(names.map((name) => [name, path.join(repoDir, 'skills', name)]));
}

async function installedRoots() {
  const registry = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/entrypoints.json'), 'utf8'));
  const roots = originalRoots();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-eval-manifest-'));
  const copyRoots = {};
  for (const entry of registry.entries) {
    for (const ref of entry.source_refs) {
      const from = path.join(roots[ref.skill], ref.path);
      const target = path.join(scratch, 'installed', ref.skill, ref.path);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(from, target);
      copyRoots[ref.skill] = path.join(scratch, 'installed', ref.skill);
    }
  }
  return copyRoots;
}

function outputSchema() {
  const item = {
    type: 'object', additionalProperties: false, required: ['case_id', 'output'],
    properties: {
      case_id: { type: 'string' },
      output: {
        type: 'object', additionalProperties: false,
        required: ['execution_status', 'quality_status', 'data_coverage_status', 'step_count', 'findings_count'],
        properties: {
          execution_status: { type: 'string' },
          quality_status: { type: 'string' },
          data_coverage_status: { type: 'string' },
          step_count: { type: 'integer' },
          findings_count: { type: 'integer' },
        },
      },
    },
  };
  return { type: 'object', additionalProperties: false, required: ['cases'], properties: { cases: { type: 'array', items: item } } };
}

function project(expected) {
  return {
    execution_status: expected.execution_status,
    quality_status: expected.quality_status,
    data_coverage_status: expected.data_coverage_status,
    step_count: expected.steps.length,
    findings_count: expected.findings.length,
  };
}

export async function buildManifest() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/audit-fixtures.json'), 'utf8'));
  const byId = new Map(fixtures.cases.map((fixture) => [fixture.id, fixture]));
  const roots = await installedRoots();
  const groups = [];
  for (const group of GROUPS) {
    const cases = [];
    const outputs = [];
    for (const [index, fixtureId] of group.fixtureIds.entries()) {
      const fixture = byId.get(fixtureId);
      if (!fixture) throw new Error(`Missing audit fixture ${fixtureId}`);
      const omit = fixture.omit_skill_roots ?? [];
      const scopedRoots = { ...roots };
      for (const key of omit) delete scopedRoots[key];
      const actual = await composeAudit(clone(fixture.input), { skillRoots: scopedRoots });
      if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) throw new Error(`Golden drift in ${fixtureId}`);
      cases.push({ case_id: String.fromCharCode(65 + index), input: clone(fixture.input) });
      outputs.push(project(fixture.expected));
    }
    groups.push({
      id: group.id,
      prompt: 'Compose the audit report for each supplied input independently. Return cases A onward in input order with execution_status, quality_status, data_coverage_status, step_count, and findings_count only. Do not invoke unavailable branches or fabricate missing sources. Return JSON only.',
      input: { cases },
      output_schema: outputSchema(),
      checks: cases.flatMap((item, index) => [
        { path: pointer(['cases', index, 'case_id']), op: 'equals', expected: item.case_id, provenance: 'manifest-literal' },
        ...Object.entries(outputs[index]).map(([field, expected]) => ({ path: pointer(['cases', index, 'output', field]), op: 'equals', expected, provenance: 'fixture-literal' })),
        { path: pointer(['cases']), op: 'array_length_equals', expected: cases.length, provenance: 'manifest-literal' },
      ]),
    });
  }
  return { context_files: CONTEXT_FILES, groups };
}

export function writeManifest({ target = outputPath, check = false } = {}) {
  return buildManifest().then((manifest) => {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw new Error('stale evaluation manifest; run build-eval-cases.mjs');
      return manifest;
    }
    fs.writeFileSync(target, text);
    return manifest;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  writeManifest({ check }).then(() => console.log(check ? 'PASS manifest fresh' : `Wrote ${outputPath}`));
}

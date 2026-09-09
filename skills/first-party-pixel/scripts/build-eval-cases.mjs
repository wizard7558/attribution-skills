#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveChannel } from '../assets/collector/core.js';
import { projectIdentity } from './project-identity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const repoDir = path.resolve(skillDir, '../..');
const identityRoot = path.join(repoDir, 'skills/clickstream-identity-stitching');
const outputPath = path.join(skillDir, 'references/eval-cases.json');

export const GROUPS = [
  { id: 'touchpoint-channel-normalization', fixtureIds: ['gclid', 'email', 'direct-valid', 'click-conflict-search-social'] },
  { id: 'identity-projection', fixtureNames: ['unique_match', 'cross_device_same_contact', 'shared_device_a_b', 'email_phone_candidate_ambiguity'] },
  { id: 'identity-snapshot-projection', fixtureNames: ['native_bindings', 'external_crm_only', 'missing_binding'] },
];

const CONTEXT_FILES = ['SKILL.md', 'references/evaluation-quick-reference.md'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function pointer(parts) { return `/${parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`; }

function channelSchema(caseIds) {
  return {
    type: 'object', additionalProperties: false, required: ['cases'],
    properties: {
      cases: {
        type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['case_id', 'output'],
          properties: {
            case_id: { type: 'string' },
            output: {
              type: 'object', additionalProperties: false, required: ['channel', 'taxonomy_version'],
              properties: { channel: { type: 'string' }, taxonomy_version: { type: 'string' } },
            },
          },
        },
      },
    },
  };
}

function projectionSchema(caseIds) {
  const item = {
    type: 'object', additionalProperties: false, required: ['case_id', 'output'],
    properties: {
      case_id: { type: 'string' },
      output: {
        type: 'object', additionalProperties: false,
        required: ['exported_touch_count', 'graph_edge_count', 'suppressed_touch_count', 'contact_diagnostic_count'],
        properties: {
          exported_touch_count: { type: 'integer' },
          graph_edge_count: { type: 'integer' },
          suppressed_touch_count: { type: 'integer' },
          contact_diagnostic_count: { type: 'integer' },
        },
      },
    },
  };
  return { type: 'object', additionalProperties: false, required: ['cases'], properties: { cases: { type: 'array', items: item } } };
}

function projectOutput(expected) {
  return {
    exported_touch_count: expected.touches?.length ?? 0,
    graph_edge_count: expected.graph?.edges?.length ?? 0,
    suppressed_touch_count: expected.suppressed_touches?.length ?? 0,
    contact_diagnostic_count: expected.contact_diagnostics?.length ?? 0,
  };
}

export async function buildManifest() {
  const channelFixtures = JSON.parse(fs.readFileSync(path.join(repoDir, 'skills/channel-taxonomy/references/fixtures.json'), 'utf8'));
  const projectionFixtures = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/identity-projection-fixtures.json'), 'utf8'));
  const snapshotFixtures = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/identity-snapshot-fixtures.json'), 'utf8'));
  const channelById = new Map(channelFixtures.cases.map((fixture) => [fixture.id, fixture]));
  const projectionByName = new Map(projectionFixtures.cases.map((fixture) => [fixture.name, fixture]));
  const snapshotMain = snapshotFixtures.snapshot_goldens.main;

  const groups = [];
  for (const group of GROUPS) {
    if (group.fixtureIds) {
      const cases = group.fixtureIds.map((fixtureId, index) => {
        const fixture = channelById.get(fixtureId);
        if (!fixture) throw new Error(`Missing channel fixture ${fixtureId}`);
        return { case_id: String.fromCharCode(65 + index), input: clone(fixture.input) };
      });
      const outputs = group.fixtureIds.map((fixtureId) => {
        const fixture = channelById.get(fixtureId);
        return { channel: deriveChannel(fixture.input), taxonomy_version: '0.1.0' };
      });
      groups.push({
        id: group.id,
        prompt: 'Classify each supplied touchpoint input independently using the shared taxonomy. Return cases A onward in input order with channel and taxonomy_version only. Return JSON only.',
        input: { cases },
        output_schema: channelSchema(cases.map((item) => item.case_id)),
        checks: cases.flatMap((item, index) => [
          { path: pointer(['cases', index, 'case_id']), op: 'equals', expected: item.case_id, provenance: 'manifest-literal' },
          { path: pointer(['cases', index, 'output', 'channel']), op: 'equals', expected: outputs[index].channel, provenance: 'fixture-literal' },
          { path: pointer(['cases', index, 'output', 'taxonomy_version']), op: 'equals', expected: '0.1.0', provenance: 'fixture-literal' },
          { path: pointer(['cases']), op: 'array_length_equals', expected: cases.length, provenance: 'manifest-literal' },
        ]),
      });
      continue;
    }
    if (group.id === 'identity-projection') {
      const cases = [];
      const outputs = [];
      for (const [index, name] of group.fixtureNames.entries()) {
        const fixture = projectionByName.get(name);
        if (!fixture) throw new Error(`Missing projection fixture ${name}`);
        const actual = await projectIdentity(clone(fixture.input), { identitySkillRoot: identityRoot });
        if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) throw new Error(`Golden drift in ${name}`);
        cases.push({ case_id: String.fromCharCode(65 + index), input: clone(fixture.input) });
        outputs.push(projectOutput(fixture.expected));
      }
      groups.push({
        id: group.id,
        prompt: 'Project identity for each supplied input independently. Return cases A onward in input order with exported_touch_count, graph_edge_count, suppressed_touch_count, and contact_diagnostic_count only. Return JSON only.',
        input: { cases },
        output_schema: projectionSchema(cases.map((item) => item.case_id)),
        checks: cases.flatMap((item, index) => [
          { path: pointer(['cases', index, 'case_id']), op: 'equals', expected: item.case_id, provenance: 'manifest-literal' },
          ...Object.entries(outputs[index]).map(([field, expected]) => ({ path: pointer(['cases', index, 'output', field]), op: 'equals', expected, provenance: 'fixture-literal' })),
          { path: pointer(['cases']), op: 'array_length_equals', expected: cases.length, provenance: 'manifest-literal' },
        ]),
      });
      continue;
    }
    const cases = [];
    const outputs = [];
    for (const [index, name] of group.fixtureNames.entries()) {
      const fixture = snapshotFixtures.projection_cases.find((row) => row.name === name);
      if (!fixture) throw new Error(`Missing snapshot projection ${name}`);
      const input = {
        snapshot_evidence_ref: snapshotMain.snapshot_evidence_ref,
        config: clone(fixture.config),
        touches: clone(snapshotMain.touches),
        observations: clone(snapshotMain.observations),
        contacts: clone(snapshotMain.contacts),
      };
      if (fixture.external_contacts) input.external_contacts = clone(fixture.external_contacts);
      if (fixture.external_contact_evidence_ref) input.external_contact_evidence_ref = fixture.external_contact_evidence_ref;
      const actual = await projectIdentity(input, { identitySkillRoot: identityRoot });
      if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) throw new Error(`Snapshot golden drift in ${name}`);
      cases.push({ case_id: String.fromCharCode(65 + index), input });
      outputs.push(projectOutput(fixture.expected));
    }
    groups.push({
      id: group.id,
      prompt: 'Project identity from each supplied snapshot input independently. Return cases A onward in input order with exported_touch_count, graph_edge_count, suppressed_touch_count, and contact_diagnostic_count only. Return JSON only.',
      input: { cases },
      output_schema: projectionSchema(cases.map((item) => item.case_id)),
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

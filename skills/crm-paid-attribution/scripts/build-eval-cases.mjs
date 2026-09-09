#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributeLeads } from './attribute-leads.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const fixturesPath = path.join(skillDir, 'references', 'fixtures.json');
const outputPath = path.join(skillDir, 'references', 'eval-cases.json');

export const GROUPS = [
  {
    id: 'precedence-and-normalization',
    fixtureIds: ['click-precedence-all', 'current-organic-blocks-first-click', 'raw-classifier-6-passes'],
    prompt: 'Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.',
  },
  {
    id: 'scoped-ad-matching',
    fixtureIds: ['binding-selects-qualified-account', 'two-authorized-ids-ambiguous', 'nonapplicable-binding-crm_source_scope', 'opaque-id-plus-space-distinct'],
    prompt: 'Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.',
  },
  {
    id: 'primary-selection',
    fixtureIds: ['first-current-share-dedup-group', 'dedup-null-date-key-tie', 'utm-only-all-primary'],
    prompt: 'Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.',
  },
];

const CONTEXT_FILES = ['SKILL.md', 'references/contract.md', 'scripts/attribute-leads.mjs', 'scripts/channel-taxonomy.mjs'];
const PROJECTED_FIELDS = [
  'channel', 'quality_status', 'ad_match_status', 'ad_confidence', 'ad_key',
  'campaign_key', 'ad_source_system', 'ad_source_scope', 'is_attribution_primary',
  'confidence', 'match_key',
];
const FIELD_TYPES = {
  channel: { type: 'string' },
  quality_status: { type: 'string' },
  ad_match_status: { type: 'string' },
  ad_confidence: { type: 'string' },
  ad_key: { type: ['string', 'null'] },
  campaign_key: { type: ['string', 'null'] },
  ad_source_system: { type: ['string', 'null'] },
  ad_source_scope: { type: ['string', 'null'] },
  is_attribution_primary: { type: 'boolean' },
  confidence: { type: 'string' },
  match_key: { type: ['string', 'null'] },
};

// Authored projections pinned after reviewing the contract and selected fixture goldens.
// Runtime output is checked against these constants before any manifest checks are written.
export const EXPECTED_PROJECTIONS = {
  'click-precedence-all': [{channel:'Paid Other',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'HIGH',match_key:'dclid'}],
  'current-organic-blocks-first-click': [{channel:'Organic Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'raw-classifier-6-passes': [{channel:'Paid Other',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'binding-selects-qualified-account': [{channel:'Paid Search',quality_status:'matched',ad_match_status:'matched',ad_confidence:'HIGH',ad_key:'Ad+A',campaign_key:'CatalogCampaign+Case',ad_source_system:'ads_system',ad_source_scope:'ads-a',is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'two-authorized-ids-ambiguous': [{channel:'Paid Search',quality_status:'matched',ad_match_status:'ambiguous',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:'MapCampaign+Case',ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'nonapplicable-binding-crm_source_scope': [{channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:'MapCampaign+Case',ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'opaque-id-plus-space-distinct': [{channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:'MapCampaign+Case',ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'}],
  'first-current-share-dedup-group': [
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:false,confidence:'LOW',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'HIGH',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:false,confidence:'LOW',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'LOW',match_key:'gclid'},
  ],
  'dedup-null-date-key-tie': [
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:false,confidence:'HIGH',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'HIGH',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:false,confidence:'HIGH',match_key:'gclid'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'unmatched',ad_confidence:'UNMATCHED',ad_key:null,campaign_key:null,ad_source_system:null,ad_source_scope:null,is_attribution_primary:true,confidence:'HIGH',match_key:'gclid'},
  ],
  'utm-only-all-primary': [
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'matched',ad_confidence:'HIGH',ad_key:'Ad+A',campaign_key:'CatalogCampaign+Case',ad_source_system:'ads_system',ad_source_scope:'ads-a',is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'},
    {channel:'Paid Search',quality_status:'matched',ad_match_status:'matched',ad_confidence:'HIGH',ad_key:'Ad+A',campaign_key:'CatalogCampaign+Case',ad_source_system:'ads_system',ad_source_scope:'ads-a',is_attribution_primary:true,confidence:'MEDIUM',match_key:'utm_source'},
  ],
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function pointer(parts) {
  return `/${parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function atPath(value, dotted) {
  return dotted.split('.').reduce((current, part) => current?.[part], value);
}

function outputSchema(caseIds) {
  const leadSchema = {
    type: 'object',
    additionalProperties: false,
    required: PROJECTED_FIELDS,
    properties: clone(FIELD_TYPES),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['cases'],
    properties: {
      cases: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['case_id', 'leads'],
          properties: {
            case_id: { type: 'string' },
            leads: { type: 'array', items: leadSchema },
          },
        },
      },
    },
  };
}

function fixtureExpectedFor(fixture, leadIndex, field) {
  const key = `${leadIndex}.${field}`;
  return Object.hasOwn(fixture.expected ?? {}, key)
    ? { found: true, value: clone(fixture.expected[key]) }
    : { found: false };
}

function validateFixtureGoldens(fixture) {
  if (!fixture.input || !fixture.expected || fixture.expectedError) {
    throw new Error(`Selected fixture ${fixture.id} must be a successful API case with literal expected values`);
  }
  const actual = attributeLeads(clone(fixture.input.leads), clone(fixture.input.options ?? {}));
  for (const [dotted, expected] of Object.entries(fixture.expected)) {
    if (dotted === 'length') {
      if (actual.length !== expected) throw new Error(`Golden drift in ${fixture.id} at length: expected ${expected}, got ${actual.length}`);
      continue;
    }
    const observed = atPath(actual, dotted);
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      throw new Error(`Golden drift in ${fixture.id} at ${dotted}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`);
    }
  }
  return actual;
}

function projectRows(rows) {
  return rows.map((row) => Object.fromEntries(PROJECTED_FIELDS.map((field) => [field, row[field]])));
}

function assertPinnedProjection(fixture, actual) {
  const pinned = EXPECTED_PROJECTIONS[fixture.id];
  if (!pinned) throw new Error(`Missing pinned projection for ${fixture.id}`);
  if (actual.length !== pinned.length) throw new Error(`Pinned projection row count drift in ${fixture.id}: expected ${pinned.length}, got ${actual.length}`);
  for (const [index, row] of actual.entries()) {
    for (const field of PROJECTED_FIELDS) {
      if (!Object.hasOwn(row, field)) throw new Error(`Missing projected field ${fixture.id} ${index}.${field}`);
      const expectedType = FIELD_TYPES[field].type;
      const valid = expectedType === 'string' ? typeof row[field] === 'string' : expectedType === 'boolean' ? typeof row[field] === 'boolean' : row[field] === null || typeof row[field] === 'string';
      if (!valid) throw new Error(`Invalid projected type ${fixture.id} ${index}.${field}: ${typeof row[field]}`);
    }
  }
  const observed = projectRows(actual);
  if (JSON.stringify(observed) !== JSON.stringify(pinned)) throw new Error(`Pinned projection drift in ${fixture.id}: expected ${JSON.stringify(pinned)}, got ${JSON.stringify(observed)}`);
  return pinned;
}

function buildChecks(fixture, caseId, caseIndex, actual, pinned) {
  const checks = [];
  checks.push({ path: pointer(['cases', caseIndex, 'case_id']), op: 'equals', expected: caseId, provenance: 'manifest-literal' });
  checks.push({ path: pointer(['cases', caseIndex, 'leads']), op: 'equals', expected: clone(pinned), provenance: 'pinned-projection-literal' });
  actual.forEach((row, leadIndex) => {
    for (const field of PROJECTED_FIELDS) {
      const literal = fixtureExpectedFor(fixture, leadIndex, field);
      checks.push({
        path: pointer(['cases', caseIndex, 'leads', leadIndex, field]),
        op: 'equals',
        expected: pinned[leadIndex][field],
        provenance: literal.found ? 'fixture-literal' : 'pinned-projection-literal',
      });
    }
  });
  return checks;
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
    const actuals = group.fixtureIds.map((fixtureId) => validateFixtureGoldens(byId.get(fixtureId)));
    const pinned = group.fixtureIds.map((fixtureId, index) => assertPinnedProjection(byId.get(fixtureId), actuals[index]));
    return {
      id: group.id,
      prompt: group.prompt,
      input: { cases },
      output_schema: outputSchema(caseIds),
      checks: [
        { path: '/cases', op: 'equals', expected: cases.map((item, index) => ({ case_id: item.case_id, leads: clone(pinned[index]) })), provenance: 'pinned-projection-literal' },
        ...group.fixtureIds.flatMap((fixtureId, index) => buildChecks(byId.get(fixtureId), caseIds[index], index, actuals[index], pinned[index])),
      ],
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

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const outputPath = path.join(skillDir, 'references', 'eval-cases.json');

// Reviewed literal projections. These are deliberately authored here rather than learned from
// generated output, so a fixture change fails the builder until its projection is reviewed.
export const PINNED_PROJECTIONS = {
  "complete-snapshot-stage-gaps": {
    "ledger": [
      {
        "lead_key": "Lead+A",
        "stage_key": "lead",
        "achieved": true,
        "activity_date": "2026-01-01",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "qualified",
        "achieved": true,
        "activity_date": "2026-01-02",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "converted",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "won",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "engaged",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      }
    ]
  },
  "all-wins-survive-later-loss": {
    "ledger": [
      {
        "lead_key": "Lead+A",
        "stage_key": "lead",
        "achieved": true,
        "activity_date": "2026-01-01",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "qualified",
        "achieved": true,
        "activity_date": "2026-01-02",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "converted",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "won",
        "achieved": true,
        "activity_date": "2026-01-04",
        "is_attribution_primary": true,
        "value": 150,
        "currency": "USD",
        "value_status": "known",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "engaged",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      }
    ]
  },
  "unknown-winning-money": {
    "ledger": [
      {
        "lead_key": "Lead+A",
        "stage_key": "lead",
        "achieved": true,
        "activity_date": "2026-01-01",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "qualified",
        "achieved": true,
        "activity_date": "2026-01-02",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "converted",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "won",
        "achieved": true,
        "activity_date": "2026-01-04",
        "is_attribution_primary": true,
        "value": null,
        "currency": "USD",
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "engaged",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      }
    ]
  },
  "mixed-winning-currencies": {
    "ledger": [
      {
        "lead_key": "Lead+A",
        "stage_key": "lead",
        "achieved": true,
        "activity_date": "2026-01-01",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "qualified",
        "achieved": true,
        "activity_date": "2026-01-02",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "converted",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "won",
        "achieved": true,
        "activity_date": "2026-01-04",
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "mixed_currency",
        "stage_truth_status": "achieved"
      },
      {
        "lead_key": "Lead+A",
        "stage_key": "engaged",
        "achieved": false,
        "activity_date": null,
        "is_attribution_primary": true,
        "value": null,
        "currency": null,
        "value_status": "unknown",
        "stage_truth_status": "not_achieved"
      }
    ]
  },
  "all-five-buckets": {
    "report": [
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Other",
        "campaign_key": null,
        "bucket": "unattributed",
        "lead_count": 1,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": null,
        "spend_currency": null,
        "spend_status": "unknown",
        "cost_per_stage": null,
        "cost_status": "campaign_not_matched"
      },
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "Ambiguous",
        "bucket": "ambiguous",
        "lead_count": 1,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": null,
        "spend_currency": null,
        "spend_status": "unknown",
        "cost_per_stage": null,
        "cost_status": "campaign_not_matched"
      },
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "Campaign+Case",
        "bucket": "matched",
        "lead_count": 1,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": 20,
        "spend_currency": "USD",
        "spend_status": "known",
        "cost_per_stage": 20,
        "cost_status": "known"
      },
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "Ambiguous",
        "bucket": "spend_only",
        "lead_count": 0,
        "stage_count_total": 0,
        "stage_count_primary": 0,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": 12,
        "spend_currency": "USD",
        "spend_status": "known",
        "cost_per_stage": null,
        "cost_status": "campaign_not_matched"
      },
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "NoCatalog",
        "bucket": "spend_only",
        "lead_count": 0,
        "stage_count_total": 0,
        "stage_count_primary": 0,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": 9,
        "spend_currency": "USD",
        "spend_status": "known",
        "cost_per_stage": null,
        "cost_status": "campaign_not_matched"
      },
      {
        "report_date": "2026-01-02",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "NoCatalog",
        "bucket": "unmatched",
        "lead_count": 1,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": null,
        "spend_currency": null,
        "spend_status": "unknown",
        "cost_per_stage": null,
        "cost_status": "campaign_not_matched"
      }
    ],
    "undated_stage_rows": 0
  },
  "timezone-cohort-boundary": {
    "report": [
      {
        "report_date": "2026-01-01",
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "Campaign+Case",
        "bucket": "matched",
        "lead_count": 1,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 0,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": 20,
        "spend_currency": "USD",
        "spend_status": "known",
        "cost_per_stage": 20,
        "cost_status": "known"
      }
    ],
    "undated_stage_rows": 0
  },
  "undated-stage-truth-preserved": {
    "report": [
      {
        "report_date": null,
        "stage_key": "won",
        "channel": "Paid Search",
        "campaign_key": "Campaign+Case",
        "bucket": "matched",
        "lead_count": 3,
        "stage_count_total": 1,
        "stage_count_primary": 1,
        "stage_unknown_count": 1,
        "revenue": null,
        "revenue_currency": null,
        "revenue_status": "unknown",
        "spend": null,
        "spend_currency": null,
        "spend_status": "unknown",
        "cost_per_stage": null,
        "cost_status": "spend_unknown"
      }
    ],
    "undated_stage_rows": 3
  },
  "late-won-rewrite-preserves-unaffected": {
    "mode": "incremental",
    "fallback_reasons": [],
    "overlap_start": "2026-07-08T00:00:00Z",
    "proposed_next_watermark": "2026-07-12T00:00:00Z",
    "target_partitions": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-10"
      },
      {
        "date_mode": "activity",
        "report_date": "2026-07-11"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01"
      }
    ],
    "replacement_ledger": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-10",
        "lead_key": "Unaffected",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      },
      {
        "date_mode": "activity",
        "report_date": "2026-07-11",
        "lead_key": "Changed",
        "stage_key": "won",
        "achieved": true,
        "value": 15,
        "currency": "USD",
        "value_status": "known"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01",
        "lead_key": "Changed",
        "stage_key": "won",
        "achieved": true,
        "value": 15,
        "currency": "USD",
        "value_status": "known"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01",
        "lead_key": "Unaffected",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      }
    ]
  },
  "deletion-preserves-shared-partition-member": {
    "mode": "incremental",
    "fallback_reasons": [],
    "overlap_start": "2026-07-08T00:00:00Z",
    "proposed_next_watermark": "2026-07-12T00:00:00Z",
    "target_partitions": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-10"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01"
      }
    ],
    "replacement_ledger": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-10",
        "lead_key": "Unaffected",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01",
        "lead_key": "Unaffected",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      }
    ]
  },
  "timezone-change-full-reconciliation": {
    "mode": "full_reconciliation",
    "fallback_reasons": [
      "timezone_changed"
    ],
    "overlap_start": "2026-07-08T00:00:00Z",
    "proposed_next_watermark": "2026-07-12T00:00:00Z",
    "target_partitions": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-09"
      },
      {
        "date_mode": "activity",
        "report_date": "2026-05-10"
      },
      {
        "date_mode": "cohort",
        "report_date": "2025-12-31"
      },
      {
        "date_mode": "cohort",
        "report_date": "2026-01-01"
      }
    ],
    "replacement_ledger": [
      {
        "date_mode": "activity",
        "report_date": "2026-05-09",
        "lead_key": "Changed",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      },
      {
        "date_mode": "cohort",
        "report_date": "2025-12-31",
        "lead_key": "Changed",
        "stage_key": "won",
        "achieved": true,
        "value": 10,
        "currency": "USD",
        "value_status": "known"
      }
    ]
  }
};

export const GROUPS = [
  { id: 'stage-truth', files: 'stage-fixtures.json', fixtureIds: ['complete-snapshot-stage-gaps', 'all-wins-survive-later-loss', 'unknown-winning-money', 'mixed-winning-currencies'], prompt: 'Resolve each supplied funnel stage input independently. Return cases A onward in input order. For each case return ledger rows with the requested identity, timestamps, booleans, money, and truth fields, preserving row order, nulls, false values, and exact numbers. Return JSON only.' },
  { id: 'cost-reconciliation', files: 'cost-fixtures.json', fixtureIds: ['all-five-buckets', 'timezone-cohort-boundary', 'undated-stage-truth-preserved'], prompt: 'Reconcile each supplied funnel cost input independently. Return cases A onward in input order. For each case return the requested report rows and undated-row count, preserving row order, nulls, false values, and exact numbers. Return JSON only.' },
  { id: 'refresh-partitions', files: 'refresh-fixtures.json', fixtureIds: ['late-won-rewrite-preserves-unaffected', 'deletion-preserves-shared-partition-member', 'timezone-change-full-reconciliation'], prompt: 'Plan each supplied partition refresh independently. Return cases A onward in input order. For each case return the requested refresh fields, target partitions, and replacement rows, preserving array order, nulls, false values, and exact timestamps and numbers. Return JSON only.' },
];

const PROJECTION_FIELDS = {
  'stage-truth': ['ledger'],
  'cost-reconciliation': ['report', 'undated_stage_rows'],
  'refresh-partitions': ['mode', 'fallback_reasons', 'overlap_start', 'proposed_next_watermark', 'target_partitions', 'replacement_ledger'],
};
const STAGE_FIELDS = ['lead_key', 'stage_key', 'achieved', 'activity_date', 'is_attribution_primary', 'value', 'currency', 'value_status', 'stage_truth_status'];
const COST_FIELDS = ['report_date', 'stage_key', 'channel', 'campaign_key', 'bucket', 'lead_count', 'stage_count_total', 'stage_count_primary', 'stage_unknown_count', 'revenue', 'revenue_currency', 'revenue_status', 'spend', 'spend_currency', 'spend_status', 'cost_per_stage', 'cost_status'];
const REFRESH_PARTITION_FIELDS = ['date_mode', 'report_date'];
const REFRESH_LEDGER_FIELDS = ['date_mode', 'report_date', 'lead_key', 'stage_key', 'achieved', 'value', 'currency', 'value_status'];

function clone(value) { return structuredClone(value); }
function pointer(parts) { return `/${parts.map((p) => String(p).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`; }
function readCases(file) { return JSON.parse(fs.readFileSync(path.join(skillDir, 'references', file), 'utf8')).cases; }
function atPath(obj, pathText) { return pathText.split('.').reduce((v, k) => v == null ? undefined : v[k], obj); }
function hasPath(obj, pathText) { const parts = pathText.split('.'); for (const k of parts) { if (obj == null || !Object.hasOwn(obj, k)) return false; obj = obj[k]; } return obj !== undefined; }

function validateFixture(fixture, groupId) {
  if (!fixture?.input || !fixture.expected || fixture.expectedError) throw new Error(`Selected successful fixture is missing a literal expected object: ${fixture?.id}`);
  for (const key of PROJECTION_FIELDS[groupId]) if (!hasPath(fixture, `expected.${key}`) && !(groupId === 'cost-reconciliation' && key === 'undated_stage_rows' && hasPath(fixture, 'expected.diagnostics.undated_stage_rows'))) throw new Error(`Missing literal expected path ${fixture.id}: expected.${key}`);
  if (JSON.stringify(fixture.input).includes(fixture.id)) throw new Error(`Fixture ID leaked into input: ${fixture.id}`);
}

const nullable = (type) => ({ type: [type, 'null'] });
const finite = (value, label) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid finite number ${label}`); };
const string = (value, label) => { if (typeof value !== 'string') throw new Error(`Invalid string ${label}`); };
const nullableString = (value, label) => { if (value !== null) string(value, label); };
const boolean = (value, label) => { if (typeof value !== 'boolean') throw new Error(`Invalid boolean ${label}`); };
const nullableBoolean = (value, label) => { if (value !== null) boolean(value, label); };
function validateProjection(projection, groupId, id) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw new Error(`Invalid projection object ${id}`);
  if (groupId === 'stage-truth') {
    if (!Array.isArray(projection.ledger)) throw new Error(`Invalid ledger projection ${id}`);
    for (const [i, row] of projection.ledger.entries()) {
      for (const key of ['lead_key', 'stage_key', 'value_status', 'stage_truth_status']) string(row[key], `${id}.ledger[${i}].${key}`);
      nullableBoolean(row.achieved, `${id}.ledger[${i}].achieved`); boolean(row.is_attribution_primary, `${id}.ledger[${i}].is_attribution_primary`);
      nullableString(row.activity_date, `${id}.ledger[${i}].activity_date`); nullableString(row.currency, `${id}.ledger[${i}].currency`); if (row.value !== null) finite(row.value, `${id}.ledger[${i}].value`);
    }
  } else if (groupId === 'cost-reconciliation') {
    if (!Array.isArray(projection.report)) throw new Error(`Invalid report projection ${id}`);
    if (!Number.isInteger(projection.undated_stage_rows) || projection.undated_stage_rows < 0) throw new Error(`Invalid undated count ${id}`);
    for (const [i, row] of projection.report.entries()) {
      for (const key of ['stage_key', 'channel', 'bucket', 'revenue_status', 'spend_status', 'cost_status']) string(row[key], `${id}.report[${i}].${key}`);
      nullableString(row.report_date, `${id}.report[${i}].report_date`); nullableString(row.campaign_key, `${id}.report[${i}].campaign_key`); nullableString(row.revenue_currency, `${id}.report[${i}].revenue_currency`); nullableString(row.spend_currency, `${id}.report[${i}].spend_currency`);
      for (const key of ['lead_count', 'stage_count_total', 'stage_count_primary', 'stage_unknown_count']) if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error(`Invalid integer ${id}.report[${i}].${key}`);
      for (const key of ['revenue', 'spend', 'cost_per_stage']) if (row[key] !== null) finite(row[key], `${id}.report[${i}].${key}`);
    }
  } else {
    for (const key of ['mode', 'overlap_start', 'proposed_next_watermark']) string(projection[key], `${id}.${key}`);
    if (!Array.isArray(projection.fallback_reasons) || !projection.fallback_reasons.every((x) => typeof x === 'string')) throw new Error(`Invalid fallback reasons ${id}`);
    for (const key of ['target_partitions', 'replacement_ledger']) if (!Array.isArray(projection[key])) throw new Error(`Invalid refresh array ${id}.${key}`);
    for (const [i, row] of projection.target_partitions.entries()) { string(row.date_mode, `${id}.target_partitions[${i}].date_mode`); nullableString(row.report_date, `${id}.target_partitions[${i}].report_date`); }
    for (const [i, row] of projection.replacement_ledger.entries()) { string(row.date_mode, `${id}.replacement_ledger[${i}].date_mode`); nullableString(row.report_date, `${id}.replacement_ledger[${i}].report_date`); string(row.lead_key, `${id}.replacement_ledger[${i}].lead_key`); string(row.stage_key, `${id}.replacement_ledger[${i}].stage_key`); nullableBoolean(row.achieved, `${id}.replacement_ledger[${i}].achieved`); string(row.value_status, `${id}.replacement_ledger[${i}].value_status`); nullableString(row.currency, `${id}.replacement_ledger[${i}].currency`); if (row.value !== null) finite(row.value, `${id}.replacement_ledger[${i}].value`); }
  }
}
const strictObject = (fields) => ({ type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields });
function schema(groupId) {
  const stage = strictObject({ lead_key: { type: 'string' }, stage_key: { type: 'string' }, achieved: { type: ['boolean', 'null'] }, activity_date: nullable('string'), is_attribution_primary: { type: 'boolean' }, value: nullable('number'), currency: nullable('string'), value_status: { type: 'string' }, stage_truth_status: { type: 'string' } });
  const cost = strictObject({ report_date: nullable('string'), stage_key: { type: 'string' }, channel: { type: 'string' }, campaign_key: nullable('string'), bucket: { type: 'string' }, lead_count: { type: 'integer' }, stage_count_total: { type: 'integer' }, stage_count_primary: { type: 'integer' }, stage_unknown_count: { type: 'integer' }, revenue: nullable('number'), revenue_currency: nullable('string'), revenue_status: { type: 'string' }, spend: nullable('number'), spend_currency: nullable('string'), spend_status: { type: 'string' }, cost_per_stage: nullable('number'), cost_status: { type: 'string' } });
  const partition = strictObject({ date_mode: { type: 'string' }, report_date: nullable('string') });
  const refreshLedger = strictObject({ date_mode: { type: 'string' }, report_date: nullable('string'), lead_key: { type: 'string' }, stage_key: { type: 'string' }, achieved: { type: ['boolean', 'null'] }, value: nullable('number'), currency: nullable('string'), value_status: { type: 'string' } });
  const outputs = {
    'stage-truth': strictObject({ ledger: { type: 'array', items: stage } }),
    'cost-reconciliation': strictObject({ report: { type: 'array', items: cost }, undated_stage_rows: { type: 'integer' } }),
    'refresh-partitions': strictObject({ mode: { type: 'string' }, fallback_reasons: { type: 'array', items: { type: 'string' } }, overlap_start: { type: 'string' }, proposed_next_watermark: { type: 'string' }, target_partitions: { type: 'array', items: partition }, replacement_ledger: { type: 'array', items: refreshLedger } }),
  };
  return strictObject({ cases: { type: 'array', items: strictObject({ case_id: { type: 'string' }, output: outputs[groupId] }) } });
}

function projectSource(fixture, groupId) {
  const e = fixture.expected;
  if (groupId === 'stage-truth') return { ledger: e.ledger.map((row) => Object.fromEntries(STAGE_FIELDS.map((key) => [key, row[key]]))) };
  if (groupId === 'cost-reconciliation') return { report: e.report.map((row) => Object.fromEntries(COST_FIELDS.map((key) => [key, row[key]]))), undated_stage_rows: e.diagnostics.undated_stage_rows };
  return { mode: e.mode, fallback_reasons: e.fallback_reasons, overlap_start: e.overlap_start, proposed_next_watermark: e.proposed_next_watermark, target_partitions: e.target_partitions.map((row) => Object.fromEntries(REFRESH_PARTITION_FIELDS.map((key) => [key, row[key]]))), replacement_ledger: e.replacement_ledger.map((row) => Object.fromEntries(REFRESH_LEDGER_FIELDS.map((key) => [key, key === 'lead_key' || key === 'stage_key' || key === 'achieved' || key === 'value' || key === 'currency' || key === 'value_status' ? row.ledger[key] : row[key]]))) };
}

export function buildManifest(fixtureFiles = null) {
  const groups = GROUPS.map((group) => {
    const sourceCases = fixtureFiles?.[group.files] ?? readCases(group.files);
    const fixtures = new Map(sourceCases.map((f) => [f.id, f]));
    const selected = group.fixtureIds.map((id) => { const f = fixtures.get(id); if (!f) throw new Error(`Missing selected fixture ${id}`); validateFixture(f, group.id); return f; });
    const cases = selected.map((f, i) => ({ case_id: String.fromCharCode(65 + i), input: clone(f.input) }));
    const expected = selected.map((f) => {
      const sourceProjection = projectSource(f, group.id);
      const pinned = PINNED_PROJECTIONS[f.id];
      validateProjection(sourceProjection, group.id, f.id); validateProjection(pinned, group.id, f.id);
      if (!pinned || !isDeepStrictEqual(sourceProjection, pinned)) throw new Error(`Pinned projection drift in ${f.id}`);
      return clone(pinned);
    });
    // Cardinality comes from actual array length, never a model-asserted count.
    // Objects are enforced by the unchanged required/additionalProperties schema.
    // Native monetary projections allow equivalent JSON number spellings; all
    // other scalar semantics (including counts, booleans and null) remain strict.
    const checks = [];
    const moneyFields = new Set(['value', 'revenue', 'spend', 'cost_per_stage']);
    function addChecks(value, parts) {
      const provenance = parts.at(-1) === 'case_id' ? 'manifest-literal' : 'fixture-literal';
      if (Array.isArray(value)) {
        checks.push({ path: pointer(parts), op: 'array_length_equals', expected: value.length, provenance });
        value.forEach((item, index) => addChecks(item, [...parts, index]));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) addChecks(item, [...parts, key]);
      } else if (typeof value === 'number' && moneyFields.has(parts.at(-1))) {
        checks.push({ path: pointer(parts), op: 'approximately', expected: value, tolerance: 1e-9, provenance });
      } else {
        checks.push({ path: pointer(parts), op: 'equals', expected: value, provenance });
      }
    }
    addChecks(cases.map((c, i) => ({ case_id: c.case_id, output: expected[i] })), ['cases']);
    return { id: group.id, prompt: group.prompt, input: { cases }, output_schema: schema(group.id), checks };
  });
  return { context_files: ['SKILL.md', 'references/stage-contract.md', 'references/cost-contract.md', 'references/refresh-contract.md'], groups };
}

export function writeManifest({ check = false, target = outputPath } = {}) {
  const generated = `${JSON.stringify(buildManifest(), null, 2)}\n`;
  if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== generated) throw new Error(`stale evaluation manifest: ${target}`); }
  else fs.writeFileSync(target, generated);
  return JSON.parse(generated);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = writeManifest({ check: process.argv.includes('--check') });
  console.log(`${process.argv.includes('--check') ? 'Checked' : 'Wrote'} ${outputPath} (${manifest.groups.length} groups, ${manifest.groups.reduce((n, g) => n + g.input.cases.length, 0)} cases)`);
}

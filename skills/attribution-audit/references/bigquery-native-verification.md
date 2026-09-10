# Native BigQuery verification summary

This document summarizes a bounded native BigQuery proof recorded privately for synthetic fixtures only. It is not a customer journal dump and does not reproduce operational command transcripts that would identify a tenant.

## Scope

- Plan identifier: `q3rbOs` (reviewed public label only)
- Fixture SHA-256: `d98f70dde783ac5cb202b1e901e17561bd187b7b13f5d9f320388280ea1c8cd0`
- Plan SHA-256: `69e2b8a3b47a97541c5caf801970c314b0f8449d2de63441bf4ab0e43324aac4`
- Mode: actual native BigQuery proof on owned synthetic fixtures with explicit byte billing cap (1 GiB)
- Started: 2026-09-09T16:42:29.778Z
- Finished: 2026-09-09T16:55:23.610Z
- Final state: `passed`

## Counts

| Metric | Count |
| --- | ---: |
| Audit outputs verified | 20 |
| Audit confirmed fresh queries | 20 |
| Provisioning confirmed fresh queries | 1 |

## Cleanup

Cleanup status: `verified_absent`. The disposable synthetic dataset was removed after the proof and a follow-up absence check confirmed it no longer exists.

## Source pins

The proof pinned the accepted audit host and upstream SQL sources recorded in the private plan, including:

- `attribution-audit/scripts/execute-audit.mjs`
- `attribution-audit/scripts/compose-audit.mjs`
- `attribution-audit/scripts/render-audit-sql.mjs`
- `attribution-audit/scripts/audit-bigquery-transport.mjs`
- `attribution-audit/references/entrypoints.json`
- `attribution-audit/references/bigquery-native-fixtures.json`
- upstream CRM, GA4 export, funnel, MTA, and quality-tripwire SQL sources listed in the plan `source_hashes`

Exact per-file SHA-256 values match the private plan and the repository at publication time; they are not repeated here to avoid duplicating a large hash table in public docs.

## Limits

- No live model matrix has been run for the audit skill.
- GA4 SQL and PostgreSQL snapshot adapters remain unimplemented in the audit host.
- This summary does not establish universal production readiness; it only records that the bounded native proof passed on synthetic fixtures with verified cleanup.

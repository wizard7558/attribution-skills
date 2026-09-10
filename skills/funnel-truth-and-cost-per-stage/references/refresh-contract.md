# Native partition refresh planning

`sql/refresh_partitions.sql` is a standalone native Standard SQL planner using temporary
synthetic inputs. It emits proposed work and a checkpoint candidate; it never mutates a
permanent ledger or advances a stored watermark. Replace only the marked typed input block.

## Authoritative input contract

Production requires exactly one `invocation_input` row. Every input includes its internal
`invocation_key`; missing or duplicate configuration fails rather than discarding rows.
The invocation requires exact CRM `source_system`/`source_scope`, `prior_report_timezone`,
`report_timezone`, `prior_watermark` TIMESTAMP, `as_of` TIMESTAMP not before that watermark,
positive INT64 `overlap_days`, and explicit `change_feed_complete`, `prior_snapshot_complete`,
and `current_snapshot_complete` booleans. Both snapshots must be declared complete or the
planner fails before emitting actionable work. An empty snapshot is complete only when the
caller explicitly says so. This cannot prove external feed completeness; the caller owns
that assurance and must not label a partial fixture or production fetch complete.

Both timezone fields accept named IANA zones and valid alphabetic aliases such as GMT/CET,
validated by BigQuery. Numeric fixed-offset strings are rejected. The prior timezone belongs
to the stored reporting snapshot and checkpoint; the current timezone is the desired output.

`prior_ledger_input` and `current_ledger_input` are full typed projections of actual native
stage-ledger output. Each row preserves every upstream field:

- Qualified `source_system`, `source_scope`, `lead_key`; `stage_key`, integer `stage_order`,
  `stage_kind`, nullable `achieved`, `is_attribution_primary`, and `stage_truth_status`.
- `cohort_at`, `stage_entered_at` TIMESTAMPs and original `cohort_date`, `activity_date` DATEs.
- Native NUMERIC `value`, `currency`, `value_status`; qualified `evidence_keys` array.
- Full `attribution` STRUCT: channel/version, network/campaign, qualified ad source/scope/key.

The SQL input block and fixture renderer contain the exact types. Identity strings remain
case-sensitive and retain literal plus/percent escapes. Required keys are nonempty without
surrounding whitespace; both snapshots and changes must use the invocation CRM source.
Canonical metadata uses the shared 11-channel taxonomy at version 0.1.0; null channel/version
pairs are allowed. Monetary known/unknown/mixed_currency semantics remain unchanged, with
NUMERIC amounts and uppercase three-letter currency syntax. No values are coalesced to zero.

The scoped ledger key is `(source_system, source_scope, lead_key, stage_key)` within each
snapshot. Identical semantic duplicates collapse; conflicting payloads fail. Physical input
row order is irrelevant. Evidence arrays are sorted by qualified record identity, preserving
all fields and multiplicity, so mere evidence ordering is also irrelevant. The normalized
current rows are emitted intact inside each replacement's `ledger` STRUCT.

Snapshots are authoritative before/after versions chosen upstream. `as_of` is a change-event
cutoff and proposed next watermark; it does not reconstruct a historical CRM status or stage
snapshot. Never restrict these ledgers to recently created leads: a months-old lead can have
a newly corrected won date, value, qualification, primary flag, or attribution.

`change_input` requires qualified CRM source/scope/lead, `change_key`, `changed_at` TIMESTAMP,
and informational `reason` (`lead`, `opportunity`, `event`, `deletion`, `configuration`).
The change-event key is `(source_system, source_scope, change_key)`; identical events collapse
and conflicting payloads fail. Map upstream opportunity/event CDC to the qualified CRM lead
before invoking this planner. A change for a lead absent from both snapshots is retained in
change evidence but cannot invent a ledger row or partition.

## Change coverage and target partitions

Selected CDC events satisfy the inclusive interval:

```text
max(TIMESTAMP year 0001, prior_watermark - overlap_days * 24 hours) <= changed_at <= as_of
```

The overlap start saturates at BigQuery’s minimum timestamp, `0001-01-01T00:00:00Z`.
Every positive INT64 lookback remains valid, including the maximum INT64 and watermarks
near year 1. BIGNUMERIC day-to-microsecond arithmetic compares the requested span with
the available timestamp range before a conditional timestamp subtraction, avoiding overflow.
Negative, zero, and fractional lookbacks remain invalid.

This overlap is a watermark lookback, not a lead-created-date filter. Just-before-window and
future events remain in `change_evidence` with selection status, qualified keys, timestamps,
reasons, and diagnostic counts. Repeated delivery is idempotent.

The planner independently compares **all** normalized before/after semantic rows. Additions,
deletions, timestamps, values, currency/status, primary flag, attribution, original derived
dates, and evidence can establish a difference. It reports scoped `changed_leads`,
`different_leads`, and differing `uncovered_leads` without selected CDC evidence.

Mode is `full_reconciliation` if the change feed is incomplete, any snapshot difference lacks
selected CDC coverage, or the reporting timezone changes. Explicit fallback reasons distinguish
these conditions; otherwise the mode is `incremental`. Cold-start additions without CDC
therefore trigger full reconciliation even with an explicitly complete empty prior snapshot.

The partition identity is `(source_system, source_scope, date_mode, report_date)`, for **both**
cohort and activity modes. Prior partitions are computed from their corresponding timestamp
using `prior_report_timezone`; current partitions use `report_timezone`. A timezone change
forces the union of every old and new partition to be replaced. Original upstream
`cohort_date`/`activity_date` fields may use their own source reporting timezone and are
preserved unchanged; the separately emitted `report_date` governs replacement placement.

Incremental work targets all old and new partitions of every selected changed lead, even if
that lead's semantic rows did not change. Full fallback targets all old and new partitions.
Old targets remain after date moves and deletions; empty replacements still mean delete the
old partition. Null dates are explicit undated targets, compared with `IS NOT DISTINCT FROM`.
Do not use ordinary equality for nullable partition dates.

`target_partitions` contains sorted keys, a planning reason, and qualified selected-change
evidence. `replacement_ledger` contains the **complete current population** of each target,
including unchanged leads that share that partition. Replacing with changed leads alone
would erase unrelated rows. Each replacement carries `date_mode`, `report_date`, and its full
upstream `ledger`. Consumers select one date mode for reporting; never sum both expanded modes.

The output also includes timezone metadata, mode/fallback reasons, overlap start,
`proposed_next_watermark=as_of`, complete change evidence, and duplicate/exclusion diagnostics.
Proposed work remains actionable only after all downstream validation and checkpoint fencing
succeed.

## Native output codes and ordering

The exact codes and ordered arrays below follow [refresh_partitions.sql](sql/refresh_partitions.sql),
including `change_evidence`, `refresh_modes`, `target_partitions`, and the final payload SELECT.
These codes must not be replaced with synonymous text.

`change_evidence.selection_status` is `before_overlap` when `changed_at < overlap_start`,
`future` when `changed_at > as_of`, and `selected` otherwise. Both boundaries are inclusive
for selected changes. `mode` is `full_reconciliation` if any fallback condition applies,
otherwise `incremental`.

`fallback_reasons` includes every applicable reason exactly once, in this fixed order:

1. `timezone_changed` when prior and current report timezone strings differ.
2. `incomplete_change_feed` when the declared change feed is incomplete.
3. `uncovered_snapshot_differences` when any semantic before/after difference lacks selected CDC.

This is ordered accumulation, not first-match precedence. If none applies, the array is empty.
A target partition's `reason` is `selected_change` for incremental mode and
`full_reconciliation` for full mode. Evidence can remain empty without inventing a change ID.

Output arrays use these exact ascending sort tuples:

| Array | Sort tuple |
| --- | --- |
| `target_partitions` | `(date_mode, report_date IS NULL, report_date)` |
| `replacement_ledger` | `(date_mode, report_date IS NULL, report_date, ledger.lead_key, ledger.stage_order, ledger.stage_key)` |
| `changed_leads`, `different_leads`, `uncovered_leads` | `(lead_key)` |
| `change_evidence` | `(change_key)` |
| Target partition `evidence_keys` | `(change_key)` |
| Each normalized ledger's `evidence_keys` | `(source_system, source_scope, record_kind, record_key)` |

Thus activity partitions precede cohort partitions, and dated partitions precede null-date
partitions within each mode. Lead keys precede configured numeric stage order within one
replacement partition. Keep the same order when projecting nested ledger fields into a compact
row, even when `stage_order` itself is omitted. Strings retain the SQL's default uncollated,
case-sensitive ordering. Other nullable sort fields use ascending nulls-first behavior.
Ties advance through the tuple; the SQL has no additional tie-breaker after its last term.
Input validation and semantic deduplication retain one row for each qualified lead/stage and
one entry for each target key. The outer result sorts by `invocation_key`.

Full reconciliation replaces the union of prior and current partitions, but replacement rows
come only from the current snapshot. An old partition may therefore have no replacement row;
it still remains a target for deletion. A moved lead must not be emitted at its old activity
date, and an unchanged current member of any target must not be dropped. Cohort and activity
outputs are separate populations even when they refer to the same lead.

## Atomic application and retries

The reference emits no permanent mutation. A production adapter should apply the plan in one
warehouse transaction after building and validating the complete replacement rows:

1. Assert the stored scoped checkpoint still equals **both** `prior_watermark` and
   `prior_report_timezone`. A missing checkpoint needs an explicitly provisioned cold-start
   checkpoint, not an inferred success. This fence protects against stale concurrent work.
2. Delete all scoped target partitions, including null-date targets, using null-safe equality.
3. Insert every proposed replacement row. Empty target partitions intentionally receive none.
4. Verify the rebuilt targets equal the authoritative current partition population, including
   complete payloads and duplicate multiplicity; row counts alone are insufficient.
5. Compare-and-swap the checkpoint from that same prior watermark/timezone to `as_of` and
   `report_timezone`; assert exactly one checkpoint row changed, then commit.

Any failure must roll back partition changes and checkpoint advancement together. Concurrent
writers must conflict on/fence the same scoped checkpoint; a losing writer reloads the current
checkpoint and replans instead of retrying stale writes. Replaying the same plan against the
same prior checkpoint is idempotent because the operation deletes targets before inserting
the complete population. Once committed, that stale prior checkpoint no longer matches.
Never advance a watermark after partial success, a failed assertion, or a separate uncommitted
partition write.

A production implementation may use reliable CDC plus authoritative full affected-partition
fetches instead of two entire warehouse snapshots, but that is a different adapter assurance.
This reference deliberately requires complete snapshots to make its global difference check
and full fallback sound. It does not authorize treating partial snapshots as complete.

## Runnable verification

```sh
node scripts/test-refresh-partitions.mjs
node scripts/test-refresh-partitions.mjs --live --project YOUR_BILLING_PROJECT
node scripts/test-refresh-partitions.mjs --live --project YOUR_BILLING_PROJECT --integration
```

Offline mode checks fixture definitions only and explicitly does not execute native SQL.
Live mode executes every success fixture with full golden outputs and every structural
failure as an actual SQL error. An independent application simulation expands prior/current
rows into both date modes, applies `prior minus targets plus replacement`, and requires exact
current-snapshot equality. The same assertion must reject a deliberately incorrect
changed-lead-only replacement. This simulation is partition application, not a copied stage
engine. Native SQL remains the source of all refresh outputs.

`--integration` additionally requires the sibling native stage SQL: it runs actual stage truth
twice with a synthetic late won-date/value rewrite and an unaffected same-partition lead,
feeds both outputs into refresh SQL, then checks old/new activity targets, full replacement,
and application equality. Standalone SQL and fixed fixtures need no sibling implementation.

Every live job uses Standard SQL and an explicit 1 GiB billed-bytes cap. Private Downloads
reports record actual job IDs, hashes, caps, errors, bytes, and versions; failed reports remain.
`--resume-report PRIVATE_REPORT` requires matching SQL and fixture hashes, writes a new linked
report, and retrieves already successful jobs read-only. For an expected-output correction,
`--recheck-goldens` additionally requires an unchanged successful-fixture query hash before
retrieving the completed job and rechecking every full golden; both fixture hashes are recorded.
`--overlap-delta-report PRIVATE_REPORT --prior-sql PRIOR_SQL --prior-fixtures PRIOR_FIXTURES`
is the narrow saturation correction audit: it requires byte-exact prior validation code and
unchanged original fixtures, preserves unrelated failure-job evidence, reruns every successful
golden on changed SQL plus zero/negative/fractional failures, and rechecks the changed refresh
integration using read-only results from unchanged stage jobs. Revision evidence is kept separate.
No production-scale performance, storage, or cost benchmark is claimed.

<!-- execution-status:start -->
Authenticated native BigQuery checks passed on 2026-09-09: standalone SQL, 18 full golden fixtures (41 targets / 40 replacement rows), 3 current-revision SQL failure checks plus 13 preserved failures with byte-exact validation-prefix proof. All successful fixtures passed full application equality against the current snapshot for both date modes; changed-lead-only replacement was rejected. The changed refresh SQL passed integration using read-only reverified outputs from both unchanged actual stage jobs. Every job confirmed Standard SQL and a 1 GiB billed-bytes cap. Private IDs, hashes, versions, measured bytes, and any earlier failures remain in Downloads reports. This is synthetic correctness evidence, not a production scale benchmark.
<!-- execution-status:end -->

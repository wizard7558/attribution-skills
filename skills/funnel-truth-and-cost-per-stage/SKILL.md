---
name: funnel-truth-and-cost-per-stage
description: Reconcile CRM funnel stage truth, cost buckets, and refresh partitions from complete snapshots and explicit source bindings.
version: 0.1.0
author: Riley Sorenson
license: MIT
---

# Funnel truth and cost per stage

Use this skill when a request asks for a trustworthy CRM funnel, cost per stage, cohort or
activity reporting, late CRM corrections, partition refreshes, or reconciliation of CRM and ad
spend. It is for scoped synthetic or native SQL inputs with explicit source identities.

## Workflow

1. Establish stage truth from a complete, as-of snapshot. Validate source scope, configured stage
   order, timezone, completeness flags, and source-native keys. Build one ledger row for every
   eligible lead and configured stage. Keep non-primary rows in the population and keep
   attribution as a separate field.
2. Reconcile cost from the stage ledger. Resolve CRM-to-ad records only through the exact six-field
   binding and `entity_type=campaign`. Use a full outer reconciliation with `matched`, `ambiguous`,
   `unmatched`, `unattributed`, and `spend_only` buckets. Aggregate spend once, then repeat it
   for each configured stage; never add repeated stage spend together.
3. Plan a safe partition refresh. Compare complete prior and current snapshots semantically across
   all rows, select change-feed records inside the overlap and as-of boundary, and target both
   cohort and activity partitions. Replace complete current populations for targeted partitions,
   retain unaffected rows, and advance a checkpoint only with compare-and-swap semantics.

## Truth rules

- A later loss does not erase any eligible win. Aggregate all distinct opportunities before the
  stage spine; retain every winning evidence key and use the earliest eligible winning timestamp.
- Incomplete opportunity feeds make an otherwise unproven won state `unknown`, not false. Unknown
  and mixed currency values have null amounts and explicit statuses. A known zero remains zero.
- A complete snapshot with no win evidence can establish false; future evidence is excluded by the
  as-of boundary and reported diagnostically. Missing or blank qualification status is unknown.
- Cohort and activity dates are independently derived in the declared IANA timezone. Undated
  achieved stages remain in the ledger but do not enter a dated activity bucket.
- Value sums are exact NUMERIC values and are never converted across currencies. Do not infer a
  cross-system join from a bare identifier or from a campaign name.

## Required boundaries

Inputs must declare source system, source scope, as-of or report window, timezone, date mode,
source completeness, and the configured stage set. Cost inputs must include explicit six-field
bindings (`crm_source_system`, `crm_source_scope`, `ad_source_system`, `ad_source_scope`,
`platform`, `entity_type`) and use campaign bindings only. Refresh inputs must include complete
prior/current snapshots, prior and current timezones, watermark, overlap, change-feed status, and
an as-of time.

Use the native SQL contracts in `references/stage-contract.md`, `references/cost-contract.md`,
and `references/refresh-contract.md` as the authoritative input/output definitions. The shared
channel and monetary boundary is in `references/channel-contract.md`.

## Output discipline

For native SQL, return complete ledgers and reconciliation evidence, including nulls, false values,
empty arrays, ordering, diagnostic counts, fallback reasons, target partitions, and proposed
watermark. Evaluation uses a compact projection of those native results and checks every selected
field. Do not
silently substitute current data for a missing snapshot, coerce unknown money to zero, or report a
partial refresh as complete. Native SQL execution belongs to an environment with BigQuery; an
offline fixture check validates literal contracts and does not execute SQL.

For operational use, follow `references/implementation.md`. The fixed evaluation cases in
`references/eval-cases.json` cover stage gaps and multi-opportunity truth, unknown and mixed money,
all five reconciliation buckets, timezone and undated activity, late rewrites, deletion, and
timezone-triggered full refresh. See [evaluation status and revision history](references/eval.md) for completed runs and pending revisions.

---
name: attribution-data-quality-tripwires
description: Run nine native attribution quality checks with explicit source populations, complete evidence, unknown-value guards, and reproducible findings; inspect schema and column population without inferring deletion or identity.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# Attribution data quality tripwires

Use this skill to verify attribution reporting against explicitly scoped source evidence,
inspect schema policy or column population, and investigate ad spend coverage. Choose the
checks required by the user's question; thresholds, completeness and populations are explicit.
These checks do not classify traffic, match people, infer causal attribution or diagnose a provider.

Read [implementation.md](references/implementation.md) for runnable commands and upstream
projections. The [quick reference](references/quality-quick-reference.md) summarizes all nine
checks; the [shared contract](references/channel-contract.md) defines source boundaries.
The detailed contracts linked below are authoritative for typed inputs and full findings.

## Declare evidence before deciding

1. Identify the report scope, source systems/scopes, named timezone, inclusive date window,
   date mode, selected stage or metric where applicable, and opaque evidence references.
   Cohort and activity populations are distinct. Do not infer a person bridge from a channel,
   campaign label, bare identifier or IP address.
2. Supply the required explicit inventory or comparison memberships and completeness flags.
   Exact keys preserve case and plus signs. Repeated identical source records collapse under
   each contract; conflicting qualified records fail structurally. Never select an arbitrary winner.
3. Supply typed native inputs. Validate every raw row, including excluded evidence and empty
   input table types. Unknown money remains NULL with its status; missing data is not known zero.
   Known zero requires the relevant complete-side or explicit observation rule.
4. Use an authorized dataset/window and deliberate query cap. The supplied examples are synthetic.
   Do not automatically query customer tables, infer new memberships, or widen an unavailable
   scan. No check authorizes a connector resync or provider API request.

## Choose the native check

| Check | Runnable SQL | Detailed contract |
| --- | --- | --- |
| Spend conservation | [spend-conservation.sql](scripts/spend-conservation.sql) | [Reconciliation](references/reconciliation-contract.md) |
| Funnel additivity | [funnel-additivity.sql](scripts/funnel-additivity.sql) | [Reconciliation](references/reconciliation-contract.md) |
| Unmapped share ceiling | [unmapped-share.sql](scripts/unmapped-share.sql) | [Population](references/population-contract.md) |
| Ad match rate floor | [match-rate.sql](scripts/match-rate.sql) | [Population](references/population-contract.md) |
| Primary uniqueness | [primary-uniqueness.sql](scripts/primary-uniqueness.sql) | [Population](references/population-contract.md) |
| Source parity | [source-parity.sql](scripts/source-parity.sql) | [Population](references/population-contract.md) |
| Schema name policy | [no-pii-columns.sql](scripts/no-pii-columns.sql) | [Schema](references/schema-contract.md) |
| Column population | [empty-column-probe.sql](scripts/empty-column-probe.sql) | [Population observation](references/empty-column-contract.md) |
| Ad/campaign spend coverage | [deleted-ad-coverage.sql](scripts/deleted-ad-coverage.sql) | [Coverage](references/deleted-ad-coverage-contract.md) |

All nine are native BigQuery Standard SQL with temporary synthetic input blocks. Replace the
marked inputs with typed projections and require one explicit production configuration. They
create no permanent objects. Their check IDs are defined in the linked contracts, independently
of any particular fixture, vendor or model evaluation.

## Preserve the evidence that matters

- Spend conservation selects one stage before summing observed spend across all five buckets,
  including spend_only. Spend repeats across configured stages by design. Unknown money blocks
  monetary comparisons, but complete date-level fact counts can independently prove a defect.
- Funnel additivity retains unknown achievement, nonprimary leads, undated rows and every bucket.
  Compare all four counts independently; later stage order does not establish earlier achievement.
  There is no implicit monotonic funnel assumption.
- Rate checks use explicit eligible populations and interval bounds for unknown conditions.
  They are semantic projections, not alternative classifiers or matching engines. A partial
  population cannot establish its full rate even when supplied observations are known.
- Primary uniqueness checks qualified groups and declared singletons. Observed multiple primaries
  can prove a defect under partial evidence. It does not choose the earliest person or redo identity.
- Source parity requires explicit matching metric/population declarations; a UI and a warehouse
  are not presumed comparable. Keep missing incomplete counts NULL.
- Schema policy checks configured names, including nested paths. It does not scan values or
  certify legal PII compliance. An observed forbidden path can fail despite incomplete inventory.
- Column population tests SQL NULL only. Zero, false and blank text can be populated. Preserve
  report_window versus full_table_snapshot scope. A positive observation can prove population
  under a partial scan; absence, missing scans and zero observed rows are different unknowns.
- Ad/campaign coverage requires explicit source pairs, history, timezone, deletion and filter
  declarations. Preserve both gap directions and unknown dates. No vendor or backfill exemption
  turns a discrepancy into a pass, and a gap is not proof that an ad was deleted.

## Extract actual metadata and population

[inspect-schema.sql](scripts/inspect-schema.sql) reads TABLES, COLUMNS and nested COLUMN_FIELD_PATHS
for a named inventory. Attach invocation_key to its actual membership/columns arrays and supply
an explicit schema policy to no-pii-columns.sql. Preserve metadata job evidence and errors.

[inspect-column-population.sql](scripts/inspect-column-population.sql) reads metadata first,
then runs one bounded aggregate over supported top-level scalar targets. Attach invocation_key
to its actual membership/observations arrays; cast decimal count strings to INT64 for the checker.
Retain extractor unsupported_type diagnostics beside the finding. Missing fields never compile
as guessed source-column references; failed permissions/location/scans remain execution failures.
Use the contracts' named parameters, explicit mode/date scope and billing cap.

## Run and return the complete result

From the skill root, the following runs one standalone synthetic check:

~~~sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query \
  --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 \
  < scripts/spend-conservation.sql
~~~

Choose the appropriate SQL path from the table. Return its **entire native finding unchanged**:
configuration, status, reasons, evidence references, all details and diagnostics. The result row
also carries invocation_key and the serialized result_json. An interpretation may accompany the
finding, but must not replace unknowns, discard caveats, rewrite statuses or fabricate missing fields.
Execution errors stay errors; do not substitute an unknown or passing native finding.

Overall precedence is fail, then unknown, then pass. Apply each contract's rules for independently
proven local defects or values under partial evidence. Observed amounts and counts are not automatically
complete totals. Reasons can coexist with proven findings, and some checks retain nonblocking caveats.

## Verify and distinguish evaluation scope

~~~sh
node scripts/test-reconciliation.mjs
node scripts/test-population-checks.mjs
node scripts/test-schema-checks.mjs
node scripts/test-empty-columns.mjs
node scripts/test-deleted-ad-coverage.mjs
~~~

These default commands validate definitions and explicitly report NO SQL EXECUTED. Native and
integration modes are opt-in and documented in implementation.md; accepted synthetic evidence
already exists. Integration is not proof of production completeness or a performance benchmark.

A separate model evaluation scores a compact requested-field projection. Its
[output contract](references/evaluation-output-contract.md) applies only to evaluation, never
normal native reporting. [eval.md](references/eval.md) records its pre-live status and frozen
manifest. Model evaluation is not a substitute for native SQL execution. Do not run model calls
as part of ordinary quality checks or claim model scores before live evaluation is authorized.

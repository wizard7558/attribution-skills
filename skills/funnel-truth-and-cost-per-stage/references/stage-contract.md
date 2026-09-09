# Native CRM stage-truth ledger

Version: `0.1.0`. The runnable reference is [sql/stage_truth.sql](sql/stage_truth.sql).
It uses native Standard SQL only and creates temporary tables. One invocation consumes one
explicitly scoped, current CRM source snapshot. This step does not join spend or calculate
cost per stage.

## Required inputs

Replace the clearly marked synthetic input block. Its temporary tables have these schemas;
all tables carry the same nonempty internal `invocation_key` for the production run.

| Input | Fields |
| --- | --- |
| `invocation_input` | Exactly one row: `source_system STRING`, `source_scope STRING`, `report_timezone STRING`, `as_of TIMESTAMP`, `opportunities_complete BOOL`; all required. |
| `lead_input` | Exact `source_system`, `source_scope`, `lead_key`; nullable `created_at TIMESTAMP`, `status STRING`, `is_converted BOOL`, `converted_at TIMESTAMP`, `qualified_at TIMESTAMP`; required `is_attribution_primary BOOL`. |
| `stage_input` | `stage_key STRING`, integer-valued `stage_order`, `stage_kind STRING`: `lead`, `qualified`, `converted`, `won`, or `event`. |
| `exclusion_input` | `stage_key STRING`, `status STRING`; explicit qualified-stage exclusion policy, including an intentionally empty table. |
| `opportunity_input` | Origin `source_system`, `source_scope`, `opportunity_key`; qualified `lead_source_system`, `lead_source_scope`, `lead_key`; nullable `is_won BOOL`, `won_at TIMESTAMP`; `value NUMERIC`, `currency STRING`, `value_status STRING`. |
| `event_input` | Origin `source_system`, `source_scope`, `event_key`; qualified lead-reference triple; configured event `stage_key`; nullable `occurred_at TIMESTAMP`. |

Native TIMESTAMP columns represent actual instants; normalize source timestamps with explicit
offsets upstream. `report_timezone` must be explicitly supplied as UTC or a valid IANA zone.
`as_of` is required. The script validates the timezone by using BigQuery's timestamp formatter.

The source snapshot is chosen upstream. `as_of` is an event cutoff, **not** reconstruction of
historical status, conversion flags, opportunity completeness, or attribution values. Do not
label current snapshot results as historical point-in-time truth. Leads created after `as_of`
are excluded and counted; null creation dates remain in the ledger as undated leads.

Origin opportunity/event sources may differ from the lead's CRM source. Each record must carry
an explicit, exact qualified reference to an input CRM lead. Empty origins, cross-scope lead
references, and dangling references are errors. There is no inferred cross-system identity
bridge. Exact keys retain case and literal plus; no normalization joins bare IDs globally.

Exact duplicate leads, stages, opportunities, and events collapse idempotently. Conflicting
payloads for one qualified native identity fail. Stages require unique keys and unique orders;
identical definitions collapse, conflicting definitions fail, and arbitrary order gaps are
valid. Stage orders must be finite integers representable as INT64. The sample input uses a
numeric staging column so the SQL can reject fractional orders before casting them.

## Stage semantics

- **Lead:** every nonfuture input lead has achieved=true, including a null creation date.
- **Qualified:** normalize status with trim/lower and compare to the explicit exclusion seed
  for that stage. Missing/blank status is unknown; excluded status is false; other status is
  true. `stage_entered_at` comes only from `qualified_at`, never from creation time.
- **Converted:** use nullable `is_converted`; its timestamp comes only from `converted_at`.
  A timestamp alone cannot turn false or unknown flags into an achieved stage.
- **Won:** aggregate every distinct opportunity before collapsing the lead/stage spine. An
  observed, nonfuture winning opportunity establishes true even if another opportunity later
  loses. With a complete feed, known losses or no opportunities mean false; unknown flags
  without a win mean unknown. With an incomplete feed, no observed win always means unknown.
- **Event:** select the first nonfuture explicit event by timestamp, nulls last, then event
  key. Origin source system/scope completes ties between otherwise equal qualified keys.
  An undated event may establish snapshot achievement but has no activity date. No event
  means false under the explicit event snapshot convention.

Positive qualified/conversion evidence dated after `as_of` is pending and cannot establish
achievement. Future won timestamps and events cannot establish achievement or contribute
monetary totals. An event exactly at `as_of` is included. Undated positive snapshot evidence
may establish achievement while activity timing remains indeterminate.

The won timestamp is the earliest known nonfuture winning timestamp. If all eligible wins
are undated, it remains null. `evidence_keys` preserves **all** eligible winning opportunity
identities, including undated wins; later losses cannot erase them. Future wins are excluded
from those keys and counted in diagnostics. Event evidence identifies the first selected
qualified event. Snapshot stages use the lead's qualified identity.

`opportunities_complete` is required. True asserts an explicit, complete opportunity snapshot;
false declares a missing or partial feed. False never yields a complete monetary total, even
when a known observed win establishes achievement. The incomplete-source diagnostic is one
for an incomplete invocation, zero otherwise.

## Monetary values

The raw monetary contract uses `known`, `unknown`, and `mixed_currency`. Known values require
a non-null NUMERIC amount and an uppercase three-letter currency code. Currency codes must be
validated against the intended ISO registry upstream; the SQL enforces their format. Unknown
and mixed-currency values require null amounts; mixed-currency input also has null currency.

The native ledger uses NUMERIC arithmetic, preserving exact decimal sums within BigQuery's
NUMERIC precision and nine-digit fractional scale. Supply native NUMERIC inputs; any source
conversion/rounding must be explicit upstream. Values outside that type's range fail rather
than silently becoming zero. No implicit currency conversion occurs. BigQuery JSON export may encode exact NUMERIC
decimals as strings (for example, `"0.3"`); preserve that representation or use a decimal
parser rather than coercing monetary values through binary floating-point.

For a complete feed, sum winning values only when every eligible winning value is known and
currencies agree. Any unknown value produces null/unknown. Multiple known currencies or an
explicit mixed-currency winning value produce null/mixed_currency. An incomplete feed always
produces null/unknown. A currency remains available only when the complete set of eligible
wins has the same non-null currency and is not mixed. No winning opportunities yields
null/unknown, not zero revenue. An explicitly known zero amount remains known zero. Non-won
stages have null amounts/currency and unknown monetary status.

## Native output and diagnostics

`stage_ledger` has one row per retained qualified CRM lead and configured stage:

`source_system`, `source_scope`, `lead_key`, `stage_key`, `stage_order`, `stage_kind`, nullable
`achieved`, `cohort_at`, `stage_entered_at`, `cohort_date`, `activity_date`,
`is_attribution_primary`, `value`, `currency`, `value_status`, typed `evidence_keys`,
`stage_truth_status`, and transparent `attribution` metadata.

Dates use `DATE(timestamp, report_timezone)`; null dates stay null. Nonprimary and untracked
leads remain. Attribution-primary flags are separately available for explicitly chosen
attribution denominators and never filter stage truth or the full funnel population.

`stage_truth_status` is `achieved`, `achieved_undated`, `not_achieved`,
`pending_future_evidence`, or `unknown`. Unknown flags take precedence over pending status;
future-evidence counts remain available in diagnostics. Evidence keys are STRUCTs with
`source_system`, `source_scope`, `record_kind`, and `record_key`.

Optional lead metadata fields are `channel`, `taxonomy_version`, `network_id`, `campaign_key`,
`ad_source_system`, `ad_source_scope`, and `ad_key`. They pass through unchanged without
inventing a channel or inferring an ad join. Channel/version must both be null or a canonical
11-channel value paired with taxonomy `0.1.0`. The ad identity triple is all-or-none,
nonempty, and has no surrounding whitespace. Non-null network and campaign keys must be exact, nonempty strings without surrounding
whitespace. Qualified campaign/ad keys retain case/plus.

`stage_diagnostics` counts excluded future leads/events/wins, future qualification/conversion
timestamps, an incomplete opportunity source, and exact duplicates collapsed in each main
input. The final SELECT returns a JSON object containing the full ordered ledger and these
diagnostics, even for an empty population. The internal invocation key isolates fixture
runs; it does not replace qualified source identities or appear inside ledger rows.

The final ledger array sorts ascending by `(lead_key, stage_order)`, using the configured
numeric stage order rather than lexical stage key or input order. Stage keys and orders are
unique by validation, so no further stage tie-breaker is needed for one lead. Qualified lead
keys are non-null and retain default uncollated, case-sensitive SQL string ordering. The outer
result sorts by `invocation_key`. Preserve that order in compact projections that omit
`stage_order`. These rules come from the final payload SELECT in
[stage_truth.sql](sql/stage_truth.sql).

The exact `stage_truth_status` precedence is: null `achieved` gives `unknown`; false achievement
with pending future evidence gives `pending_future_evidence`; other false achievement gives
`not_achieved`; true achievement with no entered timestamp gives `achieved_undated`; otherwise
`achieved`. This is the ordered CASE expression in the native ledger, not an inferred label.

Cohort ratios are observational population summaries. They do not establish causal lift.
This stage ledger alone makes no cost, ROI, or spend reconciliation claim.

## Checks and execution evidence

```sh
node scripts/test-stage-truth.mjs
node scripts/test-stage-truth.mjs --live --project YOUR_BILLING_PROJECT --location US
bq --project_id=YOUR_BILLING_PROJECT --location=US query \
  --use_legacy_sql=false --maximum_bytes_billed=1073741824 \
  < references/sql/stage_truth.sql
```

The first command validates fixture definitions only; it does not claim SQL execution.
Live tests execute the standalone script, all successful fixtures in independent namespaces,
and each structural failure as an actual failed BigQuery job. Complete expected ledgers and
diagnostics are independently stored in [stage-fixtures.json](stage-fixtures.json), with no
second JavaScript stage-reporting engine. The SQL uses no permanent or customer tables.

Private execution reports default to `~/Downloads/funnel-stage-truth-bigquery-evidence-TIMESTAMP.json`.
`--report PATH` chooses a durable location. `--resume-report PRIOR.json` preserves the old
report and writes a new linked report; it reuses only verified matching query hashes. Reports
record actual job IDs, CLI version, source/fixture hashes, bytes, states, errors, and counts.
A narrowly scoped `--validation-delta-report PRIOR.json` mode reuses completed result rows
read-only after adding the explicitly marked optional network/campaign-key assertion. It
proves that removing only that validation exactly reproduces the prior SQL/query hashes,
rechecks all saved results against current goldens, then runs the current standalone SQL,
affected metadata fixture, and every structural failure. Revision coverage remains separate
in both private and public reports; prior hashes are never relabeled as current execution.
Public status below contains no billing project or private job identifiers. Synthetic checks
are not a production scale or cost benchmark.

<!-- execution-status:start -->
Authenticated native BigQuery checks passed on 2026-09-08.
The 15 successful golden fixtures (95 ledger rows) were preserved
from the verified stage-logic revision. Removing only the added optional-key validation
exactly reproduces that prior SQL hash. Final SQL independently reran the standalone
reference and the affected metadata fixture (10 ledger rows).
Final SQL also passed 17 structural fixture failures and two production
configuration failures. Every job confirmed Standard SQL and a 1 GiB billed-bytes cap.
Private job IDs, billing project, CLI version, revision hashes, and measured bytes remain
in the Downloads reports. This is correctness evidence, not a scale or cost benchmark.
<!-- execution-status:end -->

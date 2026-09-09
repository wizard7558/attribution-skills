---
name: multi-touch-models-sql
description: Build and verify native BigQuery multi-touch credit ledgers, exact monetary allocations, and channel/day cost, CAC, and ROAS reports using explicit source populations and qualified identity bridges.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# Multi-touch models SQL

Use this skill for first-touch, last-touch, linear, position-based, or time-decay attribution
in BigQuery, including conversion coverage and downstream monetary metrics. The executable
references implement descriptive allocation rules. MTA and decay weights do not establish
causal lift or incremental revenue.

Read the [shared channel contract](references/channel-contract.md),
[ledger contract](references/ledger-contract.md), and
[metrics contract](references/metrics-contract.md) before preparing inputs. Follow the
[implementation guide](references/implementation.md) for exact commands and projections.

## Workflow

1. Declare qualified touch/conversion keys, the explicit subject bridge, source currencies,
   named report timezone, inclusive conversion-date range, as-of timestamp, requested/minimum/
   maximum lookback days, conversion-window mode, and positive half-life in fractional days.
   Classify touches with the shared taxonomy and retain taxonomy version `0.1.0`.
2. Run [credit_ledger.sql](references/sql/credit_ledger.sql) with the supplied touch and
   conversion history. Inspect its actual `ledger`, `coverage`, and diagnostics outputs.
   The ledger emits all five models. Keep uncovered conversions in coverage.
3. Declare exactly one metrics invocation, one opaque `report_scope`, explicit nonempty
   conversion and spend source memberships, exactly one selected model, matching report
   dates/timezone/as-of/mode, spend completeness, outcome kind, and acquisition-history
   completeness. Source memberships allocate sources to a report; they are not identity proof.
4. Project the actual ledger and coverage outputs using the exact consumed fields in the
   metrics contract. Feed these projections and qualified spend facts into a separate
   [attribution_metrics.sql](references/sql/attribution_metrics.sql) job. The integration runner
   performs this actual-output handoff; expected fixtures never substitute for producer output.
5. Review exact allocated-money conservation, coverage, unknown/mixed currencies, observed
   versus final spend, ratio reasons, source exclusions, and duplicate diagnostics. Report the
   selected model and declared population with every result.

## Identity, windows, and models

Touch/conversion eligibility requires an exact all-or-none subject triple:
`subject_source_system`, `subject_source_scope`, `subject_key`. It must come from an explicit
matched identity bridge or a documented source-native identified subject. Native user IDs,
visitor keys, IP addresses, and channel labels never create a cross-source person bridge.
Never infer that GA4 and pixel populations describe the same people or sum them as a deduplicated
population. Preserve full source system/scope/native keys; do not join bare IDs.

- `full_lookback`: inclusive lookback start through conversion timestamp.
- `segmented`: the same lookback, additionally excluding touches at or before the previous
  conversion. Supply previous-conversion history even when it is outside the report.
- `acquisition`: only the first observed conversion per subject receives credit. Supplied
  history alone cannot establish lifetime acquisition; repeated conversions remain explicitly
  `acquisition_repeat_excluded`.

The models are `first_touch`, `last_touch`, `linear`, `position_based`, and `time_decay`.
First/last models retain zero-credit rows for other eligible touches. Linear splits one across
eligible touches. Position-based uses one for one touch, halves for two, and `.4` at each
endpoint with `.2` split among the middle touches for three or more. Decay uses fractional-day
ages and a positive `half_life_days`; the youngest touch has raw weight one before normalization.
These are model conventions, not measured causal effects.

Coverage distinguishes `credited`, `unresolved_subject`, `no_eligible_touches`, and
`acquisition_repeat_excluded`. Never invent a Direct touch for an uncovered conversion.
Report by conversion date in the declared timezone; this metrics implementation has no
alternative touch-date or campaign join.

## Monetary rules

Original conversion `value` repeats across touches and models as provenance. **Never sum that
repeated value as revenue.** Select one model, use its allocated `allocated_value`, and aggregate
once at the report grain. The native allocator uses BIGNUMERIC cumulative endpoints in `1e-9`
units, preserves original FLOAT64 credit, and asserts exact known-money conservation. Monetary
values and ratios are returned as decimal strings in result JSON.

Unknown or mixed money stays null with an explicit status. A zero-credit unknown row remains
visible without poisoning positive-credit known revenue. Spend is aggregated independently
before the channel/day full outer join; retain credited-only, matched, spend-only, and uncredited
outputs. Spend-only revenue has no inferred currency. Partial spend remains unknown even when
an observed amount is supplied; complete absent spend becomes known zero only under the
explicit consistent-currency membership rule.

Ordinary conversions report `cost_per_attributed_conversion`; CAC is null with
`not_new_customer_population`. CAC requires `outcome_kind='new_customers'`,
`conversion_window_mode='acquisition'`, and true `acquisition_history_complete`. ROAS requires
known allocated revenue and positive known same-currency spend. Preserve null reasons for
unknown/mixed money, zero/negative denominators, mismatched currencies, and numeric failures.

## Verification

Run commands from this skill's directory. Node.js and an authenticated BigQuery CLI are the
only runner dependencies; native evidence used Node.js `20.18.1` and BigQuery CLI `2.1.19`.
A billing project and its native job permissions are required only for live execution.

Offline definition checks — **NO SQL EXECUTED**:

```sh
node scripts/test-credit-ledger.mjs
node scripts/test-attribution-metrics.mjs
```

Complete bounded native suites:

```sh
node scripts/test-credit-ledger.mjs --live --project YOUR_BILLING_PROJECT --location US
node scripts/test-attribution-metrics.mjs --live --project YOUR_BILLING_PROJECT --location US
```

Actual producer-to-consumer integration checks only:

```sh
node scripts/test-attribution-metrics.mjs --live --project YOUR_BILLING_PROJECT --location US --cases integration-1,integration-2,integration-uncredited
```

Native runners use Standard SQL, disable caching, and cap each job at 1 GiB. Use separate
producer and consumer jobs: concatenating these scripts exceeded that cap through BigQuery's
minimum billing on temporary-table statements. The bounded synthetic checks are not production
scale measurements. Reports default to timestamped private Downloads files; preserve their
job handles, hashes, raw outputs/errors, and explicit scope. `--cases` reports partial coverage.

Accepted metrics evidence contains 37 full metrics fixtures, 3 actual-output integrations,
standalone/permutation checks, and 37 expected native failures across 79 verified jobs. Ledger
evidence is separate: 19 full fixture definitions, 2 additional output checks, standalone,
and 32 expected failures across 54 verified jobs. See the contracts for exact row counts,
resume behavior, and preserved earlier failures. Model-response evaluation status is maintained in [references/eval.md](references/eval.md).

# Multi-touch SQL implementation guide

Version `0.1.0`. This package implements a native BigQuery credit ledger and a downstream exact
monetary allocation/reporting boundary. Read the [skill](../SKILL.md),
[shared contract](channel-contract.md), [ledger contract](ledger-contract.md), and
[metrics contract](metrics-contract.md). All commands below run from the skill directory.

## Inputs and declarations

Keep complete `source_system`, `source_scope`, and native record keys on every row. Touches
also carry their visitor key, timestamp, canonical channel, and taxonomy version `0.1.0`.
Conversions carry timestamp and native NUMERIC value/currency/status. Supply the explicit
subject triple only when a documented source-native subject or matched identity bridge supports
it. Do not join native user IDs, bare identifiers, visitor keys, IP addresses, or channel labels
across sources. Channel labels and source membership are not person identity evidence.

The ledger invocation declares its key, named timezone, inclusive conversion-date start/end,
as-of timestamp, requested/minimum/maximum lookback days, positive fractional-day half-life,
and one conversion-window mode. Requested lookback is clamped to the declared bounds. Supply
all nonfuture history needed to establish previous and first-observed conversions before
report filtering.

| Window mode | Eligibility and coverage |
| --- | --- |
| full_lookback | Touches from the inclusive lookback start through the conversion timestamp. |
| segmented | Full lookback plus a strict lower boundary after the previous conversion, including previous conversions outside the report. |
| acquisition | The first observed conversion per supplied subject history can be credited; reported repeats remain acquisition_repeat_excluded. |

The five emitted models are `first_touch`, `last_touch`, `linear`, `position_based`, and
`time_decay`. First/last models keep eligible zero-credit rows. Linear splits one among all
eligible touches. Position-based gives one to one touch, halves to two, or `.4` at each endpoint
with `.2` divided among middle touches. Decay uses fractional days and `half_life_days`,
normalizing from a youngest raw weight of one. It describes a chosen allocation rule;
MTA weights do not establish causality or incremental lift.

## Execute the standalone references

These commands run each file's own nonempty synthetic example independently. They require
an authenticated `bq` CLI, billing-project job permissions, and the intended location.
They create temporary objects only; no caller production tables are referenced.

```sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 < references/sql/credit_ledger.sql
```

```sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 < references/sql/attribution_metrics.sql
```

The standalone metrics example has two selected linear touches, a known conversion value of
100 USD, and one shared spend fact of 25 USD. Each touch receives 50 USD. Channel/day revenue
is 100 USD, cost per attributed conversion is 25 USD, and ROAS is 4. Ordinary-conversion CAC
remains null. The standalone ledger example is its separate one-touch/all-models example;
executing the two files unchanged does not feed one example into the other.

For a real handoff, run the accepted [ledger SQL](sql/credit_ledger.sql) with declared synthetic
or caller-authorized inputs, retrieve its actual `result_json` ledger and coverage arrays,
and project those actual records into the metrics inputs. Preserve exact decimal money when
transporting JSON. A producer job's temporary tables are not available as tables in a later
job. Never replace producer outputs with expected fixture rows.

Use separate bounded jobs for the producer and consumer. The combined script exceeded the
fixed 1 GiB per-job cap because of minimum billing across many temporary-table statements.
Do not concatenate both scripts or increase the cap to run this reference verification.

## Exact producer projections

`ledger_input` consumes the following actual ledger fields; the named types are required:

| Fields | Type |
| --- | --- |
| source_system, source_scope, conversion_key | STRING |
| touch_source_system, touch_source_scope, touch_key | STRING |
| conversion_at, touch_at | TIMESTAMP |
| conversion_date | DATE |
| channel, taxonomy_version, model | STRING |
| credit | FLOAT64 |
| value | NUMERIC |
| currency, value_status, conversion_window_mode, report_timezone | STRING |
| report_start_date, report_end_date | DATE |
| as_of | TIMESTAMP |

`coverage_input` consumes these actual coverage fields:

| Fields | Type |
| --- | --- |
| source_system, source_scope, conversion_key, model | STRING |
| conversion_at | TIMESTAMP |
| conversion_date | DATE |
| value | NUMERIC |
| currency, value_status, conversion_window_mode | STRING |
| eligible_touch_count | INT64 |
| total_credit | FLOAT64 |
| status | STRING |

The accepted integration runner selects exactly these fields from actual native producer
results and renders native typed input tables for the separate metrics job. Its evidence links
producer job/query/output hashes to downstream projection/input/query/job hashes.

Coverage has no timezone or as-of metadata. The metrics configuration is its explicit report
boundary: selected-member conversion dates must match the configured timezone, range, as-of,
and mode. Selected ledger timezone/start/end/as-of/mode metadata must match exactly. Every raw
row is structurally validated, including other models and excluded source populations;
selected member rows from another boundary fail. Excluded populations cannot have their
coverage timezone inferred from missing metadata.

## Configure metrics and spend

Declare exactly one metrics invocation with `invocation_key`, opaque caller-owned `report_scope`,
`report_timezone`, `report_start_date`, `report_end_date`, `as_of`, `selected_model`,
`conversion_window_mode`, `spend_complete`, `outcome_kind`, and
`acquisition_history_complete`. Select exactly one of the five ledger models. Keep the same
conversion-date timezone, dates, as-of, and mode as its producer.

Provide explicit nonempty membership tables:

- `conversion_scope_input(source_system STRING, source_scope STRING)`
- `spend_scope_input(source_system STRING, source_scope STRING, currency STRING)`

Spend membership currency is nullable or uppercase three-letter. Exact duplicates collapse;
conflicting currencies under one membership fail. The declared population allocates sources to
this report and proves no person/account equivalence. Do not merge GA4 and pixel populations
without an explicit supported bridge.

`spend_input` requires qualified source system/scope/spend key, `event_date DATE`,
`date_timezone STRING`, canonical `channel STRING`, `taxonomy_version STRING`, `spend NUMERIC`,
`currency STRING`, and `spend_status STRING`. Its DATE is already local: `date_timezone` must
exactly equal the configured timezone. Declared membership currencies must agree with actual
nonnull spend currencies. There is no campaign join or touch-date reporting alternative.

Known money requires an amount and currency; unknown requires a null amount and may retain a
valid currency; mixed_currency requires null amount and currency. Preserve known zero and
signed refunds. Unknown and mixed states are never coerced to zero.

## Read the report

Original conversion `value` repeats as provenance. Never sum it as revenue. Use
`allocation_ledger.allocated_value`, selected-model original credits, and the already-aggregated
`channel_metrics` output. Cumulative BIGNUMERIC monetary endpoints in `1e-9` units conserve each
known original amount exactly, including one-unit values, refunds, and maximum NUMERIC input.
Very small valid FLOAT64 credits remain provenance even if their monetary weight quantizes to
zero. Aggregate money in BIGNUMERIC; result JSON emits money and ratios as decimal strings.

Revenue and spend are aggregated separately before the channel/day full outer join. Do not
multiply spend by joining it to each touch or conversion. Retain matched, credited-only and
spend-only metric rows. Spend-only revenue stays unknown with no inferred currency. Keep
`unresolved_subject`, `no_eligible_touches`, and `acquisition_repeat_excluded` separately in
uncredited coverage. Do not fabricate a Direct touch or silently discard these outcomes.

Partial spend retains its observed amount/status/currency but has unknown final spend. Complete
absent spend becomes known zero only when all declared spend memberships have one consistent
known currency. Otherwise preserve the explicit unknown or mixed reason. Zero-credit unknown
rows cannot poison positive-credit known revenue; zero-credit-only groups retain diagnostics.

Cost per attributed conversion uses known nonnegative final spend and positive original credit.
CAC equals it only when `outcome_kind='new_customers'`, `conversion_window_mode='acquisition'`,
and `acquisition_history_complete=true`. Other new-customer configurations fail. Ordinary
conversion CAC is null with `not_new_customer_population`. Supplied history and channel names
cannot establish lifetime acquisition by themselves.

ROAS requires known allocated revenue and known positive same-currency spend. Refund revenue
can produce negative ROAS. Retain reasons for unknown/mixed money, incomplete spend, missing
attribution, zero/negative denominators, currency mismatches, and numeric overflow or underflow.
BIGNUMERIC ratios that cannot represent a nonzero result return null with `numeric_failure`.

Review duplicate collapse, source exclusions, out-of-report spend, selected/credited/uncredited
conversion counts, total credit, and explicit acquisition-history attestation in diagnostics.
Per-conversion credit tolerance is `1e-12`; aggregate tolerance is
`max(1, credited qualified conversion count) * 1e-12`. Exact monetary conservation is not a
floating tolerance check.

## Verification commands and evidence

The runners use Node.js built-ins and invoke the authenticated BigQuery CLI for live jobs.
Native evidence used Node.js `20.18.1` and BigQuery CLI `2.1.19`. No npm dependencies or model
calls are required. Offline fixture checks require Node.js only. **NO SQL EXECUTED**: these commands validate
fixture definitions; they do not execute attribution:

```sh
node scripts/test-credit-ledger.mjs
node scripts/test-attribution-metrics.mjs
```

Complete native suites:

```sh
node scripts/test-credit-ledger.mjs --live --project YOUR_BILLING_PROJECT --location US
node scripts/test-attribution-metrics.mjs --live --project YOUR_BILLING_PROJECT --location US
```

Three linked producer-to-consumer checks only:

```sh
node scripts/test-attribution-metrics.mjs --live --project YOUR_BILLING_PROJECT --location US --cases integration-1,integration-2,integration-uncredited
```

The CLI also supports `--report OUTPUT_JSON` and `--resume-report PRIOR_JSON`. Resume uses
read-only retrieval of completed, byte-identical successful queries and rechecks current
expected outputs. Changed fixture definitions require both `--recheck-goldens` and
`--fixture-change-note 'Explain the independently verified fixture change'`. A changed query
hash requires a new bounded job. `--cases` marks the report `selected_cases_only`; it never
claims a full suite passed. Reports default to timestamped private Downloads files.

The accepted metrics suite verified 37 full-output fixtures, 3 actual producer-to-consumer
integrations, standalone/permutation checks, 35 invalid-input fixtures, and 2 native defect
mutations. It has 79 verified DONE jobs: 42 successful-output jobs and 37 expected-failure
jobs. Metrics fixtures contain 79 allocations, 42 channel/day rows, 3 uncredited rows, and
37 diagnostics rows. Producer goldens contain 50 ledger rows, 20 coverage rows, and 3
diagnostics rows. Final SQL, fixture and runner hashes matched the native evidence. All jobs
used Standard SQL, disabled cache, and the 1 GiB cap; the largest verified billed amount was
817,889,280 bytes. Earlier failures, including the combined-job cap failures, remain preserved.

Ledger verification is separate: 19 full fixture definitions, 2 additional output checks,
standalone, and 32 expected native failures across 54 verified jobs. Its evidence establishes
credit eligibility, model weights and coverage; metrics evidence establishes the downstream
allocation/report boundary. These are bounded synthetic correctness checks, not production
scale, deployment, identity-proof, or causal-effect claims. Model-response evaluation status is maintained in [the evaluation record](eval.md).

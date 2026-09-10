# Multi-touch credit ledger contract

Version `0.1.0`. The native BigQuery Standard SQL script consumes exactly one invocation, classified touches, and qualified conversions. It emits five model rows per eligible touch and one coverage row per report conversion **per model**, including zero-touch conversions.

## Invocation and raw input validation

The required invocation fields are `invocation_key`, an IANA `report_timezone` (including `UTC`), inclusive local `report_start_date`/`report_end_date`, `as_of`, positive `INT64` requested/minimum/maximum lookback days with `max >= min`, finite positive `FLOAT64 half_life_days`, and `conversion_window_mode` (`full_lookback`, `segmented`, or `acquisition`). BigQuery validates the named timezone. Numeric offsets are not accepted. Requested lookback is clamped to the configured minimum/maximum; requested and effective values and the clamping flag remain visible. A valid lookback extending before BigQuery's minimum timestamp saturates the representable lower boundary at `0001-01-01T00:00:00Z`.

Touches require exact, nonempty, already-trimmed `source_system`, `source_scope`, `touch_key`, and `visitor_key`, plus `occurred_at`, a canonical channel, and `taxonomy_version='0.1.0'`. The 11 channels are Paid Search, Paid Social, Paid Other, Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate, and Other. Conversions require exact qualified source/native keys and `occurred_at`; they do not require channel or taxonomy fields. Both record kinds may supply the all-or-none, nonempty, already-trimmed subject triple `subject_source_system`, `subject_source_scope`, `subject_key`. Every input's `invocation_key` must match the configuration.

The shared monetary fields are `value` (`NUMERIC`), `currency`, and `value_status`. `known` requires an amount and uppercase three-letter currency; `unknown` requires a null amount and permits a null or valid source currency; `mixed_currency` requires both amount and currency to be null. Known zero remains known zero. There is no FX or allocated revenue in this ledger.

All raw inputs are validated, including future and out-of-report rows. Exact duplicate qualified keys with identical payload collapse; conflicting payloads fail. Native keys preserve case and `+`. No second touch deduplication, IP matching, visitor-based join, bare-key join, or implicit identity bridge is performed. The explicit subject triple must match exactly. Cross-source business duplicates must be resolved upstream with evidence.

## Conversion windows and credit

All supplied nonfuture conversion history is sequenced **before** report filtering, by timestamp then full qualified conversion key. Subject partitions use tagged JSON of fixed-field structs. Each missing-subject conversion has its own distinct qualified-conversion partition, which cannot collide with a real subject.

`full_lookback` includes touches from anchor minus effective lookback through the conversion timestamp, inclusive. `segmented` also requires `touch_at > previous_conversion_at`, even when the previous conversion is outside the report. Simultaneous conversions use the qualified-key order: the first may receive an anchor-time touch; the second segmented conversion has an empty window. `acquisition` credits only the first observed conversion per subject. Callers must supply all history needed for these boundaries; first observed is limited to supplied history and is not a lifetime claim. Report dates after `as_of` are valid but contain no future conversions.

The five fixed models are:

- `first_touch` and `last_touch`: the earliest or latest touch gets one; other eligible touches retain zero-credit rows.
- `linear`: each of `n` touches gets `1/n`.
- `position_based`: one touch gets one; two get `.5/.5`; three or more give `.4` to each endpoint and split `.2` among the middle touches.
- `time_decay`: fractional days use timestamp microseconds. Compute relative age directly as the microsecond difference from the youngest eligible touch before computing `2^(-relative_age / half_life_days)` and normalize over the qualified conversion before expanding models. Direct timestamp differences avoid subtracting large floating ages and losing microsecond distinctions in old windows. The youngest raw weight is one; overflow of division for an extremely small positive half-life produces zero for sufficiently old touches. All weights cannot underflow to zero.

Touches are ordered by timestamp then qualified touch key. Native assertions require each credit to be nonnull, finite, and nonnegative, and each eligible conversion/model to sum to one within `1e-12`. No touch is invented for a zero-touch conversion.

## Output and provenance

Each ledger row retains qualified conversion, touch, visitor and subject identities; touch channel/version; UTC timestamps and local dates; report timezone/dates/as-of; window mode, lookback/start/end and start exclusivity; previous conversion timestamp; requested/min/max/effective lookback and clamping; half-life; model; credit; and original conversion `value`, `currency`, and `value_status`.

**Original conversion money is repeated provenance. Do not sum the repeated `value` column as revenue.** For conversion totals, select one model and sum its credits. Monetary allocation and metrics are separate downstream work.

Coverage has one row per report conversion/model with its qualified subject/conversion, original money, eligible qualified-touch count, total credit, and `credited`, `unresolved_subject`, `no_eligible_touches`, or `acquisition_repeat_excluded` status. A qualified touch is counted once even if another source or scope uses the same native key. Diagnostics retain input/deduplicated counts, future rows, outside-report conversions, unresolved touches and lookback clamping. Arrays have deterministic qualified-key ordering.

## Verification and evidence boundaries

The runner is `scripts/test-credit-ledger.mjs`. Without `--live`, it only checks stored fixture definitions and explicitly reports **NO SQL executed**. Native execution requires `--live --project YOUR_BILLING_PROJECT`, with optional `--location`, `--report`, and `--resume-report`. `--cases ID1,ID2` selects bounded fixture checks; its report is labeled `selected_cases_only` and does not claim the full suite passed.

Resume uses read-only `bq head --job` for completed byte-identical successful queries. A changed generated query hash always requires a new native job. Changed fixture definitions require explicit `--recheck-goldens --fixture-change-note 'Describe the correction or expansion'`; every reused successful result is compared again against all current expected fields, with the prior/current fixture hashes, expected-output hash and comparison result recorded. Raw prior reports remain intact. All native jobs use Standard SQL, disable query caching, and cap billed bytes at 1 GiB per job. These are synthetic correctness checks, not scale measurements.

The 19 successful fixture definitions contain complete literal expected ledger, coverage and diagnostics outputs. Every field is compared; only `credit` and `total_credit` use a `1e-12` tolerance. Expected eligibility, dates, window bounds, weights and statuses are authored independently, without a substitute JavaScript attribution engine. The three accepted core fixtures remain unchanged:

- One touch: five ledger rows, all weights one.
- Two touches separated by half a day with a half-day half-life: ten ledger rows, decay `1/3, 2/3`, and position `.5, .5`.
- Four touches with reused native keys across source/scope boundaries: twenty ledger rows, linear `.25` each, position `.4, .1, .1, .4`, and decay `1/15, 2/15, 4/15, 8/15`.

Each core fixture has five coverage rows and one diagnostics row. The standalone SQL uses the same nonempty one-touch example. Sixteen full-output fixtures replace the original count-only draft placeholders:

1. Inclusive full-window endpoints and excluded adjacent microseconds.
2. Segmented previous conversion outside the report, with exclusive previous boundary.
3. Simultaneous conversions ordered by full qualified key.
4. Acquisition first observed outside the report, excluding the reported repeat.
5. Separate missing-subject conversions and a real subject resembling the old null sentinel.
6. Exact subject source/scope matching and same native conversion keys in different sources/scopes.
7. Identical input duplicate collapse while native cross-source business duplicates survive.
8. Segmented previous conversion older than lookback, retaining an inclusive lookback start.
9. Minimum lookback clamp with an actual endpoint touch.
10. Maximum lookback clamp with an actual endpoint touch.
11. Future touch/conversion exclusion and nonfuture outside-report diagnostics.
12. Known zero, unknown with retained USD, mixed money, and an exact wide decimal NUMERIC string in both output tables.
13. No eligible lookback touch and unresolved touch coverage without invented Direct rows.
14. America/Los_Angeles local-date report boundaries.
15. Ancient touches separated by one microsecond, with a one-microsecond half-life and unequal decay weights despite a distant conversion anchor.
16. Subnormal positive half-life preserving youngest weight one and older weight zero without division overflow or all-zero normalization.

Two additional full-output execution checks reverse duplicate-fixture input order and use the named GMT timezone alias with the one-touch golden. They are counted separately from the 19 fixture definitions.

Twenty-four structural fixture failures exercise conflicting qualified touch/conversion payloads; invalid/null channel and version; partial, blank and untrimmed subject identities; invalid monetary states; invalid timezone; zero, negative, fractional and non-INT64 lookback; NaN/infinite half-life; and invalid future or unused rows. Eight production assertion checks cover missing/duplicate configuration, zero half-life, actual ledger credit-conservation mutation, and null/negative/NaN/infinite credit mutations. The four bounded credit-value checks run the exact assertion block extracted from the production SQL against a synthetic ledger followed by an actual UPDATE; its hash is retained. The conservation mutation runs through the full production script.

<!-- execution-status:start -->
Authenticated native BigQuery verification completed on 2026-09-09 UTC. All 19 full fixtures passed (165 ledger / 150 coverage / 19 diagnostics rows), as did the two additional full-output checks (25 / 15 / 2), the standalone example (5 / 5 / 1), and all 32 expected native failures. The ancient microsecond case retained 1/3 and 2/3 decay; the subnormal half-life produced 0 and 1 without overflow. Every one of the 54 distinct verification job handles was `DONE`, with Standard SQL and the 1 GiB billed-bytes cap confirmed. The unchanged accepted core SQL jobs were reused, with full-output comparisons through read-only job retrieval. No production SQL change was required by this expansion. One duplicate-fixture expected provenance correction was explicitly documented and rechecked against the completed unchanged query. Private Downloads evidence retains all handles, raw results/errors, per-job query hashes, fixture/runner hashes, runtime versions, measured bytes, comparison rechecks, and earlier reports.
<!-- execution-status:end -->

The earlier empty-ledger standalone evidence remains preserved privately and provides no model-weight execution evidence. Original failed and intermediate runs remain in private Downloads reports with their exact SQL hashes. There are no unexecuted count-only fixture placeholders in the current fixture definitions. Coverage here concerns the credit ledger and its validation; it makes no implementation or verification claim about MTA metrics, monetary allocation, or causal lift.

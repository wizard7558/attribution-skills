# Native attribution money and channel/day metrics

Version `0.1.0`. Run `sql/attribution_metrics.sql` as BigQuery Standard SQL. Its standalone example is a nonempty synthetic two-touch conversion and one shared spend fact; all objects are temporary. This layer consumes actual [credit-ledger](ledger-contract.md) projections. Original conversion `value` is repeated provenance and is never summed as revenue. The report selects exactly one of the five upstream models.

## Configuration and source membership

`configuration_input` contains exactly one row:

| Field | Native type | Meaning |
| --- | --- | --- |
| invocation_key, report_scope | STRING | Exact nonempty caller identifiers; report_scope is one opaque population label. |
| report_timezone | STRING | Named IANA timezone, including UTC; BigQuery validates it. Numeric offsets are rejected. |
| report_start_date, report_end_date | DATE | Inclusive conversion-date reporting interval. |
| as_of | TIMESTAMP | Explicit upstream observation cutoff. |
| selected_model | STRING | first_touch, last_touch, linear, position_based, or time_decay. |
| conversion_window_mode | STRING | full_lookback, segmented, or acquisition. |
| spend_complete | BOOL | Attestation that all report spend was supplied. |
| outcome_kind | STRING | conversions or new_customers. |
| acquisition_history_complete | BOOL | Caller attestation about supplied acquisition history. |

`new_customers` requires `acquisition` and true `acquisition_history_complete`; other combinations fail. The attestation is explicit provenance, not a lifetime inference from whichever history happens to be supplied. Ordinary conversions produce cost per attributed conversion; CAC is null with `not_new_customer_population`.

`conversion_scope_input(source_system STRING, source_scope STRING)` and `spend_scope_input(source_system STRING, source_scope STRING, currency STRING)` are nonempty explicit source-membership sets. Spend membership currency is nullable or uppercase three-letter. Identical duplicates collapse; conflicting currency declarations under one qualified membership fail. Source membership allocates sources to this caller-owned report. It does not prove person/account identity, that two pixels observe the same population, or that spend and conversion sources represent the same people. There is no visitor, campaign, bare-key, IP, or subject join at this layer.

## Exact consumed projections

Supply only the following fields with these native types. The integration runner executes the accepted SQL in a bounded native producer job, retrieves its actual `ledger` and `coverage` result arrays, and projects these fields into a separate bounded native metrics job. Evidence links producer job/query/output hashes to consumer input/query/job hashes. It does not replace actual upstream outputs with expected JSON. Separate jobs keep each script within its 1 GiB cap despite BigQuery minimum billing on temporary-table statements.

| Input | Fields and types |
| --- | --- |
| ledger_input | source_system, source_scope, conversion_key, touch_source_system, touch_source_scope, touch_key STRING; conversion_at TIMESTAMP; conversion_date DATE; touch_at TIMESTAMP; channel, taxonomy_version, model STRING; credit FLOAT64; value NUMERIC; currency, value_status, conversion_window_mode, report_timezone STRING; report_start_date, report_end_date DATE; as_of TIMESTAMP |
| coverage_input | source_system, source_scope, conversion_key, model STRING; conversion_at TIMESTAMP; conversion_date DATE; value NUMERIC; currency, value_status, conversion_window_mode STRING; eligible_touch_count INT64; total_credit FLOAT64; status STRING |
| spend_input | source_system, source_scope, spend_key STRING; event_date DATE; date_timezone, channel, taxonomy_version STRING; spend NUMERIC; currency, spend_status STRING |

Money follows the shared known/unknown/mixed_currency contract: known requires amount and currency, unknown requires null amount and optionally retains a valid currency, mixed_currency requires null amount and currency. Known zero and signed refunds are preserved. Channels use the fixed 11-channel vocabulary and taxonomy version `0.1.0`.

All raw rows are validated, including other models, excluded source populations, and out-of-window spend. All qualified key components must be nonempty, already trimmed, and free of C0, DEL, and C1 control characters. Every credit must be finite, nonnull, and nonnegative. Exact duplicate rows under the complete qualified conversion/model/touch or spend key collapse; changed consumed payload under that key fails. Different qualified keys remain separate even if their native key text matches.

Selected member ledger metadata must exactly match the configured timezone, dates, as-of, and mode. Each selected coverage row's conversion date is recomputed in the configured timezone and must be in range and at/before as-of. Native coverage has no timezone or as-of fields, so the explicit configuration is its boundary. Selected member rows from another boundary fail. Nonmember records are excluded with diagnostics. Raw coverage has no timezone metadata: its date consistency is checked against configuration only for selected members; excluded source populations may carry other reporting dates. All raw coverage still undergoes identity, money, model/mode, timestamp presence, count, credit and status validation. Spend's already-local DATE cannot be reinterpreted; every raw `date_timezone` must equal the configured timezone. Member out-of-window spend is excluded with diagnostics. Actual spend currencies must agree with any nonnull membership declaration.

Every selected ledger conversion must match exactly one selected coverage row, with identical timestamp, date, original money and mode. Credited coverage requires actual qualified-touch count equality, ledger/coverage credit-sum equality, and sum one within `1e-12`. Noncredited coverage requires no ledger rows, zero count and zero credit. Unresolved, no-eligible-touch, and acquisition-repeat statuses remain separate; no Direct touch is invented.

## Exact monetary allocation

For each selected qualified conversion, retain original FLOAT64 credit. Cast it to BIGNUMERIC, failing on null casts. BIGNUMERIC quantization can round very small valid positive credits to zero monetary weight; their original FLOAT64 credit remains positive provenance and contributes to the attribution denominator. Monetary allocation can be zero at the defined amount resolution. Sum BIGNUMERIC credits and normalize cumulative weights by this sum. Order touches by `touch_at`, then the full qualified touch key using BigQuery's default string ordering. No input-row order participates.

Represent the absolute NUMERIC amount as integer units of `1e-9`. Multiply it by each cumulative normalized weight and round to an integer endpoint. The last endpoint is exactly the original absolute unit amount. A row's allocation is the signed difference from the previous endpoint divided by `1e9`, safely cast to NUMERIC. BIGNUMERIC intermediates and native assertions reject unrepresentable values instead of coercing them to zero. This cumulative rounding telescopes exactly, including one-unit values, signed refunds, zero-credit rows, and the maximum 29-integer/9-fraction NUMERIC input. Native assertions require sign consistency and exact BIGNUMERIC sum of allocated values equal to each original known conversion amount.

Unknown and mixed amounts have null allocations on every touch. A zero-credit unknown row remains visible but cannot poison a channel's positive-credit known revenue. Monetary aggregation uses allocated amounts and BIGNUMERIC sums, avoiding NUMERIC group-sum overflow. The FLOAT64 sum of original credits remains the attributed-conversion denominator and is never replaced with touch count.

## Reporting and ratio semantics

The grain is conversion date + canonical channel + taxonomy version, with fixed report/model/mode/population provenance. Revenue and spend are aggregated independently before a full outer join. Currency is not a join key. One spend fact cannot be multiplied by touches, conversions, or models. Output retains matched, credited-only, and spend-only groups. Zero-credit-only groups remain visible with counts; they do not count as attributed conversions.

Mixed contributing currencies or explicit mixed states yield mixed_currency with null amount and currency. Unknown positive-credit revenue yields unknown amount; currency is retained only if the contributing source currencies are uniquely consistent. Known zero stays zero. Zero-credit-only groups can retain known zero and a currency only when their observed money states consistently establish that currency; otherwise they remain unknown with no inferred currency.

`observed_spend` retains the supplied fact aggregation and its status/currency. If spend is partial, `final_spend` is unknown with `incomplete_spend`. With complete spend and no matching fact, zero is known only when all declared spend memberships have the same known currency; otherwise the result explains `absent_unknown` or `absent_mixed_currency`. Completeness does not infer missing dates/channels beyond groups observed in revenue or spend.

All ratios use BIGNUMERIC `SAFE_DIVIDE`; output money and ratios are decimal STRINGs inside result JSON to prevent consumer FLOAT64 rounding. Null, overflowing, or nonzero-numerator underflow-to-zero ratios yield null with `numeric_failure`. True known zero numerator remains zero. Cost per attributed conversion requires known nonnegative final spend and positive original credit. CAC equals that result only for the explicitly attested new-customer population. ROAS requires known allocated revenue, known positive final spend, and equal known currencies; refunds can produce negative ROAS. Negative or zero denominator, unknown/mixed money, currency mismatch, missing attribution, and incomplete spend have explicit reason strings.

## Output

The one-row result contains `invocation_key` and `result_json`:

- `allocation_ledger`: every consumed selected ledger field, original money as decimal string, allocated_value (decimal string), allocated_currency, allocation_status, invocation_key, report_scope, outcome_kind and acquisition_history_complete. Deterministic qualified-conversion/touch ordering.
- `channel_metrics`: event_date/channel/taxonomy_version and full configuration; credited_conversion_count FLOAT64; qualified_conversion_count, qualified_touch_count, zero_credit_row_count and spend_fact_count INT64; row_kind; revenue_status/currency/reason and allocated_revenue; observed_spend/status/currency; spend_status/currency/reason and final_spend; cost_per_attributed_conversion/cost_reason, cac/cac_reason, roas/roas_reason. Amounts/ratios are nullable decimal strings; reason and status fields are nullable strings as applicable. Counts distinguish qualified records from fractional credit. Revenue reason is the explicit revenue_status when unknown/mixed, or no_attributed_revenue_currency for spend-only groups. Spend-only revenue remains unknown with null amount/currency; spend currency cannot establish a revenue currency.
- `uncredited_coverage`: complete consumed selected noncredited coverage rows, original money as decimal string; each original status is preserved.
- `diagnostics`: full configuration; ledger/coverage/spend and membership duplicate-collapse counts; nonmember ledger/coverage/spend rows; outside-report member spend rows; selected/credited/uncredited qualified conversion counts; original total_credit. Native assertions conserve selected attributed conversion count and the joined report's unique grain. Per-conversion credit tolerance is 1e-12; aggregate credit tolerance is max(1, credited qualified conversion count) times 1e-12, allowing accepted per-conversion error to accumulate. Original sums remain FLOAT64 data and are never forced to integer counts.

## Verification procedure

Run `node scripts/test-attribution-metrics.mjs` for fixture-definition checks only: it prints **NO SQL EXECUTED**. Actual execution requires `--live --project YOUR_BILLING_PROJECT` and optional `--location`. Native jobs disable query caching, use Standard SQL, and cap billed bytes at 1 GiB per job. Synthetic temp tables are not production writes and these tests are not scale measurements.

The runner compares every full literal expected-output field, permitting only `1e-12` tolerance for original FLOAT64 credit counts. It saves timestamped private Downloads evidence with source/fixture/runner/upstream hashes, query hashes, job handles, raw results/errors, job metadata, byte measurements and runtime versions. Public files deliberately contain no private project IDs or evidence paths. `--cases` explicitly marks partial execution. `--resume-report` reuses only successful byte-identical queries via read-only job retrieval and rechecks outputs. Changed goldens require `--recheck-goldens --fixture-change-note 'Explain the independently verified correction'`; prior reports remain preserved.

Native tests include exact allocation conservation and deliberate production-SQL mutations that inflate money and joined rows. Integration jobs execute the accepted upstream SQL, then consume its actual projections. Fixtures and native evidence distinguish a working synthetic correctness check from a production data deployment or causal claim.

<!-- execution-status:start -->
Authenticated native BigQuery verification completed on 2026-09-09 UTC. All 37 full-output metrics fixtures passed: 79 allocation rows, 42 channel/day metric rows, 3 uncredited coverage rows, and 37 diagnostics rows. The standalone example and input-permutation check also passed complete output comparisons. Three linked integrations compared actual producer outputs (50 ledger rows, 20 coverage rows, 3 diagnostics rows) and their downstream metrics, including a preserved uncredited conversion. All 35 invalid-input fixtures and both deliberate production-SQL mutations failed at their expected native guards.

The final suite verified 79 distinct native jobs: 42 successful-output jobs and 37 expected-failure jobs. Every handle was DONE; Standard SQL, disabled query caching, and the 1 GiB per-job cap were verified. The largest verified billed amount was 817,889,280 bytes. Unchanged earlier successful queries were retrieved read-only and compared again; final SQL, fixture and runner hashes matched the executed evidence. Two superseded combined integration jobs exhausted the fixed per-job cap and remain preserved with their errors; splitting producer and consumer into linked bounded jobs resolved that execution boundary without increasing the cap. Earlier native syntax failures also remain preserved in private evidence. The final suite has no unmet test or integration check. This is synthetic correctness evidence, not production deployment, population-identity proof, scale benchmarking, or causal lift evidence.
<!-- execution-status:end -->

# Native spend conservation and funnel additivity

These temporary-object BigQuery Standard SQL checks compare explicitly scoped source evidence with observed cost reporting. They preserve unresolved evidence as **unknown** and proven defects as **fail**. They never mutate permanent tables, run JavaScript UDFs, infer identity bridges or claim causal attribution.

## Typed inputs and configuration

Each standalone SQL has a marked BEGIN REPLACEABLE INPUTS block with nonempty typed synthetic tables. Replace it with typed source/report projections. Production requires exactly one configuration_input row. Only the test runner batches independent synthetic invocation namespaces; every row must reference an explicit configuration.

Configuration fields are invocation_key, report_scope, crm_source_system, crm_source_scope, report_timezone, inclusive DATE report_start/report_end, date_mode (cohort|activity), selected stage_key, BOOL source_complete/report_complete, and opaque source_evidence_ref/report_evidence_ref. Spend additionally requires NUMERIC abs_tolerance >= 0 and relative_tolerance in [0,1]. There are no hidden tolerances.

Keys are exact nonempty strings without surrounding whitespace or C0/C1 controls; case and plus remain unchanged. Named IANA zones, including valid aliases, are verified with safe native formatting of a fixed timestamp. Input types are checked with TYPEOF(ANY_VALUE(column)), including empty tables. DATE inputs are already typed calendar dates; raw textual parsing belongs to the caller's ingestion projection. Assertions use fixed data-free messages. Invalid replacement SQL itself is a BigQuery compilation/ingestion error, not a finding.

Every report row carries the full cost-report grain: nullable DATE report_date; STRING stage_key; INT64 stage_order; STRING stage_kind, channel, channel_status, network_id, campaign_key, ad_source_system, ad_source_scope, bucket, crm_source_system, crm_source_scope, date_mode, report_timezone and taxonomy_version. Optional identities are null or exact keys; ad source system/scope are paired. Stage kinds are lead|qualified|converted|won|event and order gaps are valid. Conflicting order/kind for the same stage key asserts. Canonical channel/version is the eleven-channel taxonomy 0.1.0; missing_attribution channel status requires Other. All five buckets are included: matched, ambiguous, unmatched, unattributed, spend_only.

Every raw report row must match invocation CRM scope, timezone and date mode. Selected nonnull dates must be in range. Other stages validate but are excluded before sums. Duplicate selected report grains are **findings**: repeated rows remain in aggregates, and duplicate-grain counts are visible per date and in diagnostics. Original report evidence references identify the rows for inspection.

## Spend conservation

Source input projects actual spend_evidence: source_system, source_scope, spend_key, DATE event_date, NUMERIC spend, currency, spend_status and BOOL included. Append invocation_key for configuration lookup. Nonempty membership_input explicitly declares qualified spend source systems/scopes. Exact repeated membership rows collapse; nonmembers are diagnosed, never inferred.

Every source row, including excluded/nonmember rows, validates. For members, included equals date-in-range. Identity is the qualified source system/scope/spend_key: exact repeats collapse, conflicting payloads assert. Only included members contribute once; no bare-key source join occurs.

Report input adds INT64 spend_fact_count, NUMERIC observed_spend, observed_spend_currency and observed_spend_status. Compare observed supplied spend, not the producer's completeness-driven final spend. Known money requires an amount and uppercase three-letter currency; unknown/mixed require null amounts, and mixed requires null currency. Unknown can retain a known currency. Negative known credits are not clamped. Zero-fact report rows require unknown/null observed money and contribute no unknown supplied fact. Undated report rows must have zero spend facts.

Select the configured stage before sums: spend repeats across stages by design. Sum all five buckets. Full outer date comparisons preserve missing sides; complete missing groups are known zero, while incomplete evidence supports observed values but not definitive missing/full-total comparisons.

Compare exact total fact counts per date independently of currency. Preserve separate BIGNUMERIC known amounts and fact counts per currency. For fully known complete dates, require equal currency-specific fact counts and:

~~~text
abs(report_amount - source_amount)
    <= max(abs_tolerance, abs(source_amount) * relative_tolerance)
~~~

Missing complete-side currency groups are zero. If any contributing source/report money is unknown or mixed, **all monetary and currency-specific count comparisons for that date are unknown**: unresolved pieces may belong to any currency. Known subtotals remain visible. A complete-input date-level fact-count mismatch still proves failure. This verifies per-date/currency totals and counts, not one-to-one source lineage.

## Funnel additivity

Source input projects actual stage_evidence: source_system, source_scope, lead_key, stage_key, nullable DATE report_date, BOOL included, nullable BOOL achieved and required BOOL is_attribution_primary, plus invocation_key. Validate every raw identity/primary flag; diagnose out-of-scope rows. For invocation-scope rows, included means null date or in-range date. Exact scoped lead/stage repeats collapse; conflicts assert.

Report input adds four nonnegative INT64 counts: lead_count, stage_count_total, stage_count_primary and stage_unknown_count. It has no money for this check. Select the configured stage and scope; keep nonprimary leads and null dates. Independently count all included rows, achieved=true rows, achieved=true AND primary rows, and achieved=NULL rows. Compare report sums across all buckets, full outer by date only. Do not partition leads by currency or infer achievement from stage order. Complete missing groups are zero; incomplete inputs produce unknown comparisons, except duplicate report grain still proves failure.

## Finding schema, strings and ordering

Each production result is one row with invocation_key and result_json. Parsed finding:

~~~text
check_id: spend_conservation | funnel_additivity
contract_version: "0.1.0"
configuration: complete explicit configuration
status: pass | fail | unknown
reasons: sorted distinct documented codes
evidence_refs: [source_evidence_ref, report_evidence_ref]
details: complete compared dates, sorted with null first
diagnostics: named decimal-string counts
~~~

All amounts, tolerances and counts are decimal strings, including differences and configuration tolerances. Source unknown amounts remain null; details expose known subtotals and observed missing-side zero totals, with explicit comparison status. BIGNUMERIC prevents INT64/NUMERIC sum overflow at ordinary report cardinalities. No FX or floating-point money addition occurs.

Spend details contain report_date, source_fact_count, report_fact_count, signed fact_count_difference (report minus source), source_unknown_fact_count, report_unknown_fact_count, duplicate_grain_count, source_present, report_present, currency_comparisons, status, reasons. Currency rows sort by currency and contain currency, source_known_amount, report_known_amount, source_known_fact_count, report_known_fact_count, signed amount_difference, allowed_difference, signed fact_count_difference, status, reasons. Only-unknown dates may have an empty known-currency array.

Funnel details contain report_date, source_present, report_present, duplicate_grain_count, metrics, status, reasons. Metrics order is lead_count, stage_count_total, stage_count_primary, stage_unknown_count. Each has metric, source_count, report_count, signed difference, status.

Diagnostics are exactly source_raw_rows, source_duplicate_rows_collapsed, source_selected_rows, source_nonmember_rows, source_excluded_rows, report_raw_rows, report_other_stage_rows, report_selected_rows, duplicate_report_grains, compared_dates. Nonmember/out-of-scope and excluded counts can overlap; they are not disjoint additive populations.

| Reason code | Meaning |
| --- | --- |
| source_incomplete / report_incomplete | That side does not declare complete evidence. |
| duplicate_report_grain | A selected report grain repeats; rows stay counted. |
| fact_count_mismatch | Complete spend date-level fact counts differ. |
| currency_fact_count_mismatch | Fully known complete currency fact counts differ. |
| spend_amount_mismatch | Known complete money difference exceeds the explicit tolerance. |
| unknown_money | Contributing supplied money/currency is unresolved. |
| comparison_unresolved | Currency comparison cannot be decided; nested currency reason only. |
| count_mismatch | At least one complete funnel count pair differs. |

Overall precedence is proven fail, unresolved unknown, then pass. Incomplete evidence cannot prove a full-total discrepancy; duplicate grain is independently proven. Complete empty inputs may pass; incomplete empty inputs are unknown. Pass reasons are empty arrays.

## Runner and durable evidence

From the skill root:

~~~sh
node scripts/test-reconciliation.mjs
node scripts/test-reconciliation.mjs --live --project YOUR_BILLING_PROJECT --location US --integration
~~~

Offline validates definitions and prints **NO SQL EXECUTED**. Live runs actual Standard SQL, cache disabled, maximum_bytes_billed=1073741824 per job and at most three concurrent expected-failure jobs. Both standalone examples and independent batched full goldens execute. Structural fixtures must raise the intended actual SQL assertions. Two mutations change actual native SQL and must be rejected by full golden comparison.

Integration executes the current accepted cost SQL's synthetic all-five-buckets example and compares its entire separately accepted producer golden. It feeds projections of actual stage_evidence, spend_evidence and report arrays into both checks, then tests deliberately corrupted actual report projections. Producer input/query/result/source hashes and job identity remain linked in private evidence. There is no parallel JS reconciliation engine.

Use --resume-report PATH to reuse only byte-identical completed queries from a prior report. Successful results are fetched read-only and compared again; changed queries execute afresh. Every run writes a new timestamped Downloads report with source/fixture/query hashes, full results/errors, jobs, versions, bytes and caps. Failures remain preserved. Billing projects and private evidence paths are not embedded in public files.

<!-- execution-status:start -->
Authenticated native BigQuery execution passed on 2026-09-09: 31 full golden findings, 12 structural fixtures, four configuration failures, two standalone examples and two rejected native SQL mutations. Actual current cost output passed full producer-golden verification and both all-five-bucket checks; both deliberately corrupted report checks failed as expected. All submitted jobs confirmed a 1 GiB cap, Standard SQL and disabled cache. Private jobs, hashes, full results, versions and measured bytes remain in Downloads evidence. This is synthetic correctness evidence, not a scale benchmark.
<!-- execution-status:end -->

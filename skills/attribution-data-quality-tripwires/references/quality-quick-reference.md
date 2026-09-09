# Native quality semantics and field reference

This reference defines general computation and ordering. It contains no case solutions. Real executions return complete native findings; the model evaluation requests a scalar projection separately.

## Shared rules

All checks use explicit report_scope, source identity, named timezone, inclusive report_start/report_end, date_mode and evidence references. Input arrays belong to one configuration. Exact qualified keys preserve case and plus signs. Raw rows validate even when excluded. Exact duplicate native source records collapse, conflicting duplicates assert. Invalid input or execution is an error, never a synthetic finding.

Findings have check_id, contract_version, complete configuration, overall status, sorted distinct overall reasons, evidence_refs, details and diagnostics. The status order is fail > unknown > pass. No implicit identity bridge, channel classification, population equivalence, currency conversion, stage monotonicity, default threshold or vendor exemption exists.

All native count/money/rate/tolerance/difference fields serialize as decimal strings with native decimal spelling (no redundant trailing fractional zeros). SQL NULL remains JSON null, Boolean flags remain true/false, and DATE values are ISO dates or null. Do not confuse an absent side with a supplied unknown amount. Observed subtotals remain observations under incomplete evidence. Every check's exception for a provable local defect or value is explicit below.

## Spend conservation — spend_conservation

Inputs: configuration includes CRM source system/scope, stage_key, source_complete/report_complete, abs_tolerance and relative_tolerance. membership declares qualified spend origins. source projects spend_evidence rows with spend_key, event_date, spend/currency/spend_status and included. report projects all native cost grain fields plus spend_fact_count, observed_spend/currency/status.

Select included source members and exactly the configured stage from report before aggregating. All buckets count: matched, ambiguous, unmatched, unattributed, spend_only. Spend repeats across stages by design; report_other_stage_rows counts valid report rows belonging to other stages. Source identity is qualified origin/spend_key. Report grain duplicates are **not** collapsed: inflated rows stay counted, and duplicate_report_grain independently proves failure even when incomplete.

Known money requires amount/currency. Unknown/mixed supplied money has NULL amount; mixed also has NULL currency. A report row with spend_fact_count=0 has unknown/null observed money and contributes no supplied money piece. Undated report rows cannot contain spend facts.

Full-outer date groups preserve either side. source_fact_count counts selected unique native facts; report_fact_count sums reported spend_fact_count. fact_count_difference = report minus source. Complete missing date groups count as zero; source_present/report_present separately indicate observed groups. source_unknown_fact_count and report_unknown_fact_count count contributing unknown/mixed money pieces, with report counts weighted by spend_fact_count.

Complete date-level total fact counts compare independently of currency. Any contributing unknown/mixed amount makes all currency-specific count and monetary decisions on that date unknown. A complete date-level count mismatch still proves fail. Incomplete source/report cannot establish a full-total discrepancy; known observations remain visible.

For fully known complete dates, compare each currency's fact counts and require absolute money difference <= max(abs_tolerance, abs(source amount)*relative_tolerance). Missing complete currency groups have known zero. No FX or currency averaging.

Details sort by report_date, null first. Each has source_fact_count, report_fact_count, fact_count_difference, source_unknown_fact_count, report_unknown_fact_count, duplicate_grain_count, source_present, report_present, currency_comparisons, status and reasons. Currency comparisons sort by currency and expose source_known_amount, report_known_amount, source_known_fact_count, report_known_fact_count, amount_difference (report minus source), allowed_difference, fact_count_difference, status and reasons. Known subtotals remain visible even when comparisons are unresolved.

Overall/date reasons: source_incomplete, report_incomplete, duplicate_report_grain, fact_count_mismatch, currency_fact_count_mismatch, spend_amount_mismatch, unknown_money. Nested unresolved currency comparisons additionally use comparison_unresolved. A pass has no reasons. Complete empty input may pass; incomplete empty input is unknown.

## Funnel additivity — funnel_additivity

Inputs: configuration selects exact CRM scope and one stage, source_complete/report_complete; source projects stage_evidence with qualified lead/stage, nullable report_date, included, nullable achieved and is_attribution_primary. report has native cost grain fields and four nonnegative counts. Empty membership is normal here; configured CRM scope selects source leads.

Keep included source-scope rows, including nonprimary and null-date rows. Select the configured report stage and sum every bucket. Exact qualified lead/stage duplicates collapse; conflicting source truth asserts. Report grain duplicates stay counted and independently fail. Full-outer dates preserve missing complete groups as zero. Do not split lead counts by currency or infer earlier achievement from later stages.

Details sort by report_date, null first. The metrics array order is fixed:

1. lead_count: all selected source rows.
2. stage_count_total: achieved=true.
3. stage_count_primary: achieved=true AND is_attribution_primary=true.
4. stage_unknown_count: achieved IS NULL.

Each metric has metric, source_count, report_count, difference = report minus source, and status. Complete equal pairs pass; complete unequal pairs fail. Incomplete comparisons are unknown. Overall reasons are source_incomplete, report_incomplete, duplicate_report_grain and count_mismatch. Count mismatch means any complete metric differs; other equal metric details can still pass. NULL dates stay NULL.

Both reconciliation checks expose diagnostics source_raw_rows, source_duplicate_rows_collapsed, source_selected_rows, source_nonmember_rows, source_excluded_rows, report_raw_rows, report_other_stage_rows, report_selected_rows, duplicate_report_grains and compared_dates. Nonmember and excluded counts may overlap.

## Rate bounds — unmapped_share and match_rate

configuration declares source_complete, threshold in [0,1] and min_eligible_count >= 1. membership gives exact qualified sources; source rows have record_key, included, eligible and nullable meets_condition. included is an upstream explicit population/window decision. Only included members with eligible=true enter the denominator. NULL condition is unknown, never false.

Let N=eligible count, T=true count, F=false count and U=unknown count. The sole detail has eligible_count=N, true_count=T, false_count=F, unknown_count=U; lower_rate=T/N; upper_rate=(T+U)/N; point_rate=T/N only if U=0. If N=0 all rates are NULL. unknown_conditions_present is U>0.

unmapped_share is a ceiling: true means unmapped. With complete sufficient data, fail if T > threshold*N, pass if T+U <= threshold*N, otherwise unknown. match_rate is a floor: true means matched. Fail if T+U < threshold*N, pass if T >= threshold*N, otherwise unknown. Compare exact cross-products; equality is inclusive. Unknown conditions can still permit a proven decision while point_rate remains NULL.

Incomplete source, zero N, or nonzero N below min_eligible_count makes the result unknown. Displayed rates under incomplete input describe only observed supplied rows, not bounds on the unseen population. Reasons: source_incomplete, no_eligible_records, below_minimum_eligible_count, condition_uncertainty, rate_above_maximum (ceiling failure), rate_below_minimum (floor failure). Proven passes have empty reasons even when unknown_conditions_present=true.

## Primary uniqueness — primary_uniqueness

source rows have qualified record_key, included, nullable exact group_key and is_attribution_primary. Nonnull group_key groups records within source system/scope. Null group_key declares a singleton keyed by record_key with a separate group-type tag; no sentinel collisions.

For a declared group, more than one primary fails even if source_complete=false. No primary fails if complete, otherwise unknown. Exactly one primary passes if complete and is unknown if incomplete. A singleton with primary=true passes locally; false fails even with partial population. Overall incomplete population remains unknown unless a proven local fail wins. Complete empty input passes; incomplete empty input is unknown.

Details sort by source_system, source_scope, group_type (declared or singleton), group_key, singleton_record_key. Each has these identities, member_count, primary_count, qualified member_keys/primary_keys arrays, status and reasons. Key arrays sort by record_key; no primaries means [], not null. Reasons: multiple_primary, missing_primary, singleton_not_primary, source_incomplete. Overall reasons retain source_incomplete even alongside a proven multiple-primary failure. This checks flag uniqueness, not earliest-touch ordering or person identity.

## Source parity — source_parity

configuration declares metric_name, unit=count, abs_tolerance and relative_tolerance. membership gives qualified source, reference_complete/observed_complete and side evidence references. reference/observed arrays contain qualified per-date counts with matching report_scope, timezone, date_mode and metric_name metadata. Duplicates collapse only if identical.

Materialize every configured date for each declared source. Never merge sources. Missing complete-side dates count as zero; missing incomplete-side dates remain NULL. Supplied incomplete counts stay visible. Details sort by source_system/source_scope/event_date and contain reference_complete, observed_complete, reference_present, observed_present, reference_count, observed_count, difference=observed-reference and allowed_difference=max(abs_tolerance,abs(reference_count)*relative_tolerance), status, reasons, evidence_refs.

If either count is NULL, difference/allowed_difference are NULL. If supplied incomplete counts are both known, arithmetic can remain visible but the decision stays unknown. Both complete sides pass within inclusive tolerance and fail outside. Reasons: reference_incomplete, observed_incomplete, count_mismatch. Matching declarations are explicit caller assertions, not inferred UI/warehouse equivalence.

## Schema-name policy — no_pii_columns

membership declares qualified source/table, schema_complete and nullable table_exists. columns gives exact field_path/data_type metadata; observed selected columns require table_exists=true. policy is a nonempty explicit rule set: rule_key, match_kind and pattern. Exact duplicates collapse; conflicts assert.

exact_leaf compares lowercased final dot-separated path segment with lowercase pattern as literal text. path_regex uses native RE2 against LOWER(field_path); the pattern itself is not lowercased. There is no hidden allowlist. Nested paths count.

Any observed matching path fails, even when schema_complete=false. Otherwise absent/unknown table, incomplete schema or no observed columns yields unknown. Present complete nonempty safe schema passes; the number of data rows is irrelevant to this name-policy check.

Details sort by source_system/source_scope/table_key and contain schema_complete, table_exists, observed_column_count and matching_paths, status/reasons. Matching paths are distinct original field_path strings sorted exactly; each has sorted distinct matched_rule_ids. Reasons: forbidden_column_name, table_absent, table_existence_unknown, schema_incomplete, no_observed_columns. Overall retains limitations alongside a proven policy failure. This is name policy, not value scanning or legal PII certification.

## Column population — empty_column_probe

configuration population_mode is explicit report_window or full_table_snapshot. membership declares qualified source/table/column, schema_complete, nullable table_exists/column_exists and scan_complete. observations carry row_count/non_null_count (both known or both NULL), population_mode, observed_start/end. Report-window bounds must match configuration dates. Full-table-snapshot observations have NULL bounds and prove only full table population, not the report window.

Counts satisfy 0 <= non_null_count <= row_count. Complete scans require known counts; absent/unknown columns cannot have counts or complete scans. Known non_null_count>0 passes even for partial scans or incomplete schema. Complete scan with row_count>0 and non_null_count=0 fails. Everything else is unknown: zero observed rows never prove an all-null populated table, and missing fields never become zero. SQL non-NULL zero, false, blank text and non-SQL-null JSON count as values; this is not value-validity proof.

Details sort by source_system/source_scope/table_key/column_key. They contain inventory flags, row_count, non_null_count, observed_start, observed_end, status and reasons. Reasons: column_all_null, table_absent, table_existence_unknown, column_absent, column_existence_unknown, schema_incomplete, scan_incomplete, no_observed_rows, no_population_observation. Reasons retain incomplete evidence even with a proven pass/fail. Unsupported complex targets remain present but unscanned, with separate extractor unsupported_type diagnostics.

## Ad/campaign coverage — deleted_ad_coverage

membership declares explicit pair_key, qualified ad/reference origins, ad_complete/reference_complete, source timezones, nullable history starts, nullable includes_deleted flags, nullable exact status-filter labels, capture modes and comparability_evidence_ref. Campaign keys are comparable only within that pair. Caller attests same metric, key semantics, account population and compatible breakdowns. Capture modes are incremental_snapshot, historical_backfill or unknown.

ads/reference facts have qualified native fact_key, event_date, nullable campaign_key, spend/currency/spend_status; ads also has nullable ad_key. Sum multiple ad/hourly rows before comparing campaign/date/currency. Fact cardinalities need not match across grains. Known negative adjustments are valid. Unknown/mixed money has NULL amount; mixed currency has NULL currency. Exact fact duplicates collapse; conflicts assert; all raw rows validate before excluding nonmembers/out-of-window facts.

Every pair has every configured date. A date is comparable only if both sources are complete, history starts are known and no later than the date, both source timezones equal report_timezone, both explicitly include deleted entities, status-filter labels are known/equal, capture modes are known, and no supplied unassigned campaign or unknown/mixed money exists on that date. Both includes_deleted=false is unknown for this guard. Different known capture modes are a visible nonblocking caveat; history and backfill never excuse a gap.

An unresolved amount/currency or unassigned campaign disables monetary decisions for the entire pair/date. Retain original evidence and known subtotals. On comparable dates full-outer campaign/currency groups preserve either side; absent side amounts become known zero only there. difference=ad_spend-reference_spend; allowed_tolerance=max(abs_tolerance,abs(reference_spend)*relative_tolerance). Pass within inclusive tolerance, fail outside in either direction. Comparable empty dates pass with zero fact counts and explicit empty_complete_date reason, without invented currency.

Details sort by pair_key then event_date. Each contains full pair, comparable, ad_fact_count/reference_fact_count, unresolved and missing-ad-key counts, known currency subtotals, native fact evidence, comparisons, status/reasons. Comparisons sort by campaign_key then currency. ad_known_spend/reference_known_spend are supplied known sums or NULL if none. ad_spend/reference_spend are decision amounts, zero-filled only for a comparable missing side; both and difference/allowed_tolerance are NULL when noncomparable. A known observed subtotal is not silently promoted to a complete comparison amount.

Blocking reasons: ad_incomplete, reference_incomplete, ad_history_unknown, reference_history_unknown, ad_history_not_covered, reference_history_not_covered, ad_timezone_mismatch, reference_timezone_mismatch, deleted_scope_unknown, deleted_scope_mismatch, deleted_scope_excluded, status_filter_unknown, status_filter_mismatch, capture_mode_unknown, unassigned_campaign, unknown_money, mixed_currency_money. Nonblocking reasons: capture_mode_difference, missing_ad_key, empty_complete_date. A comparable exceeded tolerance adds spend_coverage_gap. Overall fail wins over other unknown dates. A gap is coverage evidence, never proof of deletion or grounds for automatic provider exemptions.

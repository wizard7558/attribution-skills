# Cross-grain spend coverage and deleted-ad scope

This native check compares ad-derived spend with an explicitly paired campaign reference. A spend gap is coverage evidence requiring investigation. It does not prove deletion, identify missing ads, allocate spend to them, or excuse a discrepancy based on a provider, capture mode, or historical date cutoff.

## Invocation and explicit pairing

Run `scripts/deleted-ad-coverage.sql` as BigQuery Standard SQL. Its marked replaceable block contains nonempty synthetic typed inputs; all created objects are temporary. Production requires exactly one `configuration_input` row with:

- STRING invocation_key, report_scope, named IANA report_timezone, date_mode (cohort|activity), source_evidence_ref, report_evidence_ref.
- Inclusive DATE report_start and report_end.
- Required NUMERIC abs_tolerance >= 0 and relative_tolerance in [0,1]. No default tolerances.

Every other input contains invocation_key. Exact identity strings must be nonempty, trim-equal, and C0/C1-free. Case and plus signs remain unchanged. Nullable identifiers can be NULL, but cannot be empty strings. Typed input columns validate even on empty tables. Structural failures use fixed assertion messages; database parse/type errors can occur before assertions.

The nonempty `membership_input` defines pairs through these fields:

| Field | Type |
| --- | --- |
| pair_key | Exact STRING, unique per invocation. |
| ad_source_system, ad_source_scope | Exact STRING qualified ad origin. |
| reference_source_system, reference_source_scope | Exact STRING qualified campaign reference origin. |
| ad_complete, reference_complete | Required BOOL. |
| ad_timezone, reference_timezone | Required named IANA STRING. |
| ad_history_start, reference_history_start | Nullable DATE, earliest declared covered date. |
| ad_includes_deleted, reference_includes_deleted | Nullable BOOL. |
| ad_status_filter, reference_status_filter | Nullable exact STRING labels. |
| ad_capture_mode, reference_capture_mode | incremental_snapshot, historical_backfill, or unknown. |
| comparability_evidence_ref | Exact nonempty STRING. |

The caller explicitly attests, through comparability_evidence_ref, that campaign keys have the same semantics, the spend metric and account populations agree, and breakdown/status filters are compatible. These declarations neither discover nor prove those facts. Status-filter strings are opaque labels: equality is an explicit attestation, not vendor-code interpretation.

An origin may participate in several declared pairs. Its facts are compared independently in each requested pair; no implicit bridge or transitive join is created. Do not sum evidence across pairs to estimate unique source spend. Campaign keys compare only inside a declared pair, never globally.

Identical pair rows collapse. Different declarations for the same pair_key assert. NULL history dates or history starts later than the report window are valid but yield unknown coverage, rather than structural errors or invented date floors.

## Native-grain facts and money

Both `ad_input` and `reference_input` contain exact source_system, source_scope, fact_key; non-NULL DATE event_date; nullable exact STRING campaign_key; nullable NUMERIC spend; nullable STRING currency; and STRING spend_status. Ad facts additionally contain nullable exact STRING ad_key.

Fact_key is the source-native row identifier at its actual grain, including hour and breakdown dimensions where relevant. Many ad facts can belong to a campaign/date. The query aggregates them before comparison; it does not compare the number of ads with the number of campaign rows.

| Money status | Required values |
| --- | --- |
| known | Non-NULL spend and uppercase three-letter currency. Negative adjustments and zero are valid. |
| unknown | NULL spend; currency can be NULL or uppercase three-letter. |
| mixed_currency | NULL spend and NULL currency. |

All raw facts validate, including out-of-window and nonmember rows. Exact duplicates by invocation/source system/source scope/fact key collapse; conflicting payloads assert. No last-write winner, display-name match, key decoding, or currency conversion occurs.

Only declared source members inside the inclusive report window contribute. Nonmember and member-out-of-window counts remain in diagnostics. A NULL campaign is retained as unassigned native fact evidence and makes the entire corresponding pair/date monetary comparison unknown. Missing ad_key remains visible but does not discard otherwise comparable campaign spend.

## Pair/date decisions

Every declared pair has an entry for every configured date, even with no facts on either side. A date is comparable only when all of these prerequisites hold:

- Both sources explicitly complete.
- Both history starts known and no later than the date.
- Both source timezones exactly equal the report timezone. Named-zone aliases are validated but not automatically equated.
- Both sources explicitly include deleted entities. Equal false declarations are unknown for this deleted-inclusive guard.
- Both status-filter labels known and equal.
- Neither capture mode is unknown.
- No supplied unassigned campaign, unknown money, or mixed-currency money on that pair/date.

Known incremental_snapshot versus historical_backfill differences are retained as a caveat but do not alone prevent comparison. Explicit completeness, history, filters, and comparability evidence are still required. A history or vendor label never automatically passes a spend gap.

Any unresolved supplied amount/currency or unassigned campaign could belong anywhere on the date, so it makes **all** monetary comparisons on that pair/date unknown. Known subtotals and original evidence remain visible. A discrepancy on another fully comparable date/pair can still prove overall failure.

For comparable dates, full-outer campaign/currency keys retain reference-only campaigns and ad-only excess. An absent side becomes known zero only here; no zero is invented under incomplete history, scope, or money. The signed difference is ad spend minus reference spend. A comparison passes when:

~~~text
ABS(ad_spend - reference_spend)
  <= MAX(abs_tolerance, ABS(reference_spend) * relative_tolerance)
~~~

Equality is inclusive. Aggregation, differences and tolerance arithmetic use BIGNUMERIC after typed NUMERIC inputs, and all amounts serialize as decimal strings. Currencies compare separately; positive and negative source facts sum exactly. Fact counts are evidence, not an equality requirement across grains.

A comparable date with both sides empty passes with zero fact counts, empty evidence/comparison arrays and reason empty_complete_date. It does not invent a currency. An incomplete empty date stays unknown. Overall precedence is fail > unknown > pass.

## Exact output and ordering

The result row contains invocation_key and result_json. The parsed finding contains:

~~~text
check_id: deleted_ad_coverage
contract_version: "0.1.0"
configuration: all explicit configuration fields; tolerance values are decimal strings
status: pass | fail | unknown
reasons: distinct sorted reason codes from every pair/date
evidence_refs: [source_evidence_ref, report_evidence_ref]
details: all pair/date entries, ordered by pair_key then event_date
diagnostics: named decimal-string counts
~~~

Each detail contains the complete `pair` declaration (without invocation_key), event_date, comparable BOOL, status, reasons, and these fields:

- ad_fact_count, reference_fact_count; ad_unassigned_count, reference_unassigned_count; ad_unknown_money_count, reference_unknown_money_count; ad_mixed_currency_count, reference_mixed_currency_count; ad_missing_key_count.
- ad_known_subtotals and reference_known_subtotals: sorted `{currency, spend}` arrays containing only known supplied money, including unassigned campaigns. Their amounts are observations, not certified complete totals.
- ad_evidence and reference_evidence: all selected pair/date native facts, sorted by fact_key. Each has fact_key, campaign_key, spend, currency, spend_status; ad evidence also includes ad_key. The original qualified origin is preserved in `pair`.
- comparisons: sorted by campaign_key, currency. Each contains campaign_key, currency, ad_fact_count, reference_fact_count, ad_known_spend, reference_known_spend, ad_spend, reference_spend, difference, allowed_tolerance and status.

Known-spend fields retain the sum of supplied known amounts or NULL if none are supplied for that group. Decision amounts and difference/tolerance are all NULL for noncomparable dates. Comparison keys come from observed non-NULL campaign/currency keys; facts with unresolved keys remain in native evidence and date counts. Arrays are [] when empty. All numeric and count JSON values are decimal strings; unknowns stay NULL.

Diagnostics per side use prefixes ad_ and reference_: raw_facts, duplicates_collapsed, nonmember_facts, out_of_window_facts, selected_facts. Nonmember counts use distinct facts, irrespective of date; out_of_window counts use distinct declared-member facts. Thus raw = duplicates + nonmember + out_of_window + selected for each side. These are unique native facts before explicit pair reuse. Additional fields are compared_pairs, compared_dates (pair/date entries), and missing_ad_key_count (selected unique native ad facts).

| Exact reason | Decision effect |
| --- | --- |
| ad_incomplete, reference_incomplete | Unknown full-source coverage. |
| ad_history_unknown, reference_history_unknown | Unknown history coverage. |
| ad_history_not_covered, reference_history_not_covered | Date precedes declared history start. |
| ad_timezone_mismatch, reference_timezone_mismatch | Source date projection differs from configured timezone. |
| deleted_scope_unknown | At least one includes-deleted declaration is NULL. |
| deleted_scope_mismatch | Known includes-deleted flags differ. |
| deleted_scope_excluded | At least one side explicitly excludes deleted entities. |
| status_filter_unknown | At least one status-filter label is NULL. |
| status_filter_mismatch | Known status-filter labels differ. |
| capture_mode_unknown | At least one capture mode is unknown. |
| unassigned_campaign | At least one selected fact has NULL campaign_key. |
| unknown_money | At least one selected fact has unknown spend status. |
| mixed_currency_money | At least one selected fact has mixed_currency status. |
| capture_mode_difference | Nonblocking caveat for two different known capture modes. |
| missing_ad_key | Nonblocking evidence limitation; campaign spend is retained. |
| empty_complete_date | Explicit nonblocking evidence of a comparable empty date. |
| spend_coverage_gap | At least one comparable campaign/currency exceeds tolerance, in either direction. |

Reasons sort lexicographically and remain visible even alongside another date's failure. A pass may retain nonblocking caveats. The schema never labels a gap as caused by deletion.

## Provider-specific investigation

Fivetran's March 2024 TikTok Ads changelog says basic reports switched from STATUS_NOT_DELETE to STATUS_ALL, adding deleted entities to their aggregations. Therefore neither TikTok nor Fivetran can be described as universally omitting deleted ads. Verify the particular report, API/connector version, status filter, historical coverage, and sync behavior against current primary documentation. [Fivetran TikTok Ads changelog, March 2024](https://fivetran.com/docs/connectors/applications/tiktok-ads/changelog#march2024), read 2026-09-09.

Retained incremental evidence and a fresh historical backfill can differ in a particular pipeline. That observation requires source-specific evidence; it is not a universal platform rule and does not justify an automatic coverage exemption. This check issues no provider API requests, changes no connector settings, and initiates no resyncs.

## Execution and verification

From the skill root:

~~~sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query \
  --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 \
  < scripts/deleted-ad-coverage.sql
node scripts/test-deleted-ad-coverage.mjs
node scripts/test-deleted-ad-coverage.mjs --live --project YOUR_BILLING_PROJECT --location US --integration
~~~

Replace only the marked typed input block for real declared observations. Choose the location matching your inputs. This reference creates no permanent objects.

Offline validates definitions and explicitly prints NO SQL EXECUTED. Live executes the standalone example and full literal finding goldens, native structural assertions including empty wrong types, and semantic mutants dropping campaign-only rows or automatically exempting historical backfill gaps. The integration runs an actual native temporary producer of hourly multi-ad rows and an aggregated campaign summary, compares its entire output with independent literals, and passes the actual rows to the checker. Removing one actual ad fact must produce the independently specified negative gap.

The runner contains no JavaScript check engine or generated expectations. Independent failure jobs use at most three concurrent queries. Every job uses native Standard SQL, cache disabled, and a 1 GiB maximum billed cap. Downloads evidence includes source/fixture/runner/query hashes, job IDs and configurations, full results/errors, versions, and bytes. `--resume-report PATH` re-fetches byte-identical prior queries read-only and repeats full golden comparisons into a separate report; previous evidence remains intact. No customer tables are required for testing.

Native execution verified 2026-09-09: all 33 full literal finding goldens, standalone execution, 14 intended structural/configuration failures, two rejected semantic mutations, and the actual native producer with intact and deliberately corrupted consumers passed. All 21 final jobs reached terminal verified states with Standard SQL, cache off, and the 1 GiB cap. The initial final-assembly correlated-subquery failure is preserved separately; final assembly was changed to grouped temporary tables and explicit joins before these successful runs. No permanent objects, customer tables, or provider requests were used. Tested with Node v20.18.1 and BigQuery CLI 2.1.19. These are synthetic contract and integration results, not a production performance benchmark or proof of deletion causality.

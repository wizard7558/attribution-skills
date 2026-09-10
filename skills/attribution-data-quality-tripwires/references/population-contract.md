# Native population tripwires

Four independent BigQuery Standard SQL scripts check explicit population projections. They use temporary objects only and do not classify channels, match identities, join people, or infer a source population from labels.

## Inputs shared by all four scripts

Replace the marked BEGIN REPLACEABLE INPUTS block with typed projections. Each standalone example contains nonempty synthetic inputs. Production requires exactly one configuration row. The runner alone batches independent synthetic invocation namespaces; every input row must reference a configuration.

Configuration contains invocation_key, report_scope, report_timezone, inclusive DATE report_start/report_end, date_mode (cohort|activity), and opaque source_evidence_ref/report_evidence_ref. Names and source identities are exact nonempty strings without surrounding whitespace or C0/C1 controls. Case and literal plus remain unchanged. The timezone is a named IANA zone or valid named alias; fixed numeric offsets are rejected. A fixed timestamp verifies native zone support. DATE columns are typed calendar dates; textual ingestion that cannot produce a valid DATE fails before the check.

Each input table appends invocation_key. Every raw row validates, including excluded/nonmember records. Declared column types are checked through TYPEOF(ANY_VALUE(column)), even when a table is empty. Structural failures are native assertions with fixed data-free messages. Compilation errors caused by an invalid replacement input are ingestion errors, not findings.

Nonempty membership_input explicitly declares source_system/source_scope. No bare record-key joins or inferred memberships occur. Exact duplicate source records and membership rows collapse; conflicting payloads for a qualified source key assert. Diagnostic nonmember and excluded counts can overlap and are not additive populations.

## Unmapped share and match rate

Configuration additionally requires BOOL source_complete, NUMERIC threshold in [0,1], and INT64 min_eligible_count >= 1. There are no hidden defaults.

Source rows contain source_system, source_scope, record_key, required BOOL included/eligible, and nullable BOOL meets_condition. Identity is the qualified source system/scope/record_key. included is the caller's explicit window/population projection, not a timestamp interpretation performed by these checks. The caller must align that projection with the declared scope, dates, timezone and date mode. Only included members with eligible=true enter the denominator. A null condition is unknown, not false.

For unmapped-share.sql, true means unmapped and the condition is rate <= threshold. For match-rate.sql, true means matched and the condition is rate >= threshold. These are generic semantic projections; explicitly document how the caller maps its upstream evidence into eligibility and the condition.

Let N be eligible records, T true conditions and U unknown conditions:

~~~text
lower_rate = T / N
upper_rate = (T + U) / N
point_rate = T / N only when U = 0
~~~

Decisions compare exact BIGNUMERIC cross-products, not rounded displayed ratios. A complete ceiling check fails when T > threshold*N, passes when T+U <= threshold*N, and is otherwise unknown. A complete floor check fails when T+U < threshold*N, passes when T >= threshold*N, and is otherwise unknown. Equality is inclusive. Unknown conditions can still prove a pass or failure; their count and flag remain visible even then.

An incomplete source, zero eligible records, or population below min_eligible_count makes the decision unknown. Under source_complete=false, all displayed rates/bounds describe only supplied observed eligible rows; they do not bound an unseen complete population. Known observations are preserved.

Each rate finding has exactly one detail containing eligible_count, true_count, false_count, unknown_count, point_rate, lower_rate, upper_rate, unknown_conditions_present, status and reasons. Empty denominator rates are null. Repeating-decimal BIGNUMERIC division is serialized at native precision; comparison decisions remain exact.

Rate diagnostics are source_raw_rows, source_duplicate_rows_collapsed, source_selected_rows (included members before eligibility), source_nonmember_rows, source_excluded_rows, and ineligible_rows (selected but not eligible).

## Primary uniqueness

Configuration additionally requires BOOL source_complete. Source rows contain source_system/source_scope/record_key, required BOOL included/is_attribution_primary and nullable exact group_key. Only included members participate.

Group identity is the qualified source system/scope plus a tagged group type. Nonnull group_key forms a declared group. A null group_key forms a singleton whose identity uses its record_key. An opaque declared group label identical to a singleton record key cannot collide with that singleton.

A declared group with more than one primary fails even when the source is partial. No primary fails for a complete source, and is unknown for an incomplete one. Exactly one primary passes for complete groups and remains unknown for incomplete groups because unseen rows could contain another primary.

A singleton with primary=true passes its local detail because its declared singleton is fully observed. A singleton with primary=false fails even under partial input. The overall incomplete population remains unknown unless any local failure proves fail. Complete empty input passes; incomplete empty input is unknown.

Every selected group is reported with source_system, source_scope, group_type (declared|singleton), group_key, singleton_record_key, member_count, primary_count, complete qualified member_keys/primary_keys arrays, status and reasons. Each key object contains source_system/source_scope/record_key. Empty primary arrays are [], never null. Details sort by source system, source scope, group type, group key, singleton key; member arrays sort by record key.

Diagnostics are the five shared source count fields listed for rates plus selected_groups. This checks uniqueness and presence of primary flags. It does not judge earliest-event ordering, discover people, or rerun identity matching.

## Source parity

Configuration additionally requires exact metric_name, unit='count', NUMERIC abs_tolerance >= 0 and relative_tolerance in [0,1]. Each membership row additionally requires BOOL reference_complete/observed_complete and opaque reference_evidence_ref/observed_evidence_ref. Conflicting declarations for the same qualified source assert.

Both reference_input and observed_input contain source_system/source_scope, DATE event_date, nonnegative INT64 count, and exact report_scope/report_timezone/date_mode/metric_name metadata matching configuration. Qualified source system/scope/event_date identifies a row. Exact repeats collapse; conflicts assert. Nonmembers and rows outside the date range validate and are diagnosed, then excluded.

The check materializes every configured date for every declared source. It never averages or merges counts across sources. Missing complete-side dates are known zero. Missing incomplete-side dates remain null; supplied counts on incomplete sides remain visible. Any incomplete side makes that source/date comparison unknown.

For complete comparisons:

~~~text
abs(observed_count - reference_count)
    <= max(abs_tolerance, abs(reference_count) * relative_tolerance)
~~~

Native BIGNUMERIC arithmetic preserves integer counts and decimal tolerances. No currency or population conversion occurs. A UI and a warehouse are not presumed to cover the same population; matching declarations are the caller's explicit assertion.

Each detail contains source_system, source_scope, event_date, reference_complete, observed_complete, reference_present, observed_present, reference_count, observed_count, signed difference (observed minus reference), allowed_difference, status, reasons and the two membership evidence_refs. Differences/tolerances may be visible for supplied incomplete evidence but never prove a full-population discrepancy. Details sort by source system, source scope and date.

Diagnostics contain reference_raw_rows/reference_duplicate_rows_collapsed/reference_selected_rows/reference_nonmember_rows/reference_excluded_rows and the corresponding five observed fields, plus compared_groups, missing_reference_groups and missing_observed_groups. The configured grid can be large; select a deliberate operational window. No scale benchmark is claimed.

## Finding envelope and reason codes

Each script returns invocation_key and a result_json string. Its parsed object has exactly check_id, contract_version='0.1.0', configuration (complete explicit configuration), status (pass|fail|unknown), sorted distinct reasons, evidence_refs=[source_evidence_ref,report_evidence_ref], details, and diagnostics. Check IDs are unmapped_share, match_rate, primary_uniqueness and source_parity.

All counts, rates and numeric configuration/tolerance fields serialize as decimal strings; unknown values remain null. Flags stay Boolean. Arrays are deterministic; a pass has an empty reasons array. Overall fail takes precedence over unknown, which takes precedence over pass.

| Reason | Scope and meaning |
| --- | --- |
| source_incomplete | Rates cannot decide the whole population; primary grouped details and the overall primary finding cannot establish complete uniqueness. |
| no_eligible_records | Rate denominator is zero. |
| below_minimum_eligible_count | Nonzero rate denominator is below the explicit minimum. |
| condition_uncertainty | Complete rate interval crosses its threshold. |
| rate_above_maximum | Complete unmapped interval proves the ceiling exceeded. |
| rate_below_minimum | Complete match interval proves the floor missed. |
| multiple_primary | A declared group has more than one primary. |
| missing_primary | A complete declared group has none. |
| singleton_not_primary | An observed singleton has primary=false. |
| reference_incomplete / observed_incomplete | That parity side is incomplete for the declared source. |
| count_mismatch | A complete source/date difference exceeds the explicit tolerance. |

## Runner and integration

From this skill root:

~~~sh
node scripts/test-population-checks.mjs
node scripts/test-population-checks.mjs --live --project YOUR_BILLING_PROJECT --location US --integration
~~~

Offline only validates fixture definitions and prints **NO SQL EXECUTED**. Live executes all four standalone examples, full literal golden batches, expected native structural/configuration failures, and two semantic SQL mutations (reversed ceiling comparison and dropped primary groups). The mutations must disagree with independently authored full expected findings and their expected status.

Every submitted job uses Standard SQL, disabled cache and maximum_bytes_billed=1073741824. At most three structural jobs run concurrently. Each run preserves a new timestamped Downloads evidence file with source/fixture/query hashes, full native results/errors, Node/BigQuery versions, job identity/state and measured bytes. --resume-report PATH permits only byte-identical queries; completed successful query outputs are fetched read-only and compared anew. Earlier failed evidence is not overwritten. A corrected golden can recheck an already completed native result with an unchanged query hash; evidence shows both runs.

Optional integration requires the sibling crm-paid-attribution skill in the repository; all SQL scripts and ordinary fixtures are standalone. The integration calls actual attributeLeads and cleanClick exports, verifies independently authored expected output fields, and retains full producer output and input/source hashes. It is not a second resolver or SQL check engine.

The synthetic integration declares all eight leads included on its one-date window. Unmapped eligibility is all leads; true means quality_status is unmapped or unattributed, explicitly counting absent attribution. Ad-match eligibility is canonical Paid Search/Paid Social/Paid Other; true means ad_match_status='matched'. Primary grouping uses the actual selected supported paid click field: raw_evidence.click_ids for HIGH confidence or first_touch_click_ids for LOW, cleaned exactly once by the imported helper. The opaque group is JSON [match_key, cleaned_value], scoped to CRM source system/scope; all other leads are singletons. A corrupted second primary must fail. Parity observed counts come from actual CRM rows per qualified source, compared with independent literal reference counts. No expected output is substituted into a native input.

<!-- execution-status:start -->
Authenticated native BigQuery execution passed on 2026-09-09: 36 full literal golden findings, 17 structural fixtures, eight configuration failures, four standalone examples and two rejected native SQL mutations. Actual CRM resolver output passed its independently authored projection and supplied both rates, primary uniqueness and source parity; a corrupted primary flag failed as expected. All submitted jobs confirmed a 1 GiB cap, Standard SQL and disabled cache. Private source/query hashes, full results, job metadata, versions and bytes remain in Downloads evidence. This is synthetic correctness evidence, not a scale benchmark.
<!-- execution-status:end -->

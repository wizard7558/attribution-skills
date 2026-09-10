# Deterministic parameters and bounded raw diagnostics

[scripts/parameter-helpers.sql](../scripts/parameter-helpers.sql) is the GA4-owned authority for `param_string`, `param_int`, and `param_number`. The repository generator embeds its exact `PARAMETER HELPERS` block in [sessions.sql](sql/sessions.sql), [channel_daily.sql](sql/channel_daily.sql), [landing_pages.sql](sql/landing_pages.sql), [traffic_source_compare.sql](sql/traffic_source_compare.sql), [params.sql](sql/params.sql), [key_events.sql](sql/key_events.sql), and [ui_reconciliation.sql](sql/ui_reconciliation.sql). Copied SQL includes its helper definitions and has no runtime sibling imports. The classifier and shared session-reduction logic remain unchanged.

## Parameter selection

A helper selects the first matching parameter record by original array offset, even if the requested typed value in that record is NULL. It never skips to a later duplicate, selects the last record, or mixes fields from different duplicate records. An absent key yields NULL. An empty selected string remains an empty string; the helper does not trim it or substitute a later value.

`param_string` returns that record's `string_value`. `param_int` returns its `int_value`. `param_number` evaluates `COALESCE(float_value, double_value, CAST(int_value AS FLOAT64))` inside that one selected record. It does not parse `string_value`. Integer conversion uses FLOAT64 semantics and is not an exact-money API. Google's [export schema](https://support.google.com/analytics/answer/7029846) documents the typed value fields and says `float_value` is currently unused in standard export data; this helper nevertheless explicitly supports that field when supplied. The fixture tests float precedence, double fallback, integer fallback, a string that must not be parsed, and a first typed NULL followed by a later populated duplicate.

The source `event_params` array must contain `key STRING` and a `value` struct with the fields consumed by the invoked helper: string STRING, integer INT64, float FLOAT64 and double FLOAT64. The numeric helper needs all three numeric fields in its supplied schema. Duplicate counts in the raw parameter sample measure repeated keys, not agreement or disagreement between their values.

## Raw parameter sample

`params.sql` returns one `result_json` object with separate `inline_rows` and `helper_rows` arrays. It retains raw `page_view` occurrences, including NULL visitor IDs and NULL selected session IDs. Duplicate event occurrences remain duplicates. It is not sessionization or deduplication.

Both idioms project `source_system`, `source_scope`, property-local `event_date`, raw microsecond `event_timestamp`, `event_name`, `user_pseudo_id`, selected `ga_session_id`, selected `page_location`, and `ga_session_id_duplicate_count` / `page_location_duplicate_count`. Duplicate count is `max(number of matching records - 1, 0)`, so both absent keys and single occurrences have zero duplicates. The inline scalar subqueries use exactly the same first-offset rule as the helpers.

The helper array also projects selected `session_engaged`, numeric `engagement_time_msec`, and duplicate counts for those two keys. These extra fields do not change the raw population. In particular, a NULL first numeric record does not become a later duplicate's value, even if the later value would change engagement.

Each array orders by event timestamp and the full selected input/evidence JSON, then returns at most 1,000 rows. The evidence tie-break retains the source parameter array order. The internal JSON ordering key is not projected as an additional business field. These arrays are deterministic inspection samples, not complete-population reports. The limit does not cap bytes scanned.

## Raw key-event sample

`key_events.sql` retains configured raw occurrences using the declared default event list `purchase`, `generate_lead`, and `sign_up`; use the same agreed list in related session queries. It explicitly excludes rows whose visitor ID is NULL or whose first selected integer session ID is NULL. A later duplicate session parameter cannot recover a first NULL value. The raw parameter and identifier diagnostics intentionally include broader populations than this sample.

Rows contain source system/scope, visitor ID, selected integer session ID, property date, event name, raw timestamp, native `event_ts`, original `event_value_in_usd`, and session key. Qualified identity combines the source/scope with visitor and session ID; visitor alone does not identify a session. Repeated purchases remain repeated. A raw configured-event count is neither a unique transaction count nor a count of all unidentified conversions.

USD values are passed through: NULL stays NULL, known zero stays zero, and negative values remain negative. The query does not sum them or replace missing values. Rows order by timestamp, qualified source/visitor/session fields, event name and full selected row JSON, then retain at most 1,000 rows. This limit is a presentation sample, not a cost guard.

The raw INT64 `event_timestamp` preserves exact microseconds. The native TIMESTAMP `event_ts` is computed with `TIMESTAMP_MICROS`; the tested `bq` JSON renderer prints that display field to whole seconds. Tests therefore compare the observed CLI display encoding separately from the exact microsecond integer. A formatted CLI timestamp alone must not be presented as microsecond-preserving evidence.

## Three observation diagnostics

`ui_reconciliation.sql` returns one `result_json` with three distinct diagnostics. Every diagnostic declares `source_system`, `source_scope`, `observation_scope` and `limitations`. These are bounded observations, not a GA4 UI reconciliation conclusion.

`daily_observations` builds a date spine from the supplied literal bounds and counts observed rows by daily table suffix. The fields are `table_date`, `observed_event_rows`, `table_existence`, `export_completeness`, scope and limitations. Dates with no observed rows remain visible with count zero. Both existence and completeness remain `unknown`, because actual table metadata or completeness evidence is not supplied. Zero does not prove an absent table, and a low/latest count does not prove landing lag. Observation scope is `daily_export_rows_in_supplied_window`; limitations are `row_counts_do_not_establish_table_existence_completeness_or_lag`.

`identifier_observation` counts all observed events, NULL visitor IDs and NULL first-selected session IDs. It reports `total_events`, `null_user_pseudo_id_events`, `missing_session_id_events`, and `pct_null_user`, rounded to two decimal places. Missing-user and missing-session counts can overlap and must not be summed as a disjoint excluded population. The fraction is NULL when the observed denominator is zero; counts remain zero. `missing_identifier_cause` stays `unknown`. No consent field is read, so missing identifiers do not establish consent status or any other cause. Scope is `all_observed_events_in_supplied_window`; limitations are `identifier_absence_does_not_establish_consent_cause`.

`session_date_spans` includes only observations with present visitor and selected session IDs, grouping by those two exact fields within the declared property scope. It counts sessions whose observed property dates span more than one distinct value, total observed sessions, and the percentage crossing dates, rounded to two decimals. The percentage remains NULL for a zero denominator. The fields are `total_sessions`, `sessions_crossing_midnight`, and `pct_crossing_midnight`; scope is `qualified_sessions_observed_in_supplied_window`. Limitations are `window_censored_date_spans_do_not_establish_lifetime_sessions_or_explain_ui_differences`. A crossing can span a gap in observed dates; it is not proof of continuous activity or a complete lifetime session.

The property timezone is not supplied or inferred from UTC event timestamps. Table suffixes bound the scan; property `event_date` supplies observed session-date spans. The [Google export documentation](https://support.google.com/analytics/answer/7029846) separately describes updates to daily tables for up to three days after the event dates. That ingestion behavior is not a completeness test, and the diagnostic does not label a table fully landed after a fixed number of hours.

## Schema, pruning and execution

The raw parameter query reads event date, timestamp, name, visitor ID and repeated typed event parameters. Key-event sampling additionally reads `event_value_in_usd`. The diagnostics read daily suffix, property event date, visitor ID and the selected session parameter. The four session-derived templates retain their existing additional source, ecommerce and classification schema dependencies; see [the companion contract](companion-session-contract.md). There is no intraday union or consent-cause inference in this step.

Replace every exact `PROJECT.analytics_PROPERTY_ID` token with the intended property scope and both `YYYYMMDD` bounds with the intended daily window. In `ui_reconciliation.sql`, also replace the matching start/end values in `GENERATE_DATE_ARRAY`. Review the substituted query before running it. Literal date pruning, the columns read and the explicit billing cap govern the bounded execution; no fixed small-MB or light-scan estimate is promised.

For an already substituted standalone file:

```sh
bq --project_id="$BILLING_PROJECT" --location="$BQ_LOCATION" query \
  --use_legacy_sql=false --use_cache=false \
  --maximum_bytes_billed=1073741824 --format=json --max_rows=10000 \
  < /path/to/substituted-query.sql
```

A large query may be rejected by the 1 GiB cap. Neither SQL LIMIT nor the CLI row limit is a scan-cost bound. The native synthetic tests below read no customer datasets.

From the repository root, with Node.js 20 or later:

```sh
node skills/ga4-bigquery-export/scripts/test-parameter-diagnostics.mjs
node skills/ga4-bigquery-export/scripts/test-artifacts.mjs
node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check
node scripts/test-suite-contracts.mjs
```

The parameter runner's offline mode explicitly says **NO SQL EXECUTED**. It checks fixture definitions, seven exact helper blocks, inline/helper projection parity, four qualified-session expectations and comparator sensitivity. It does not implement a JavaScript sessionizer or data-quality engine. The generator test covers 11 artifacts, all seven helper blocks, the GA4 authority dependency and standalone taxonomy-only isolation.

With authenticated `bq`, run the actual templates against typed nested synthetic inputs:

```sh
node skills/ga4-bigquery-export/scripts/test-parameter-diagnostics.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --report "$HOME/Downloads/ga4-parameter-native-evidence.json"
node skills/ga4-bigquery-export/scripts/test-companion-sessions.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --report "$HOME/Downloads/ga4-companion-helper-refresh.json"
```

The first suite executes 20 jobs: the seven actual templates and their seven copied files, empty diagnostics, event-row permutation preserving parameter-array order, two native helper mutants, and current sessions/channel-daily SQL on the existing accepted integration fixtures. The main fixture has 13 observed events across two populated dates, a zero-row middle date, six raw page views, four retained key-event occurrences and four qualified sessions. One visitor has two separate sessions. Full raw diagnostic/companion outputs and literal selected source-session fields are checked. Exact native outputs remain in evidence, including fields outside a declared projection.

The native mutants choose the last parameter or skip the first NULL; both must yield wrong outputs under the real scorer. The companion refresh reruns its unchanged ten-job native suite against current SQL hashes. Earlier accepted reports remain historical evidence of their earlier bytes and are not relabeled as proof of the new helpers. The existing integration fixture data and expected values are unchanged; the new runner supplies their typed input projection and executes current production SQL with the required 1 GiB/no-cache controls.

Each report preserves source/fixture/runner hashes, exact queries and hashes, job IDs, raw/parsed results, metadata, errors and native byte statistics. Reports must use new paths. Counts, NULLs, identifiers, labels and arrays are strict; only declared floating fields allow `max(1, abs(expected)) * 1e-12` tolerance. Normalization is limited to native CLI number/boolean/TIMESTAMP display encoding, with exact raw timestamp integers checked separately.

For a completed byte-identical parameter report, a new read-only recheck submits no queries:

```sh
node skills/ga4-bigquery-export/scripts/test-parameter-diagnostics.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --resume-report "$HOME/Downloads/ga4-parameter-native-evidence.json" \
  --report "$HOME/Downloads/ga4-parameter-native-recheck.json"
```

The companion runner supports the same `--resume-report` pattern. Resume rejects changed source, fixture, runner, billing context or query bytes, and accepts only verified terminal jobs. Preserve all earlier attempts, including encoding or native-query failures. None of these synthetic checks establishes production completeness, consent causality, cross-property identity or GA4 UI parity.

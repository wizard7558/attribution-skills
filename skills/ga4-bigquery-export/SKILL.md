---
name: ga4-bigquery-export
description: Analyze raw Google Analytics 4 daily BigQuery exports with source-qualified observed sessions, deterministic parameter extraction, canonical channels, raw key-event diagnostics, qualified ecommerce evidence, and bounded execution. Use for events_YYYYMMDD data, event_params, user_pseudo_id/ga_session_id, landing attribution, export/UI comparisons, or BigQuery scan controls.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.2.0"
---

# GA4 BigQuery export

Use this skill for raw daily event exports. GA4 Data API reports, the GA4 UI and already aggregated ETL reports have different interfaces and populations. The shipped SQL does not join user-scope exports or union intraday data.

Read the [schema prerequisites](references/schema.md), [channel and session rules](references/channel_rules.md) and [execution contract](references/export-execution-contract.md) before running a property query. [Verification status](references/verification-status.md) distinguishes native evidence from model evaluation and UI parity.

## Establish the report boundary

1. Obtain the exact authorized source project/dataset, billing project, location and inclusive daily date window. Inspect the selected table metadata and nested schema. A NULL field value differs from an absent schema field.
2. Declare the population, metric and key-event list. Defaults are `purchase`, `generate_lead` and `sign_up`; these are editable SQL declarations, not a discovered property configuration. Keep related declarations consistent and validate changed SQL as a new artifact.
3. Preserve `source_system`, `source_scope` and native keys. The wrapper substitutes the property scope; it does not discover a person/account bridge or property timezone.
4. Review all rendered SQL and a best-effort dry-run estimate. Literal `_TABLE_SUFFIX` bounds and a byte cap are required. A script dry-run can omit later statements; zero estimated bytes does not establish a free or valid full script. See [BigQuery dry-run limitations](https://docs.cloud.google.com/bigquery/docs/multi-statement-queries#dry-run_a_multi-statement_query).
5. Retain exact job handles and private evidence. Native failure or incomplete retrieval remains unresolved until inspected; do not silently widen dates, replace a job or raise a cap.

Daily exports may receive late events for up to three days after their event dates according to [Google's export documentation](https://support.google.com/analytics/answer/7029846). That does not establish that a particular table is complete after a fixed interval. Low counts, old dates and successful queries are not completeness evidence.

## Select the right output

| SQL file | Population and output | Presentation boundary |
| --- | --- | --- |
| [sessions.sql](references/sql/sessions.sql) | Observed sessions with present visitor and selected session IDs; timing, source, landing, engagement and channel | All emitted session rows |
| [channel_daily.sql](references/sql/channel_daily.sql) | Source/date/channel aggregation of those sessions and its session-plus-transaction purchase policy | All emitted groups |
| [landing_pages.sql](references/sql/landing_pages.sql) | Shared sessions grouped by source/scope/landing path across the entire window | Top 20 ordered groups |
| [traffic_source_compare.sql](references/sql/traffic_source_compare.sql) | Selected native session source/medium versus canonical landing-URL UTM evidence | Top 20 ordered groups |
| [params.sql](references/sql/params.sql) | Raw page views, including missing IDs; inline and helper extraction arrays in `result_json` | Up to 1,000 rows per array |
| [key_events.sql](references/sql/key_events.sql) | Configured raw event occurrences with present visitor/session IDs | Up to 1,000 ordered occurrences |
| [ui_reconciliation.sql](references/sql/ui_reconciliation.sql) | Daily row observations, missing identifiers and observed session date spans in `result_json` | Full declared diagnostics |
| [ecommerce.sql](references/sql/ecommerce.sql) | Qualified observed-window transactions, payload conflicts, items, unkeyed evidence and daily summaries in `result_json` | Full declared report |

Complete REST retrieval means all rows returned by that SQL. It does not remove a SQL sample limit or prove the underlying population complete.

## Deterministic parameters

[parameter-helpers.sql](scripts/parameter-helpers.sql) is the authority embedded in seven templates. Choose the first matching array record by original offset, including a NULL selected typed value:

```sql
(SELECT p.value.int_value
 FROM UNNEST(event_params) AS p WITH OFFSET AS parameter_offset
 WHERE p.key = 'ga_session_id'
 ORDER BY parameter_offset LIMIT 1)
```

`param_string` reads that record's `string_value`; `param_int` reads `int_value`. `param_number` evaluates `COALESCE(float_value, double_value, CAST(int_value AS FLOAT64))` within the same record. It never parses a string or fills from a later duplicate. Empty selected strings remain empty. Duplicate-key counts measure repeated keys, not agreement between their values. See [parameter and diagnostic rules](references/parameter-diagnostic-contract.md).

## Observed sessions and identity

The local token is `CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING))`. Across outputs, use the full tuple `(source_system, source_scope, session_key)`, with `visitor_key` retained separately. A bare visitor or session token is not a cross-property or cross-system identity.

The accepted session reduction does **not** separate platform or stream. If identical visitor/session values occur across streams inside a property, it can merge them. Do not claim platform/stream-qualified sessions; assess that limitation before using a mixed-stream population. Ecommerce has a different, stronger domain described below.

The reduction excludes NULL visitor IDs and NULL first-selected integer session IDs; it does not normalize non-NULL identifiers or infer a missing one. Missing-identifier diagnostics describe the excluded evidence without attributing its cause to consent.

Events are grouped across the supplied daily window. The first observed timestamp and deterministic selected-evidence JSON determine the start, source ordering and assigned property date. Earlier or later events outside the scan remain unknown. The query does not reconstruct inactivity timeouts, complete lifetime sessions or events outside its window. `reporting_timezone` stays NULL; do not infer an IANA timezone from timestamp offsets or BigQuery location.

The observed engagement proxy is true when any exported `session_engaged='1'`, summed selected integer engagement time is at least 10,000 milliseconds, at least two `page_view` events occur, or a configured key event occurs. It is not an exact UI reconstruction: the code uses accumulated engagement time and page views, and does not read UI settings or count screen views in that branch. Google's [engaged-session definition](https://support.google.com/analytics/answer/12798876) includes session duration, key events and page/screen views.

`ga_session_number` is the maximum selected number within the observed group; `is_new_user` is true only when that maximum equals 1. Daily `new_users` counts those session rows, not unique people or proved first-ever acquisitions. `key_events` counts configured raw occurrences, including repeated purchases.

## Native source and landing evidence

For each event, choose the complete selected cross-channel struct when any of its source, medium, campaign name or native channel fields is non-NULL. Only an all-NULL struct falls back to that event's manual struct. Then take the earliest nonempty selected struct by timestamp and evidence JSON. Empty strings count as non-NULL. Never fill a partial cross-channel pair from manual fields or another event. User-first-acquisition `traffic_source` is not used.

The landing is the first event with a non-NULL page URL, otherwise the first observed event. Referrer and collected `gclid`, `dclid` and `srsltid` come from that same event. A blank or invalid non-NULL URL still participates in this selection; later clicks do not replace it. Collected nonempty IDs take priority over URL IDs in `click_ids`; the legacy `landing_gclid`, `landing_fbclid` and `landing_ttclid` fields remain URL-only.

The embedded canonical classifier receives raw evidence once. Paid click IDs override conflicting native/email evidence; `dclid` is `Paid Other`, and `srsltid` alone does not establish paid traffic. All 13 supported click fields remain available. Canonical `channel` is a shared reporting category, while the selected `default_channel_group` is raw native evidence. Neither establishes person identity or reproduces every GA4 UI rule. See the [local shared contract](references/channel-contract.md).

The traffic comparison uses native source/medium directly and preserves missing values as NULL. Its separate URL status is `missing`, `invalid` or `valid`; a valid untagged URL stays distinct from no URL. Canonical parsing preserves UTM value case, handles bounded decoding and raw-plus versus encoded-plus correctly, uses the first duplicate key including an empty first value, and ignores fragments. Do not substitute a second regex parser or invent Direct labels for missing UTM evidence. See [companion semantics](references/companion-session-contract.md).

## Purchases, money and items

Keep the two purchase policies explicit:

- `channel_daily.sql` deduplicates exact nonempty transaction IDs within each local session in its property scope. It selects the earliest non-NULL USD amount and aggregates transactions before joining sessions. It does not reconcile contradictory duplicate payloads or add platform/stream qualification. Missing/empty IDs remain a separate count and make daily revenue NULL; all-missing selected amounts also make revenue NULL. No purchases gives zero. Its ordinary FLOAT64 sums and native status vocabulary are not the ecommerce finite/conflict contract.
- `ecommerce.sql` uses `(source_system, source_scope, platform, stream_id, user_pseudo_id, exact transaction_id)`, excluding session and event date. NULL or trimmed-empty required keys are unkeyed; nonempty IDs remain untrimmed. The first observed occurrence assigns the date. Identical complete selected payloads collapse; contradictory payloads retain every variant and emit no authoritative amount or item lines. NULL versus populated values is a conflict, not a backfill instruction.

Ecommerce derives items once from an accepted transaction payload; original item offsets distinguish repeated lines. Any unkeyed purchase anywhere in the window makes daily all-population purchase counts and authoritative money totals unknown, while known qualified subtotals and occurrence counts remain visible. Known zero/negative amounts remain valid; missing and nonfinite values carry explicit states. USD arithmetic is guarded but approximate FLOAT64, not exact financial reconciliation. Native currency/value fields remain conflict evidence, without native-money aggregation. See the [ecommerce contract](references/ecommerce-contract.md).

Google's [transaction-ID guidance](https://support.google.com/analytics/answer/12313109?hl=en) describes same-user duplicate handling and limits its deduplication to web streams. This warehouse policy does not claim app-stream or web UI equivalence. Raw key-event occurrences are neither unique orders nor all unidentified conversions.

## Observation diagnostics

The daily date spine retains zero observed rows while both table existence and completeness remain `unknown`. Metadata must be inspected separately. Missing-user and missing-session counts overlap; do not add them as disjoint excluded groups. An empty denominator yields a NULL fraction. No consent field is read, so `missing_identifier_cause` remains `unknown`.

Observed session date spans use the property-scoped visitor/session pair. A span across dates is bounded by the scan and does not prove continuous activity, a complete session lifetime or the cause of a UI difference. Compare population, dates, currency, collection configuration and metric definitions before proposing a reconciliation explanation; do not promise a typical discrepancy size.

## Execute from a copied skill directory

Use Node.js 20+, Bash and authenticated `bq`/`gcloud` configured for the intended authorized account. The SQL files embed their runtime helpers; they do not require a sibling skill. Read-only metadata and job/result access are required, along with query permission in the billing project. These scripts create their declared temporary tables, not permanent application tables.

```bash
# Review all eight rendered files offline; no credentials or SQL execution.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US --render-only \
  --report "$HOME/Downloads/ga4-render.json"

# Execute the same explicit source/window after review.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US \
  --report "$HOME/Downloads/ga4-results.json"
```

Billing defaults to source project and location to `US`; these are wrapper defaults, not discovered source metadata. `MAX_BYTES` defaults to `1073741824` per job. An explicit override is supported, but the wrapper never raises it automatically. All eight jobs use Standard SQL and no query cache. Dates, identifiers, caps and every placeholder are validated before credential access. The allowlist is fixed; no arbitrary SQL filename is accepted.

Reports are exclusively created, mode `0600`, in Downloads by default. They retain exact source/query hashes, configuration, IDs before submission, native metadata/errors and every result page. INT64/NUMERIC/BIGNUMERIC remain strings. Native TIMESTAMP values are retrieved as exact microsecond strings via [DataFormatOptions](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/DataFormatOptions); `result_json` strings remain unchanged alongside their parsed form. Customer evidence stays private.

```bash
# Same existing handles, identical source/configuration; write a new report.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US \
  --resume-report "$HOME/Downloads/ga4-results.json" \
  --report "$HOME/Downloads/ga4-results-recheck.json"
```

Resume rejects changed wrapper/template/query/configuration bytes and never replaces a recorded failed or missing handle. Previously unreached inventory entries can receive their first submission. Incomplete pages, errors and running jobs are not completed checks. See the [execution contract](references/export-execution-contract.md) for precise validation, pagination and troubleshooting.

## Verify without confusing test modes

```bash
# Offline definitions, rendering, copied CLI, mocked transport and resume tests.
node scripts/test-export-checks.mjs
# Prints NO SQL EXECUTED.

# Explicitly billed synthetic test; creates and removes one owned test dataset.
bash scripts/run_checks.sh --synthetic --billing-project example-billing --location US \
  --report "$HOME/Downloads/ga4-synthetic.json"
```

The synthetic command uses the full eight-template wrapper proof, including copies, real pagination, pruning and cap failure. It requires explicit billing and the default 1 GiB ordinary-job cap. Lower-level fixture suites and repository-only generation checks are linked from [verification status](references/verification-status.md). Do not treat a JavaScript definition check as SQL execution or use the legacy two-template runner as the production wrapper.

The model evaluation status and exactly three planned group objectives are maintained in [eval.md](references/eval.md). No model performance claim follows from the native query evidence.

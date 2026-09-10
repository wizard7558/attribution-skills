# Landing and native-source comparison companions

[landing_pages.sql](sql/landing_pages.sql) and [traffic_source_compare.sql](sql/traffic_source_compare.sql) consume exactly the generated session reduction used by [sessions.sql](sql/sessions.sql). Each qualified session contributes once. These are inspection queries over the whole selected scan window, with a deterministic top-20 limit; the returned groups need not cover the entire population.

The session identity is the property-qualified `(source_system, source_scope, session_key)`. The visitor key alone is insufficient: one visitor can have multiple sessions. The templates bind one export property through `PROJECT.analytics_PROPERTY_ID`; that value also supplies the output scope. They do not establish identity across properties or other sources.

## Shared session boundary

The included daily tables define the observed history. The first observed event determines the session date; the first event with a non-NULL page location determines the landing evidence, with event timestamp and the canonical JSON tie-break determining order. Native attribution selects one complete evidence struct from one ordered event. A nonempty cross-channel struct takes precedence over the manual struct even when individual fields are missing. Missing fields are not borrowed from the manual struct or later events.

`event_date` is the export property's local date. The templates retain `reporting_timezone = NULL` in the source session output because the actual property timezone is not supplied. UTC timestamps do not identify that timezone. A session crossing the scan boundary is censored to observed events. Include an appropriate bounded adjacent-date history when interpreting boundaries; this does not guarantee a complete lifetime session history.

Engagement uses the unchanged session logic: a session-engaged flag, at least ten seconds of accumulated engagement, at least two page views, or at least one configured key event. The default key events are `purchase`, `generate_lead`, and `sign_up`; configure the same list in all related templates. Multiple purchases count as multiple key events but do not duplicate a session in either companion.

## Landing output

The output contains exactly `source_system`, `source_scope`, `landing_page_path`, `sessions`, `engaged_sessions`, and `key_events`. It groups the classified session rows by the first three fields and calculates `COUNT(*)`, `COUNTIF(engaged)`, and `SUM(key_events)`. The path extraction is the existing shared reduction's behavior; NULL paths remain visible. This query does not introduce a different URL-path parser.

Order is descending session count, then ascending source system, source scope, and landing path. BigQuery's ascending NULL ordering applies. The final `LIMIT 20` is a presentation limit, not a scan-cost bound.

## Native source versus landing UTM output

Native `session_last_click_source` and `session_last_click_medium` are direct projections of the selected native evidence. Landing UTMs describe what the observed landing URL contains. These evidence sources can legitimately differ; the comparison does not replace either with channel labels or assert that URL tags are GA4's native attribution.

The output contains exactly `source_system`, `source_scope`, `session_last_click_source`, `session_last_click_medium`, `landing_url_status`, `landing_utm_source`, `landing_utm_medium`, `landing_utm_campaign`, and `sessions`. It groups by the eight evidence fields, counts sessions, and orders by descending count followed by all eight fields ascending. It retains only the first 20 groups.

`extract_landing_utm_evidence` is generated from the same canonical implementation as the click-ID parser. It uses the existing `text`, `hostOf`, `queryParams`, and bounded `decode` helpers:

- A NULL or trimmed-empty URL has status `missing`. A nonempty URL rejected by canonical `hostOf` has status `invalid`. Other URLs have status `valid`, including canonical protocol-relative URLs. This is the taxonomy's accepted parser policy, not a newly imposed strict URL standard.
- Only a valid URL is parsed. Query keys use canonical decoding and case normalization; UTM values preserve case. Raw `+` becomes a space before bounded percent decoding, while `%2B` remains a plus. Decoding is bounded to five passes. Malformed encoding retains the helper's remaining string rather than throwing.
- First duplicate query keys win, including an empty first value. Empty decoded values become SQL NULL. A later duplicate cannot replace the first empty value. Fragment parameters are ignored.
- Missing or invalid evidence remains SQL NULL. A valid untagged URL is distinct from a missing or invalid URL; partial UTM pairs remain partial. No missing value is relabeled `(direct)` or `(none)`.

The full canonical behavior and channel vocabulary are in [channel-contract.md](channel-contract.md). The comparison itself does not classify UTM evidence into channels.

## Required export fields

Both scripts retain the same schema dependencies as `sessions.sql`: `event_date`, `event_timestamp`, `event_name`, `user_pseudo_id`; repeated `event_params` with `key`, `value.string_value`, and `value.int_value`; collected `gclid`, `dclid`, and `srsltid`; the cross-channel source, medium, campaign name, and default channel group; manual source, medium, and campaign name; and ecommerce transaction ID and purchase revenue in USD. Required nested fields must exist in the selected export schema. NULL visitor IDs or session IDs are excluded by the shared reduction. The scripts do not fabricate missing schema fields or reinterpret an unknown property timezone.

## Run and verify

The SQL files are standalone after copying. They contain their own parameter helpers, classifier, click parser, and session CTEs; the comparison also contains its UTM helper. There are no runtime sibling-file dependencies. Before using a property export, replace both occurrences of the exact scope token `PROJECT.analytics_PROPERTY_ID` and the two `YYYYMMDD` literals with the intended property and bounded dates. Review the resulting query. For an already substituted SQL file, the explicit native command is:

```sh
bq --project_id="$BILLING_PROJECT" --location="$BQ_LOCATION" query \
  --use_legacy_sql=false --use_cache=false \
  --maximum_bytes_billed=1073741824 --format=json --max_rows=10000 \
  < /path/to/substituted-companion.sql
```

This command is an operational example; the synthetic verification below reads no customer datasets. A 1 GiB cap can reject a larger query and should not be described as a production-scale guarantee. The output row limit does not reduce bytes scanned.

From the repository root, Node.js and the existing canonical source are sufficient for definition checks:

```sh
node skills/ga4-bigquery-export/scripts/test-companion-sessions.mjs
node skills/ga4-bigquery-export/scripts/test-artifacts.mjs
node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check
node scripts/test-suite-contracts.mjs
```

The first command explicitly prints **NO SQL EXECUTED**. Its JavaScript parser checks validate the embedded canonical helpers; they are not a JavaScript session engine or a substitute for native SQL execution. The repository-only artifact test checks eight copied/generated targets plus each companion's generated block. The canonical generator's standalone mode still regenerates only its own classifier reference.

The native test requires an authenticated `bq` CLI, Node.js, and the repository checkout. From the repository root:

```sh
node skills/ga4-bigquery-export/scripts/test-companion-sessions.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --report "$HOME/Downloads/ga4-companion-native-evidence.json"
```

The output report must be new. Every job is Standard SQL, cache disabled, capped at 1 GiB, and operates only on nested synthetic events in temporary tables. The report preserves exact source and fixture hashes, the full submitted SQL and query hash, job IDs, raw outputs and metadata, errors, byte statistics, and full source-session rows. Private billing-project metadata stays in local evidence, not in this contract.

For a completed, byte-identical report, a new read-only verification report can be written without submitting queries:

```sh
node skills/ga4-bigquery-export/scripts/test-companion-sessions.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --resume-report "$HOME/Downloads/ga4-companion-native-evidence.json" \
  --report "$HOME/Downloads/ga4-companion-native-recheck.json"
```

Resume rejects changed runner, SQL, canonical source, fixture, project, location, or query bytes. It accepts only previously verified jobs and rereads their metadata and results. Original reports and failures are preserved. If a native query fails, inspect the saved error and exact job before changing or rerunning it; a definition-only pass does not resolve a native failure.

The fixture's independent literal expectations cover 14 qualified sessions, 13 landing groups, 12 source/UTM groups, eight parser cases, and repeated visitors. Native checks run the unchanged source query, both companions, copies of both SQL files, reversed event order, the generated UTM function, and two deliberately defective queries. The defects remove key-event engagement or mix native/manual fields. Full companion outputs are also compared with direct aggregation of the actual source-session rows. This bounded proof does not establish GA4 UI parity, customer-data completeness, or performance at production scale. The earlier GA4 native evidence remains separate and unchanged.

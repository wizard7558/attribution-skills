# Observed-export ecommerce transaction report

[ecommerce.sql](sql/ecommerce.sql) implements an explicit warehouse deduplication policy over a bounded daily-export scan. It does not reproduce GA4 UI deduplication. Google's [transaction-ID guidance](https://support.google.com/analytics/answer/12313109?hl=en) describes same-user duplicate handling, recommends unique order IDs across users, and states that transaction-ID deduplication applies to web streams, not app streams. The policy here applies its declared qualified domain to the supplied export evidence, including app-platform records, without claiming app UI equivalence.

This report is separate from the unchanged session-plus-transaction reduction in `channel_daily.sql`. Its transaction domain deliberately excludes the session and event date. Do not silently combine the two reports as if their deduplication and date-assignment populations were identical.

## Domain, source and window

The qualified transaction domain is the exact tuple `(source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id)`. Source system is `ga4`; scope comes from the explicit property token `PROJECT.analytics_PROPERTY_ID`. The other four fields come from the purchase event. A NULL or trimmed-empty required key makes that occurrence unkeyed. A nonempty key is never trimmed or otherwise normalized: `order` and ` order ` are separate values. The same transaction text in different users, streams, platforms or properties is not merged, and no cross-user identity is inferred.

The query reads only daily `events_*` tables selected by the literal `_TABLE_SUFFIX` bounds, then keeps `event_name = 'purchase'`. There is no intraday union. Each qualified domain is assigned to its earliest observed `(event_timestamp, event_date, selected_evidence_json)` tuple. Identical orders repeated across dates collapse to that first observed date. Later repeat dates still appear in the daily summary through their observed event counts, even when no new qualified order is assigned to them.

This is a censored observed window. An earlier event outside the scan can change the assigned date or reveal a conflicting payload. Export `event_date` is property-local; the report declares `reporting_timezone = NULL` because the property timezone is not supplied. Event timestamps do not establish that timezone. No lifetime or complete-history claim follows from this bounded scan.

## Selected payload and conflicts

The selected purchase payload contains exactly:

- USD purchase revenue, tax and shipping as source FLOAT64 values;
- native purchase revenue and the selected currency string, retained only as evidence;
- total item quantity and unique-item count as source INT64 values;
- the ordered item array, with original offset, item ID, name, category, quantity, USD item revenue and native item revenue.

Currency is the first `currency` event parameter by original array offset. This is a declared evidence selection, not proof that conflicting duplicate parameters are equivalent. The report does not silently inspect later values or claim a general duplicate-parameter reconciliation policy.

Occurrence metadata is excluded from the payload comparison. The complete selected payload is serialized together, preserving NULLs, native money and ordered item lines. Identical payload repeats collapse. More than one distinct payload in the same domain makes that transaction `conflict`: all variants and their occurrence evidence remain visible, `accepted_payload_json` is NULL, every authoritative money status is `conflict`, and no authoritative item lines are emitted. A NULL versus a non-NULL value is a conflict; it is not backfilled from a different event. Native currency/revenue or item-only differences also participate in the comparison.

An `accepted` transaction has one selected payload, regardless of whether some amounts are unknown. Its evidence is not a blanket assertion that all its values are usable. Original nonfinite source amounts remain represented in the payload JSON evidence. Authoritative money projections use `{value, status}` with `known`, `unknown`, `invalid`, or `conflict`: NULL is unknown, NaN and either infinity are invalid, and only finite source values are known. Known zero and negative values remain valid.

The variant occurrence list groups exact selected occurrence evidence and retains `occurrence_count`. Within each variant it orders by numeric event timestamp, property date and full selected evidence JSON. Transactions retain total occurrences, payload-variant count and collapsed duplicates. The identity is never replaced by an arbitrary representative row.

## Items

Item lines are derived only from an accepted transaction's one payload. They are never derived by unnesting repeated raw purchase events. The original array offset is part of item-line identity, so two legitimate lines with the same item ID remain distinct. Each emitted line repeats the complete qualified transaction domain and assigned date, plus offset, ID, name, category, quantity and USD revenue.

Quantity is `{value: INT64|null, status: known|unknown}`. USD item revenue follows the finite-money contract above. Missing and nonfinite item values remain visible as NULL projections with the appropriate status. Native item revenue stays in payload evidence but is not aggregated. Item revenue is not presumed to reconcile exactly to order revenue: discounts, tax, shipping and source conventions can differ. Transaction quantity fields remain in the complete selected payload; conflicting transactions have no accepted quantity payload.

## Daily counts and money

Daily rows distinguish observed purchase events on that export date from qualified occurrences assigned to the transaction's first observed date. A qualified order with conflicting values still has a known domain and counts once in `qualified_transaction_count`; its money remains incomplete. `accepted_transaction_count`, `conflicting_transaction_count`, assigned qualified events, collapsed duplicate events, observed unkeyed events and accepted item-line count remain separate.

Any unkeyed purchase anywhere in the selected window can be an earlier occurrence of an otherwise qualified order. Because that identity cannot be resolved, `window_has_unkeyed_evidence` makes **every daily** `all_population_unique_purchase_count` and authoritative money total NULL. This is an uncertainty boundary, not an inferred identity link. Per-day unkeyed occurrence counts, known qualified counts and known subtotals remain available. The global all-population unique count is likewise NULL whenever unkeyed evidence exists.

The `money` array contains `revenue_usd`, `shipping_usd`, and `tax_usd` in that order. Every entry exposes `known_count`, `unknown_count`, `invalid_count`, `conflict_count`, `known_subtotal`, authoritative `value`, and ordered `reasons`. Counts refer to qualified transaction domains on the assigned date. Unkeyed amounts never enter these known qualified subtotals. They remain in raw evidence, because summing them would presume a deduplication identity.

Known finite pieces are aggregated using guarded, scaled FLOAT64 arithmetic. The scale is their maximum absolute value; the query sums value/scale and uses `SAFE_MULTIPLY` to restore the scale. All-known-zero pieces explicitly yield zero without dividing by zero. With no known pieces, the known subtotal is NULL. An unrepresentable or nonfinite derived result keeps both subtotal and total NULL with `numeric_failure`, while preserving the known count. BigQuery documents the [SAFE_MULTIPLY overflow behavior](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/mathematical_functions#safe_multiply) and [FLOAT64 SUM limitations](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/aggregate_functions#sum).

This remains approximate floating arithmetic. Scaling, cancellation, source rounding and aggregate evaluation order can affect low-order bits or discard tiny contributions relative to the scale. No exact financial reconciliation or arbitrary-precision claim is made. Source values are not converted into an invented exact-money type.

The reason array order is `numeric_failure`, `unkeyed_window_evidence`, `conflicting_payload`, `invalid_amount`, `unknown_amount`, including each applicable reason. An empty array means the authoritative value is complete under this observed-window policy. A date with no assigned transactions and no window-wide unkeyed evidence has authoritative zero and NULL known subtotal; a day consisting only of later exact repeats can have that shape. Unknown source values or conflicts never become zero. USD totals are independent of native currencies; there are no native-money aggregates.

## Report shape and accounting

The standalone script returns one row with `result_json`, containing:

- `declaration`: source/scope, both suffix bounds, policy version, exact domain, date-assignment rule, floating USD money basis, unknown timezone and `ga4_ui_parity: false`;
- `daily_summary`: the counts and money entries above, ordered by date;
- `qualified_transactions`: complete qualified domain, assigned date, occurrence/variant/duplicate counts, accepted/conflict status, accepted payload or NULL, all variants with occurrence evidence, and authoritative money entries;
- `item_lines`: accepted offset-qualified lines;
- `unkeyed_evidence`: original incomplete keys, occurrence date/timestamp, selected payload JSON, full selected evidence JSON, occurrence count and ordered missing-key reasons;
- `diagnostics`: window unkeyed flag, all observed/qualified/unkeyed event counts, qualified and all-population unique counts, accepted/conflicting transaction counts, payload-variant count, collapsed duplicates and item-line count.

Missing-key reasons are ordered `missing_platform`, `missing_stream_id`, `missing_user_pseudo_id`, `missing_transaction_id`. Qualified transactions and item lines sort by the complete domain, with items then ordered by offset. Variant order follows payload JSON. Unkeyed records sort by date, the emitted timestamp-micros string and full evidence JSON; the timestamp string is for exact source preservation, and the ordering is explicit. No identity or unique-order count is fabricated for unkeyed records.

The report accounts for every observed purchase occurrence:

```text
observed_purchase_events = qualified_purchase_events + unkeyed_purchase_events
qualified_purchase_events = qualified_payload_variants + collapsed_duplicate_events
qualified_transaction_count = accepted_transaction_count + conflicting_transaction_count
```

There is no final LIMIT. An empty purchase population has empty evidence and daily arrays, zero diagnostic counts and a known zero global unique count. Full report size and BigQuery resource limits still apply; the script is not a production-scale guarantee.

## Schema and execution

Required source fields are `event_date`, `event_timestamp`, `event_name`, `platform`, `stream_id`, `user_pseudo_id`; repeated `event_params.key` and `value.string_value`; ecommerce `transaction_id`, `purchase_revenue_in_usd`, `tax_value_in_usd`, `shipping_value_in_usd`, `purchase_revenue`, `total_item_quantity`, `unique_items`; and repeated item `item_id`, `item_name`, `item_category`, `quantity`, `item_revenue_in_usd`, `item_revenue`. The selected export schema must contain these fields. The script does not fabricate absent nested schema fields.

The SQL contains its helper and all reduction logic and runs after copying without sibling imports. Replace every exact `PROJECT.analytics_PROPERTY_ID` token with the intended property scope. Replace both pairs of `YYYYMMDD` bounds: the table filter and the report declaration. Review the resulting query. For an already substituted file:

```sh
bq --project_id="$BILLING_PROJECT" --location="$BQ_LOCATION" query \
  --use_legacy_sql=false --use_cache=false \
  --maximum_bytes_billed=1073741824 --format=json --max_rows=10000 \
  < /path/to/substituted-ecommerce.sql
```

The cap can reject a large query. The CLI output limit does not reduce bytes scanned. The native synthetic runner below reads no customer datasets and creates only temporary tables.

From the repository root, with Node.js 20 or later:

```sh
node skills/ga4-bigquery-export/scripts/test-ecommerce.mjs
```

This validates nine independently authored full-output fixtures, accounting identities, comparator sensitivity and copied SQL, and explicitly prints **NO SQL EXECUTED**. It is not a JavaScript ecommerce engine. Golden values are literal expected reports, not output generated by executing the producer.

For actual native tests, install and authenticate `bq` and supply the authorized billing context:

```sh
node skills/ga4-bigquery-export/scripts/test-ecommerce.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --report "$HOME/Downloads/ga4-ecommerce-native-evidence.json"
```

Every job is Standard SQL, cache disabled and capped at 1 GiB. The report preserves source/fixture/runner hashes, full submitted query and input/query hashes, job IDs, raw results, parsed outputs, errors, native metadata and bytes. Its output path must be new. The nine full goldens cover domain/date isolation, repeated item lines, contradictory revenue/item payloads, unknown/nonfinite values, missing keys, an earlier unkeyed date, zero/negative/signed/overflow sums and no purchases. Copied standalone SQL, an event-order permutation and two native semantic mutants add four jobs. The mutants recreate unqualified DISTINCT transaction counting and raw-event item fanout; both must fail full expected-output comparison.

Counts, strings, booleans, NULLs and array cardinalities are strict. Only declared floating monetary fields permit relative/absolute tolerance `max(1, abs(expected)) * 1e-12`. Payload/evidence JSON strings are parsed solely to normalize native JSON number encoding and compare every selected field; their contents are not re-deduplicated or otherwise recalculated by a JavaScript oracle. Native raw strings remain preserved in evidence.

A completed byte-identical report can be independently reread without submitting queries:

```sh
node skills/ga4-bigquery-export/scripts/test-ecommerce.mjs \
  --live --project "$BILLING_PROJECT" --location "$BQ_LOCATION" \
  --resume-report "$HOME/Downloads/ga4-ecommerce-native-evidence.json" \
  --report "$HOME/Downloads/ga4-ecommerce-native-recheck.json"
```

Resume rejects changed source, runner, fixture, project, location or query bytes and accepts only verified terminal jobs. Preserve original reports, including failed attempts. A native error must be diagnosed from its saved job and query; an offline definition pass does not resolve it. These bounded synthetic results establish this warehouse policy only, not GA4 UI parity, cross-source person identity or customer-data completeness.

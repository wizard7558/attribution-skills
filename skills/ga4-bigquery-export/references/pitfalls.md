# Pitfalls

Numbered. Each entry: symptom → cause → fix.

## 1. Row count explodes after unnesting event_params or items
**Symptom**: a query that should return one row per event or per session returns many times
more rows, and aggregates (COUNT, SUM) are wrong.
**Cause**: `UNNEST(event_params)` or `UNNEST(items)` produces one row per array element. A
page_view with 15 params becomes 15 rows; a purchase with 4 line items becomes 4 rows.
**Fix**: extract the specific params you need with a correlated subquery or the `param_*`
TEMP FUNCTION helpers (`references/sql/params.sql`) instead of a bare `UNNEST` join when you
only want scalar values. When you do need `UNNEST(items)`, aggregate immediately (GROUP BY
the event/transaction key) rather than carrying the unnested rows further downstream.

## 2. `SELECT *` on a wildcard table
**Symptom**: query scans far more bytes than expected, or times out / hits the byte cap.
**Cause**: `events_*` rows contain deeply nested structs (`items`, `event_params`,
`session_traffic_source_last_click`, etc.); `SELECT *` reads and materializes all of them for
every matched row, across every table the wildcard expands to.
**Fix**: name only the columns and nested fields you need. Never write `SELECT *` against
`events_*`, `events_intraday_*`, or `pseudonymous_users_*`.

## 3. Missing `_TABLE_SUFFIX` filter on a wildcard query
**Symptom**: a query against `events_*` scans the entire export history instead of the
intended window; cost is wildly higher than expected.
**Cause**: `events_*` matches every `events_YYYYMMDD` table in the dataset. Without a
`_TABLE_SUFFIX` predicate, BigQuery has no way to prune tables.
**Fix**: always include `WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'` (or `=` for a
single day) on every wildcard query, and confirm it appears before running.

## 4. Treating `traffic_source` as the session's source
**Symptom**: attribution numbers look flat over time, or every session for a returning user
shows the same source/medium regardless of what channel actually brought them back.
**Cause**: `traffic_source` is user-scoped and set once, at the user's first-ever visit. It
never updates on later sessions.
**Fix**: use `session_traffic_source_last_click` for session-scoped last-click attribution,
or derive your own from the session's landing-page UTMs. Reserve `traffic_source` for
genuine first-touch-ever questions ("what channel originally acquired this user").

## 5. `ga_session_id` collisions across users
**Symptom**: sessionizing on `ga_session_id` alone merges sessions from different people, or
produces impossibly long sessions.
**Cause**: `ga_session_id` is derived from a per-device timestamp and is not guaranteed
globally unique - two different `user_pseudo_id` values can produce the same
`ga_session_id`.
**Fix**: always build the session key from both fields: `CONCAT(user_pseudo_id, '.',
CAST(ga_session_id AS STRING))`. Never key sessions on `ga_session_id` alone.

## 6. NULL `user_pseudo_id`
**Symptom**: a subset of events cannot be joined into any session, and total sessionized
events fall short of total raw events.
**Cause**: consent-mode-restricted traffic (analytics_storage denied) can still emit limited
events without a `user_pseudo_id`. These events cannot be attributed to a user or a session.
**Fix**: filter them out of session/attribution queries explicitly (`WHERE user_pseudo_id IS
NOT NULL`), and report the excluded share separately rather than silently dropping it - see
`references/sql/ui_reconciliation.sql` check 2.

## 7. Late-arriving daily tables
**Symptom**: yesterday's numbers look low compared to a query run a day or two later against
the same date.
**Cause**: `events_YYYYMMDD` can take up to 72 hours to fully land after the day ends.
Querying it too early captures a partial day.
**Fix**: never treat "yesterday" (or the last 1-3 days) as complete. State the lag explicitly
when reporting recent-day numbers, and re-run the query after the lag window before treating
a recent total as final.

## 8. Intraday double counting
**Symptom**: a day's totals are inflated when queried mid-day, then drop the next day.
**Cause**: `events_intraday_YYYYMMDD` holds the current, in-progress day's streaming data. If
a query also matches the not-yet-finalized `events_YYYYMMDD` for that same day (which can
exist in a partial state before intraday is deleted), or if a saved query mixes intraday and
daily ranges without excluding the overlap, the same events can be counted twice.
**Fix**: for historical analysis, only query `events_YYYYMMDD` tables (exclude
`events_intraday_*` from `_TABLE_SUFFIX` wildcards you don't intend to include) and only for
days at least 72 hours old. Use `events_intraday_*` only for genuine same-day, real-time
questions, and don't combine it with the finalized daily table for the same date.

## 9. `event_date` vs. UTC confusion
**Symptom**: a day boundary in a BigQuery query doesn't line up with the same day boundary in
the GA4 UI, or with a UTC-based system you're joining against.
**Cause**: `event_date` (and `_TABLE_SUFFIX`) are assigned in the property's configured
reporting timezone. `event_timestamp` is UTC microseconds, independent of that timezone.
**Fix**: use `event_date` / `_TABLE_SUFFIX` when you want to match what the GA4 UI shows for
"day". Use `TIMESTAMP_MICROS(event_timestamp)` (UTC) when joining against another UTC-based
system or when precise ordering matters. Don't mix the two as if they were interchangeable.

## 10. Purchase duplicates
**Symptom**: `COUNT(*) WHERE event_name = 'purchase'` or `SUM(ecommerce.purchase_revenue)`
overstates revenue compared to the source-of-truth order system.
**Cause**: a single completed transaction can generate more than one `purchase` event in the
raw export (retry behavior, multi-item batching in some implementations).
**Fix**: always dedupe on `ecommerce.transaction_id` before counting or summing - see
`references/sql/ecommerce.sql`. `COUNT(DISTINCT transaction_id)`, not `COUNT(*)`.

## 11. `(not set)` treated as missing/ignorable
**Symptom**: a channel or dimension breakdown silently drops a meaningful slice of traffic,
or a filter like `WHERE source != '(not set)'` removes real sessions.
**Cause**: `(not set)` is GA4's sentinel for "this dimension had no value to report" - it is
not the same as a NULL/missing row, and it can be a large, legitimate share of traffic
(e.g., app installs, some referral-less direct traffic, certain consent states).
**Fix**: classify `(not set)` through the same channel rules as any other value (it usually
lands in `Unassigned` - see `references/channel_rules.md`, and pitfall 15 for why `Direct`
specifically requires reading `cross_channel_campaign`, not `manual_campaign`); don't filter
it out of totals unless the user explicitly wants to exclude unclassified traffic.

## 12. Comparing BigQuery counts to the GA4 UI's HLL-estimated users
**Symptom**: `COUNT(DISTINCT user_pseudo_id)` in BigQuery doesn't match "Users" in the GA4 UI,
even for a clean, fully-landed date range.
**Cause**: the GA4 UI computes distinct-user counts with HyperLogLog++ (an approximate
cardinality estimator), not an exact count. Small differences (typically low single-digit
percent) are expected and not a data-quality bug.
**Fix**: don't chase exact parity on user counts. Confirm the BigQuery number is in the same
ballpark and explain the HLL approximation rather than treating any gap as an error.

## 13. Consent-mode gaps in `privacy_info`
**Symptom**: ad-platform join rates (gclid matches, Google Ads cost joins) are lower than
expected for a subset of traffic, or `collected_traffic_source.gclid` is unexpectedly sparse
for known-paid sessions.
**Cause**: `privacy_info.ads_storage = 'No'` (or the consent signal otherwise restricted)
suppresses ads-related identifiers even when the session was genuinely paid traffic.
**Fix**: check `privacy_info.ads_storage` / `analytics_storage` when a paid-channel join rate
looks abnormally low, and report the consent-restricted share as an explanation rather than
assuming the campaign underperformed.

## 14. Ecommerce revenue in property currency vs. USD
**Symptom**: revenue totals don't match a finance system, or don't match themselves when
re-run - numbers look "close but off" by a currency-conversion-sized amount.
**Cause**: `ecommerce.purchase_revenue` (and the parallel `tax_value` / `shipping_value` /
`refund_value` fields) are in the property's configured currency. The `_in_usd` variants are
GA4's own USD conversion, computed with the exchange rate at transaction time - which will
not exactly match a finance system's own conversion rate or timing.
**Fix**: ask which currency the user wants before choosing a column. Use the bare
(non-`_in_usd`) fields for single-currency properties reporting in their native currency; use
`_in_usd` fields only for cross-currency roll-ups, and caveat that GA4's USD conversion is an
estimate, not a ledger-accurate figure.

## 15. Direct traffic disappears into Unassigned
**Symptom**: `Direct` is missing or under-counted in a rule-based channel breakdown, and
`Unassigned` is inflated instead, even though the property clearly has direct traffic.
**Cause**: reading source/medium from
`session_traffic_source_last_click.manual_campaign.source`/`.medium`. That field pair reads
`(not set)`/`(not set)` for both GA4 `Direct` sessions and GA4 `Unassigned` sessions - there is
no way to tell them apart from `manual_campaign` alone, so a rule ending on `(not set)` ⇒
`Unassigned` silently swallows real Direct sessions too.
**Fix**: read `session_traffic_source_last_click.cross_channel_campaign.source`/`.medium`
instead (`(direct)`/`(none)` for Direct, `(not set)`/`(not set)` for Unassigned), falling back
to `manual_campaign` only when `cross_channel_campaign` is NULL. See
`references/channel_rules.md`.

## 16. Paid social shows up as Organic Social
**Symptom**: Meta, Reddit, or Pinterest paid-traffic sessions land in `Organic Social` instead
of `Paid Social` in a rule-based channel breakdown.
**Cause**: matching `medium` against a short fixed list (`cpc`, `ppc`, `paid`, `sem`) misses
the hyphenated `paid-social` medium these platforms use, so the row falls through to the
source-is-a-social-domain check and is misclassified as organic.
**Fix**: test `medium` with GA4's own paid-medium regex -
`REGEXP_CONTAINS(LOWER(medium), r'^(.*cp.*|ppc|retargeting|paid.*)$')` - before falling
through to the organic-source check, then split the match into Paid Search / Paid Social /
Paid Other by `source`. See `references/channel_rules.md`.

---
name: ga4-bigquery-export
description: Analyze and attribute the raw Google Analytics 4 BigQuery export (events_YYYYMMDD tables). Use when a user asks about GA4 data in BigQuery, event_params, user_pseudo_id, ga_session_id, sessionizing GA4 events, source/medium or channel attribution from GA4, key events, ecommerce revenue from GA4, reconciling BigQuery numbers to the GA4 UI, or controlling BigQuery cost on GA4 exports.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.2.0"
---

# GA4 BigQuery export

## When to use this skill

Use this skill when the user's data source is the raw GA4 BigQuery export: tables named
`events_YYYYMMDD` (and `events_intraday_YYYYMMDD`, `pseudonymous_users_YYYYMMDD`) inside a
dataset named `analytics_<property_id>`. This is one row per event, with nested
`event_params`, `items`, and traffic-source structs - not a pre-aggregated report.

Do not use this skill for:
- The **GA4 Data API** (Reporting API / Admin API responses, or the GA4 UI itself). Those
  return pre-aggregated metrics with GA4's own sessionization, channel grouping, and
  thresholding already applied. This skill is for building those aggregates yourself from
  event-level data.
- **GA4 data that has already been aggregated by an ETL tool** (Fivetran, Stitch, Supermetrics
  connectors that land session- or day-grain tables). Those tables have their own schema and
  their own sessionization logic - read their documentation instead of this skill.

If the user says "GA4 in BigQuery" or references `events_`, `event_params`,
`user_pseudo_id`, or `ga_session_id`, this skill applies.

## Before you query

1. Confirm the dataset id pattern: `analytics_<property_id>` (e.g.
   `analytics_PROPERTY_ID`). Ask for the project and dataset id if not given.
2. List tables to learn what exists and the date range before writing SQL:
   `bq ls PROJECT:analytics_PROPERTY_ID`. Expect:
   - `events_YYYYMMDD` - one per day, the daily export. This is what almost every query in
     this skill targets.
   - `events_intraday_YYYYMMDD` - streaming, partial-day data for the current day only.
     Deleted once the corresponding daily table lands. Do not assume it exists; check.
   - `pseudonymous_users_YYYYMMDD` - daily, consent-mode-safe user-scope data. Commonly
     present. Not covered by the reference SQL in this skill.
   - `users_YYYYMMDD` - only present if the property has User-ID export enabled. Do not
     assume it exists.
3. Daily tables can take up to 72 hours to fully land. Never treat the most recent 1-3 days
   as complete - say so explicitly whenever you report numbers for recent days.
4. Always filter `_TABLE_SUFFIX` on any wildcard (`events_*`) query. An unfiltered wildcard
   scans the entire export history.
5. Never write `SELECT *` against `events_*` or `events_intraday_*` - these rows carry
   deeply nested structs (`items`, `event_params`, `session_traffic_source_last_click`) that
   are expensive to materialize in full.
6. Set a bytes cap on every query: `--maximum_bytes_billed` on the `bq` CLI, or
   `maximumBytesBilled` in the API/client library. Dry-run (`--dry_run` or
   `dryRun: true`) before running anything over a one-week window.
7. `event_params` is a repeated field. `UNNEST(event_params)` multiplies rows - extract the
   specific params you need (see section 3) and aggregate after, not before.

## The mental model

One row per event. GA4 does not store a flat schema of dimensions - most of what you need is
inside nested structs and the `event_params` array.

`event_params` is `ARRAY<STRUCT<key STRING, value STRUCT<string_value, int_value,
float_value, double_value>>>`. For any given key, exactly one of the four `value` fields is
populated; the rest are NULL. Two idioms for pulling a param out as a column:

```sql
-- Correlated subquery: simple, one param per line
(SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
```

```sql
-- TEMP FUNCTION helper: define once, reuse for every param in the query
CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
-- ... param_string(event_params, 'page_location')
```

Full runnable versions of both, plus `param_int` and `param_number` variants, are in
`references/sql/params.sql`.

Timestamps: `event_timestamp` and `event_previous_timestamp` are microseconds since epoch,
UTC - wrap in `TIMESTAMP_MICROS()`. `event_date` (and `_TABLE_SUFFIX`) are in the property's
reporting timezone. Use `event_date` when you need to match what the GA4 UI shows for a
given day; use `TIMESTAMP_MICROS(event_timestamp)` when you need true UTC ordering or are
joining to another UTC-based system. See `references/pitfalls.md` #9.

## Sessions

There is no session id column in the export. Build one:

```sql
CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING))
```

Never key a session on `ga_session_id` alone - it is not guaranteed unique across users (see
`references/pitfalls.md` #5). `ga_session_number` distinguishes new vs. returning: `= 1` is a
new session for that user.

An **engaged session** is GA4's own definition: a session that lasted longer than 10
seconds, OR had a key event, OR had 2 or more page views. The export carries GA4's own
engaged-session flag as the `session_engaged` event param, equal to `'1'` on events in an
engaged session. Reconstruct it as:

```sql
(COALESCE(LOGICAL_OR(session_engaged = '1'), FALSE)
  OR COALESCE(SUM(engagement_time_msec), 0) >= 10000
  OR COUNTIF(event_name = 'page_view') >= 2
  OR COUNTIF(event_name IN UNNEST(key_event_names)) > 0) AS engaged
```

`is_active_user` is a user-scoped flag (was this user active per GA4's activity
definition at event time) - it is not part of the engaged-session definition.

Sessions can span midnight - the same `session_key` can have events in two different
`event_date` (and `_TABLE_SUFFIX`) tables. Aggregate across adjacent daily tables when
sessionizing, not one table at a time.

Some events have a NULL `user_pseudo_id` (consent-restricted traffic). These cannot be
sessionized. Filter them out of session-grain queries explicitly and report the excluded
share separately - do not silently drop them without mentioning it. See
`references/sql/ui_reconciliation.sql` and `references/pitfalls.md` #6.

Full sessionization query, with landing/exit pages, engagement, and session-level
source/medium: `references/sql/sessions.sql`.

## Four traffic-source structures - which to use

| Structure | Scope | Use for |
|---|---|---|
| `traffic_source.*` | User, first touch ever | Never for session attribution. Only for "what channel originally acquired this user." |
| `collected_traffic_source.*` | Event, raw as-collected | Click-ID joins to ad platforms (`gclid`, `dclid`, `srsltid`) and manual UTM params (`manual_source`, `manual_medium`, etc.). Populated only on the events that actually carried these params. |
| `session_traffic_source_last_click.*` | Session, GA4-computed last-non-direct click | Closest match to what the GA4 UI shows as session source/medium. Read the whole `cross_channel_campaign` evidence struct (use the whole manual struct only when all cross-channel evidence fields are NULL); use `cross_channel_campaign.default_channel_group` for GA4's own channel label. `manual_campaign` alone cannot tell Direct from Unassigned - see "Channel grouping" below. Verify exact nested field names against `references/schema.md` - the struct has six platform-specific sub-structs, not one flat source/medium. |
| Derived from the session's first `page_location` | Session, your own logic | First-touch questions at `ga_session_number = 1`, or when you need a click ID (`fbclid`, `ttclid`, `gbraid`, `wbraid`, etc.) that has no dedicated export column and only ever appears in the URL. |

Precedence rule: default to `session_traffic_source_last_click` when the goal is parity with
the GA4 UI. Default to `collected_traffic_source` plus URL parsing when the goal is joining
to ad-platform click IDs. Use the first event of `ga_session_number = 1` when the goal is
first-touch, not last-click.

`collected_traffic_source` has dedicated columns for `gclid`, `dclid`, and `srsltid` only -
`gbraid`, `wbraid`, `fbclid`, `ttclid`, and every other click ID exist solely as URL query
params on `page_location`, never as struct fields. See `references/schema.md` for the full
verified field list and `references/sql/traffic_source_compare.sql` for a query that shows
how often the last-click struct and a naive UTM parse disagree.

## Channel grouping

Use native `default_channel_group` for GA4 UI audits and the shared canonical `channel`
for cross-source work. Both session and daily templates embed the same versioned classifier,
so an installed GA4 skill works standalone. Read [channel rules](references/channel_rules.md)
and the local [shared contract](references/channel-contract.md) before joining another source.

The exact 11 canonical labels are `Paid Search`, `Paid Social`, `Paid Other`, `Organic Search`,
`Organic Social`, `Email`, `SMS`, `Direct`, `Referral`, `Affiliate`, and `Other`.
Paid click IDs override conflicting email/native labels. `dclid` maps to `Paid Other`;
unknown evidence maps to `Other`. Native `Unassigned`, `Display`, and `Affiliates` remain
available as raw labels, separate from the canonical buckets.

Both templates choose source, medium, campaign, and native label from one ordered evidence
struct. Click signals and referrer come from the first landing event only, with the first
observed event used when no page URL exists. Later clicks do not change the session channel.
All 12 paid click IDs plus `srsltid` survive in `click_ids`; `srsltid` alone is not paid.

## Key events and conversions

The export has no "is key event" flag. Define key events as an explicit `event_name IN
(...)` list agreed with the user - see `references/sql/key_events.sql`, which takes the list
as a `DECLARE`d array you edit per engagement.

`purchase` revenue lives in `ecommerce.purchase_revenue` (property currency) and
`ecommerce.purchase_revenue_in_usd` (GA4's USD conversion). Dedupe purchases on
`ecommerce.transaction_id` before summing - a transaction can generate more than one
`purchase` event. Item-level detail is in the `items` array; `UNNEST(items)` for item-level
analysis (aggregate immediately after). Full pattern: `references/sql/ecommerce.sql`.

## Reconciling to the GA4 UI

Expect small, explainable mismatches between BigQuery and the GA4 UI:

- The UI's user counts are HyperLogLog++ approximations, not exact distinct counts.
- The UI applies thresholding and can report `(not set)` differently than a raw export
  breakdown.
- The UI can include modeled/behavioral-modeling data (for consent-gapped traffic) that the
  raw export does not carry.
- Session counts differ when sessions cross midnight and you sum single-day tables instead
  of aggregating across days.
- The UI's Sessions metric is an approximate distinct count of session ids. Even with the
  correct session key, expect small differences.
- Intraday vs. daily table differences during the 72-hour landing window.
- `event_date` (property timezone) vs. UTC timestamp differences.

Before claiming a real discrepancy, run the three checks in
`references/sql/ui_reconciliation.sql`: (1) daily-table completeness/lag for the window, (2)
NULL `user_pseudo_id` share, (3) share of sessions crossing midnight.

## Cost and safety checklist

- [ ] `_TABLE_SUFFIX` bounded on every wildcard query.
- [ ] No `SELECT *`.
- [ ] Bytes cap set (`--maximum_bytes_billed` / `maximumBytesBilled`).
- [ ] Dry-run first for anything over a one-week window.
- [ ] Param extraction done before aggregation, not via a bare `UNNEST` join carried through
      the whole query.
- [ ] Recent-day (last 1-3 days) numbers explicitly caveated as possibly incomplete.

## Outputs to produce

For downstream attribution work, materialize two shapes rather than re-querying raw events
each time:

**`sessions`** (one row per `session_key`): existing timing, engagement, landing/exit,
source/medium/campaign, raw `default_channel_group`, and landing-click aliases, plus canonical
`channel`, `taxonomy_version`, `source_system`, `source_scope`, `visitor_key`,
`attribution_basis`, `event_date` (DATE), `reporting_timezone`, `date_basis`, structured
`click_ids`, and `key_events`. See `references/sql/sessions.sql`.

**`channel_daily`** (one row per `source_system, source_scope, event_date, channel`):
`sessions`, `engaged_sessions`, `new_users`, `key_events`, native `purchases`,
`purchase_revenue_usd`, `revenue_status`, `purchase_events_without_transaction_id`, `currency`, version and attribution/date metadata.
Daily native labels now use `native_channel_groups` ARRAY instead of scalar
`default_channel_group`; do not unnest the array and duplicate daily metrics.

`new_users` is the source-native first-session count. GA4 session-last-click and pixel
first-touch bases remain explicit; their visitor keys are source-scoped, and overlapping
session populations must not be summed. GA4 purchase revenue remains distinct from pixel
conversion value. Deduped purchases aggregate per session before the daily join; any unkeyed purchase or unknown
purchase amount makes the aggregate revenue NULL, while no purchase events gives zero. Read the
[channel rules](references/channel_rules.md) for exact transaction dedupe, metric, date,
and boundary semantics. The templates leave `reporting_timezone` NULL until the actual
property timezone is supplied and assign sessions to their first observed property-local date.

## References

- `references/schema.md` - full verified column reference, grouped by area, derived from the
  live GA4 BigQuery export schema.
- `references/channel_rules.md` - the channel-grouping rule table, social-source list,
  search-engine list, and click-ID → platform map.
- `references/pitfalls.md` - 16 numbered pitfalls (symptom → cause → fix).
- `references/eval.md` - 3 evaluation prompts with pass/fail checklists for reviewing agent
  behavior with and without this skill.
- `references/sql/params.sql` - the two param-extraction idioms plus TEMP FUNCTION helpers.
- `references/sql/sessions.sql` - full sessionization query.
- `references/sql/traffic_source_compare.sql` - compares session last-click vs. derived UTM
  attribution for one window.
- `references/sql/channel_daily.sql` - canonical source/date/channel grain with native-label audit array.
- `references/sql/key_events.sql` - key events per session with an editable event-name list.
- `references/sql/ecommerce.sql` - deduped purchases plus item-level unnest example.
- `references/sql/ui_reconciliation.sql` - the three UI-reconciliation sanity checks.
- `references/sql/landing_pages.sql` - landing page × sessions × engagement × key events.
- `scripts/run_checks.sh` - substitutes placeholders into every file in `references/sql/` and
  runs them against a real dataset with `bq query`, printing pass/fail per file.

- `scripts/test-integration.mjs` - local generated-UDF fixtures; `--bigquery` executes both
  actual templates using synthetic nested GA4 events only, temporary tables, and a 20 MiB cap.
- `scripts/session-ctes.sql` - shared session reduction source; in the repository regenerate
  marked blocks with `node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository`.
- `scripts/test-artifacts.mjs` - repository-only generator regression: standalone isolation
  and drift detection for all six generated artifacts; it uses temporary copies only.

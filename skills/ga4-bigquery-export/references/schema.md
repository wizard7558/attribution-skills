# GA4 BigQuery export schema reference

Derived from the live schema of two real GA4 BigQuery export datasets (`bq show --schema`
against `events_YYYYMMDD` tables), not from memory. Column names, types, and nesting below
are verified. Only the columns that matter for analysis and attribution are covered; a small
number of low-signal fields (`app_info`, most of `device.web_info`) are listed but not
elaborated.

Every table is one row per event. `event_params`, `user_properties`, and `items` are repeated
(array) fields; everything else nested is a single `RECORD` (struct), possibly `NULLABLE`.

## Event core

| Column | Type | Notes |
|---|---|---|
| `event_date` | STRING | `YYYYMMDD`, in the property's reporting timezone. Use for day-level grouping and for matching the GA4 UI's day boundaries. |
| `event_timestamp` | INTEGER | Microseconds since epoch, UTC. Wrap in `TIMESTAMP_MICROS()` for real timestamps. Use for ordering events and for anything timezone-sensitive. |
| `event_name` | STRING | e.g. `page_view`, `purchase`, `session_start`, `first_visit`. |
| `event_previous_timestamp` | INTEGER | Microseconds, UTC. Timestamp of the previous occurrence of this event for the user. |
| `event_value_in_usd` | FLOAT | Event-level value in USD, when the event carries a `value` param. |
| `event_bundle_sequence_id` | INTEGER | Ordering within an upload batch. Not a unique event id. |
| `event_server_timestamp_offset` | INTEGER | Microseconds; offline-event correction offset. |
| `event_original_occurrence_timestamp` | INTEGER | Microseconds, UTC. Present in the live schema; not universally documented. Populated for events GA4 has redated (e.g. reprocessed or backfilled events); usually NULL. |
| `is_active_user` | BOOLEAN | Whether the user was active per GA4's activity definition at event time. User-scoped, not session-scoped - it is not part of GA4's engaged-session definition (see SKILL.md Sessions section). |
| `batch_event_index`, `batch_page_id`, `batch_ordering_id` | INTEGER | Upload-batch bookkeeping. Rarely needed for analysis. |
| `stream_id` | STRING | Data stream id (web/app stream this event came from). |
| `platform` | STRING | `WEB`, `IOS`, `ANDROID`. |

## event_params (REPEATED RECORD)

```
event_params: ARRAY<STRUCT<
  key STRING,
  value STRUCT<
    string_value STRING,
    int_value INT64,
    float_value FLOAT64,
    double_value FLOAT64
  >
>>
```

Exactly one of `string_value` / `int_value` / `float_value` / `double_value` is populated per
key; the others are NULL. See `references/sql/params.sql` for extraction idioms. Verified
keys present in real event_params data include (not exhaustive, GA4 default + common
site-specific params): `page_location`, `page_path`, `page_referrer`, `page_title`,
`ga_session_id`, `ga_session_number`, `session_engaged`, `engagement_time_msec`, `entrances`,
`source`, `medium`, `campaign`, `campaign_id`, `term`, `content`, `source_platform`, `gclid`,
`srsltid`, `gad_campaignid`, `gad_source`, `transaction_id`, `currency`, `value`, `shipping`,
`tax`, `search_term`, `file_name`, `file_extension`, `link_url`, `link_domain`, `link_text`,
`link_classes`, `outbound`, `video_title`, `video_provider`, `video_percent`,
`video_current_time`, `video_duration`, `form_id`, `form_name`, `form_destination`,
`debug_mode`, `ignore_referrer`, `firebase_event_origin`, `firebase_conversion`. Sites also
add custom params (product-catalog ids, experiment/variant ids, etc.) - always run a
`SELECT DISTINCT key FROM ..., UNNEST(event_params)` on a small window before assuming a key
exists for a given property.

## User

| Column | Type | Notes |
|---|---|---|
| `user_id` | STRING | App-assigned user id, when set via `setUserId`. Often NULL. |
| `user_pseudo_id` | STRING | GA4's own device/client id (roughly the `client_id` cookie value plus a stream-scoped suffix). Present on nearly all events for a web property with default consent; NULL for events collected without the required consent signal. Never assume it is always present - check the null rate (`references/sql/ui_reconciliation.sql`, check 2). |
| `user_first_touch_timestamp` | INTEGER | Microseconds, UTC. First time GA4 ever saw this user_pseudo_id. |
| `privacy_info` | RECORD | `analytics_storage`, `ads_storage`, `uses_transient_token` - all STRING (e.g. `'Yes'`/`'No'`). Consent-mode signals; low `ads_storage = 'Yes'` share explains gaps in Google Ads click-ID coverage. |
| `user_properties` | REPEATED RECORD | Same key/value struct shape as `event_params`, plus `value.set_timestamp_micros`. Custom user-scoped properties. |
| `user_ltv` | RECORD | `revenue` (FLOAT), `currency` (STRING). Lifetime value as GA4 computes it; rarely needed for period-bound analysis. |

## Device / geo

| Column | Type | Notes |
|---|---|---|
| `device.category`, `device.mobile_brand_name`, `device.mobile_model_name`, `device.mobile_marketing_name`, `device.mobile_os_hardware_model`, `device.operating_system`, `device.operating_system_version`, `device.vendor_id`, `device.advertising_id`, `device.language`, `device.is_limited_ad_tracking`, `device.time_zone_offset_seconds`, `device.browser`, `device.browser_version` | mixed | Standard device dimensions. |
| `device.web_info.browser`, `.browser_version`, `.hostname` | STRING | Web-specific; `hostname` is the page hostname reported by the browser. |
| `geo.city`, `geo.country`, `geo.continent`, `geo.region`, `geo.sub_continent`, `geo.metro` | STRING | IP-derived geo. Can be `(not set)`. |
| `app_info.id`, `.version`, `.install_store`, `.firebase_app_id`, `.install_source` | STRING | App-stream only; NULL/absent behavior on web-only properties. |
| `event_dimensions.hostname` | STRING | Event-level hostname (distinct from `device.web_info.hostname`; both exist in the schema). |

## Traffic sources - four separate structures

See SKILL.md section 5 for when to use which. Field-level detail:

### `traffic_source` (user-scoped, first touch, NULLABLE RECORD)
```
traffic_source: STRUCT<name STRING, medium STRING, source STRING>
```
Set once, from the user's first-ever visit, and does not change on later sessions. Never use
for session- or event-level attribution.

### `collected_traffic_source` (event-scoped, raw, NULLABLE RECORD)
```
collected_traffic_source: STRUCT<
  manual_campaign_id STRING,
  manual_campaign_name STRING,
  manual_source STRING,
  manual_medium STRING,
  manual_term STRING,
  manual_content STRING,
  manual_source_platform STRING,
  manual_creative_format STRING,
  manual_marketing_tactic STRING,
  gclid STRING,
  dclid STRING,
  srsltid STRING
>
```
Populated on the specific events that actually carried these params (typically the landing
event of a session with tagged traffic), not backfilled onto every event in the session.
Correction versus a common assumption: this struct has only `gclid`, `dclid`, and `srsltid`
as dedicated click-ID fields. There are no separate `gbraid`, `wbraid`, `fbclid`, `ttclid`,
`li_fat_id`, `rdt_cid`, `msclkid`, `twclid`, `epik`, or `sccid` columns anywhere in the
export. When you need those, parse them out of `page_location` (or `event_params` key
`page_location`) with `REGEXP_EXTRACT` - see `references/channel_rules.md` and
`references/sql/sessions.sql`.

### `session_traffic_source_last_click` (session-scoped, GA4-computed last-non-direct click, NULLABLE RECORD)
```
session_traffic_source_last_click: STRUCT<
  manual_campaign STRUCT<
    campaign_id STRING, campaign_name STRING, source STRING, medium STRING,
    term STRING, content STRING, source_platform STRING, creative_format STRING,
    marketing_tactic STRING
  >,
  google_ads_campaign STRUCT<
    customer_id STRING, account_name STRING, campaign_id STRING, campaign_name STRING,
    ad_group_id STRING, ad_group_name STRING
  >,
  cross_channel_campaign STRUCT<
    campaign_id STRING, campaign_name STRING, source STRING, medium STRING,
    source_platform STRING, default_channel_group STRING, primary_channel_group STRING
  >,
  sa360_campaign STRUCT<... source, medium, campaign_id, campaign_name, ad_group_id,
    ad_group_name, creative_format, engine_account_name, engine_account_type,
    manager_account_name ...>,
  cm360_campaign STRUCT<... source, medium, campaign_id, campaign_name, account_id,
    account_name, advertiser_id, advertiser_name, creative_id, creative_format,
    creative_name, placement_id, placement_name, ... ...>,
  dv360_campaign STRUCT<... source, medium, campaign_id, campaign_name, advertiser_id,
    advertiser_name, creative_id, creative_format, creative_name, exchange_id,
    exchange_name, insertion_order_id, insertion_order_name, line_item_id, line_item_name,
    partner_id, partner_name ...>
>
```
This is the closest match to the source/medium the GA4 UI shows for a session. There is no
single flat `source`/`medium` at the top of this struct - use `cross_channel_campaign.source` /
`cross_channel_campaign.medium` for the general case (falling back to `manual_campaign.source`
/ `.medium` when NULL), or the platform-specific sub-struct (`google_ads_campaign`,
`sa360_campaign`, `cm360_campaign`, `dv360_campaign`) when the session's last click came from
that platform's integration and you need platform-specific ids (customer_id, ad_group_id,
etc.). `manual_campaign.source`/`.medium` read `(not set)`/`(not set)` for both GA4 `Direct`
sessions and GA4 `Unassigned` sessions and cannot tell the two apart on their own;
`cross_channel_campaign.source`/`.medium` read `(direct)`/`(none)` for `Direct` and
`(not set)`/`(not set)` for `Unassigned`, so that field pair is what actually distinguishes
them - see `references/channel_rules.md`. `cross_channel_campaign.default_channel_group` is
the export's own channel grouping for that session - the only place a channel-group label
exists in the raw export (see SKILL.md section 6 and `references/channel_rules.md`).

### Deriving your own (from `page_location`)
Parse `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `utm_content` and click IDs
(`gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `li_fat_id`, `rdt_cid`, `msclkid`, `twclid`,
`epik`, `sccid`) directly from the landing page URL with `REGEXP_EXTRACT`. Necessary when you
need first-touch attribution at `ga_session_number = 1`, or when reconciling against a click
ID that only ever lands in the URL, not in `collected_traffic_source`.

## Ecommerce

```
ecommerce: STRUCT<
  total_item_quantity INT64,
  purchase_revenue_in_usd FLOAT64,
  purchase_revenue FLOAT64,
  refund_value_in_usd FLOAT64,
  refund_value FLOAT64,
  shipping_value_in_usd FLOAT64,
  shipping_value FLOAT64,
  tax_value_in_usd FLOAT64,
  tax_value FLOAT64,
  unique_items INT64,
  transaction_id STRING
>
```
`purchase_revenue` / `refund_value` / `shipping_value` / `tax_value` are in the property's
configured currency; the `_in_usd` variants are GA4's USD conversion at transaction time. Use
`_in_usd` for cross-property or cross-currency comparisons; use the bare fields when the
property is single-currency and you want the currency users actually paid in. Dedupe
purchases on `transaction_id` - a `purchase` event can appear more than once per transaction
in raw export data (retries, multi-item batch behavior).

## Items (REPEATED RECORD)

```
items: ARRAY<STRUCT<
  item_id STRING, item_name STRING, item_brand STRING, item_variant STRING,
  item_category STRING, item_category2 STRING, item_category3 STRING,
  item_category4 STRING, item_category5 STRING,
  price_in_usd FLOAT64, price FLOAT64, quantity INT64,
  item_revenue_in_usd FLOAT64, item_revenue FLOAT64,
  item_refund_in_usd FLOAT64, item_refund FLOAT64,
  coupon STRING, affiliation STRING, location_id STRING,
  item_list_id STRING, item_list_name STRING, item_list_index STRING,
  promotion_id STRING, promotion_name STRING,
  creative_name STRING, creative_slot STRING,
  item_params ARRAY<STRUCT<key STRING, value STRUCT<string_value, int_value, float_value, double_value>>>
>>
```
`UNNEST(items)` multiplies rows - one row per item per event. Aggregate immediately after
unnesting for anything beyond a raw item-level pull. `item_params` carries custom item-scoped
params in the same key/value shape as `event_params`.

## Publisher (AdSense/AdMob monetization; low relevance for attribution)

```
publisher: STRUCT<
  ad_revenue_in_usd FLOAT64, ad_format STRING, ad_source_name STRING, ad_unit_id STRING
>
```

## Non-events tables (present alongside `events_YYYYMMDD`)

- `pseudonymous_users_YYYYMMDD` - one table per day, confirmed present on both datasets
  checked for this skill, full date range. Carries consent-mode-safe, pseudonymous user-scope
  data (audiences, predictions, user properties) separate from the event stream. Not covered
  by the reference SQL in this skill; mentioned here because you will see it when you list
  dataset tables.
- `users_YYYYMMDD` - not present on either dataset checked. Only appears when the property
  has User-ID-based user-scope export enabled; do not assume it exists.
- `events_intraday_YYYYMMDD` - not present on either dataset at test time (both datasets'
  most recent daily table had already landed). Streaming, partial-day data; deleted once the
  corresponding `events_YYYYMMDD` daily table lands. Only ever exists for the current, not-
  yet-finalized day.

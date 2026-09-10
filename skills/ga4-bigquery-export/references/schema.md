# Schema prerequisites for the shipped reports

This is the selected input contract of the eight current SQL files, not a claim that every GA4 export has the same schema. Inspect actual table metadata and validate the intended wildcard query before execution. A missing nested field is a schema incompatibility; a present field with a NULL value is data handled by the report's policy. Current live compatibility evidence covers only the bounded sources in [verification status](verification-status.md).

Google maintains the [full export schema](https://support.google.com/analytics/answer/7029846). Fields outside the selected contract below are not implicitly consumed or interpreted by this skill. BigQuery metadata names `INTEGER` and `FLOAT` correspond to SQL `INT64` and `FLOAT64`.

## Selected scalar and parameter inputs

| Field | SQL type | Current use |
| --- | --- | --- |
| `event_date` | STRING | Parsed property date; separate from UTC ordering |
| `event_timestamp` | INT64 | Ordering and `TIMESTAMP_MICROS` in reports that use time |
| `event_name` | STRING | Page-view, purchase and configured key-event filters |
| `user_pseudo_id` | STRING | Source-native visitor evidence; nullable |
| `event_value_in_usd` | FLOAT64 | Passed through only by the raw key-event sample |
| `platform`, `stream_id` | STRING | Ecommerce transaction qualification; not used by session reduction |

Google documents `event_timestamp` as UTC microseconds when Analytics received the event, with possible timestamp ties. `event_date` is the registered-timezone date. The SQL uses those supplied values; it does not infer a property timezone, upload correction or unique event identity from them. [Export field definitions](https://support.google.com/analytics/answer/7029846).

The supported typed parameter shape is:

```sql
event_params ARRAY<STRUCT<
  key STRING,
  value STRUCT<
    string_value STRING,
    int_value INT64,
    float_value FLOAT64,
    double_value FLOAT64
  >
>>
```

The invoked helper determines which value fields must exist: string extraction needs `string_value`, integer extraction needs `int_value`, and numeric extraction needs all three numeric fields. Additional parameter fields are allowed. Do not assume keys are unique or exactly one typed field is populated. Google currently describes `float_value` as unused in standard exports; the numeric helper still supports supplied values. [Typed parameter fields](https://support.google.com/analytics/answer/7029846).

The first matching parameter by original offset wins, even when its selected typed field is NULL. The numeric helper applies `COALESCE(float_value, double_value, CAST(int_value AS FLOAT64))` only within that record. Strings are not parsed as numbers. See the [parameter authority](../scripts/parameter-helpers.sql) and [diagnostic contract](parameter-diagnostic-contract.md).

| Selected key | Selected field | Reports |
| --- | --- | --- |
| `ga_session_id` | `int_value` | Session family, raw samples, UI observations |
| `ga_session_number` | `int_value` | Session family |
| `page_location`, `page_referrer`, `session_engaged` | `string_value` | Session family; params uses location and engaged |
| `engagement_time_msec` | `int_value` | Session-family engagement proxy |
| `engagement_time_msec` | Numeric helper within first record | Raw params helper array only |
| `currency` | `string_value` | Ecommerce payload evidence, using its own first-offset subquery |

A double-only engagement value can appear in the raw numeric sample while remaining NULL for the session family's integer helper. That is an explicit difference between diagnostic extraction and session measurement.

## Session-family nested dependencies

[sessions.sql](sql/sessions.sql), [channel_daily.sql](sql/channel_daily.sql), [landing_pages.sql](sql/landing_pages.sql) and [traffic_source_compare.sql](sql/traffic_source_compare.sql) all embed the same session reduction and require these selected fields:

```sql
collected_traffic_source STRUCT<
  gclid STRING, dclid STRING, srsltid STRING
>
session_traffic_source_last_click STRUCT<
  cross_channel_campaign STRUCT<
    source STRING, medium STRING, campaign_name STRING,
    default_channel_group STRING
  >,
  manual_campaign STRUCT<
    source STRING, medium STRING, campaign_name STRING
  >
>
ecommerce STRUCT<
  transaction_id STRING, purchase_revenue_in_usd FLOAT64
>
```

These are projections of larger structs; other fields may exist. The landing and traffic companions inherit the shared dependencies even when their final SELECT does not expose purchase fields.

`traffic_source` is documented as user-acquisition evidence, `collected_traffic_source` as event-carried evidence, and `session_traffic_source_last_click` as attributed session evidence. Those scopes are different. The SQL does not read user-acquisition fields or flatten platform-specific campaign structs into arbitrary source/medium pairs. [Google source definitions](https://support.google.com/analytics/answer/7029846).

For each event, the selected cross-channel struct wins when any of its four consumed fields is non-NULL; otherwise the same event's manual struct is selected. The first nonempty selected struct across the observed session wins with a deterministic tie-break. Partial pairs are preserved, not backfilled.

The collected fields used as click signals are exactly `gclid`, `dclid` and `srsltid`. Other supported click signals come from the chosen landing URL through the embedded canonical parser. Do not assume those signals have dedicated columns; verify custom schema extensions separately. The templates do not scan arbitrary custom parameters for them. [Channel rules](channel_rules.md) define the exact retained fields and precedence.

## Ecommerce input projection

[ecommerce.sql](sql/ecommerce.sql) adds `platform`, `stream_id`, the currency parameter and these selected nested fields:

```sql
ecommerce STRUCT<
  transaction_id STRING,
  purchase_revenue_in_usd FLOAT64,
  tax_value_in_usd FLOAT64,
  shipping_value_in_usd FLOAT64,
  purchase_revenue FLOAT64,
  total_item_quantity INT64,
  unique_items INT64
>
items ARRAY<STRUCT<
  item_id STRING, item_name STRING, item_category STRING,
  quantity INT64,
  item_revenue_in_usd FLOAT64,
  item_revenue FLOAT64
>>
```

The `_in_usd` fields are USD values; native fields are retained separately. The source schema uses FLOAT64, so do not promise exact decimal finance reconciliation or invent an exchange-rate timing rule. Google lists native purchase/item revenue in local currency. [Ecommerce field definitions](https://support.google.com/analytics/answer/7029846).

Original item array offsets become item-line identity. Only one nonconflicting accepted transaction payload produces authoritative lines. Native currency/revenue, ordered items and NULLs participate in whole-payload conflict comparison. [Ecommerce contract](ecommerce-contract.md).

## Raw diagnostic dependencies and populations

| Query | Selected source dependencies | Population |
| --- | --- | --- |
| `params.sql` | Date, timestamp, name, visitor, typed parameters | Raw page views, including missing visitor/session IDs |
| `key_events.sql` | Same scalar core, integer session parameter, `event_value_in_usd` | Configured raw occurrences, excluding NULL visitor/selected session IDs |
| `ui_reconciliation.sql` | Daily suffix, event date, visitor, integer session parameter | All observed rows for row/identifier diagnostics; present IDs only for date spans |

The UI date spine comes from the rendered literal date window. `_TABLE_SUFFIX` is a BigQuery pseudocolumn, not a stored schema field. Zero observed rows do not establish whether a daily table exists.

`privacy_info`, `user_id`, `user_properties`, `user_ltv`, device/geo fields, and user-scope tables are not read by these reports. Do not infer consent, a cross-device subject bridge, a lifetime value or a client-ID string format from a NULL/present `user_pseudo_id`. Optional investigations of those fields require their own documented schema and population.

## Table and transport boundaries

The wrapper targets daily suffixes only. Google documents optional streaming intraday tables separately; their lifecycle is not a reason to union them into these queries. User-scope exports are outside this report family. [Export table documentation](https://support.google.com/analytics/answer/7029846).

Native API pages preserve schema and raw cells. The current wrapper decodes nested/repeated/null values while retaining INT64, NUMERIC, BIGNUMERIC and TIMESTAMP as strings. TIMESTAMP uses exact microseconds via the official [DataFormatOptions](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/DataFormatOptions). This differs from older fixture runners' CLI timestamp display; those historical observations are not the current wrapper's representation.

Read the [execution contract](export-execution-contract.md) for required runtimes, metadata access, validated rendering, cap enforcement and complete result pagination. Missing schema must be resolved before making a compatible-output claim; do not silently add NULL columns to make a different export look supported.

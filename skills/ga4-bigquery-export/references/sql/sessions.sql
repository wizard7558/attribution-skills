-- Returns: one row per session (session_key) with session-grain attributes:
-- timing, engagement, landing/exit pages, and session-level source/medium
-- from session_traffic_source_last_click, plus click IDs parsed from the
-- landing page URL. Building block for channel_daily.sql and downstream
-- attribution skills.
-- Scan scale: one full pass over event_params plus the three struct columns
-- for every event in the window; on a mid-size ecommerce property this is
-- roughly 1-3 GB per week of data. Always bound _TABLE_SUFFIX.

CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

WITH base AS (
  SELECT
    user_pseudo_id,
    param_int(event_params, 'ga_session_id') AS ga_session_id,
    param_int(event_params, 'ga_session_number') AS ga_session_number,
    event_name,
    event_timestamp,
    param_string(event_params, 'page_location') AS page_location,
    param_string(event_params, 'page_referrer') AS page_referrer,
    param_string(event_params, 'session_engaged') AS session_engaged,
    param_int(event_params, 'engagement_time_msec') AS engagement_time_msec,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.source,
      session_traffic_source_last_click.manual_campaign.source
    ) AS stls_source,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.medium,
      session_traffic_source_last_click.manual_campaign.medium
    ) AS stls_medium,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.campaign_name,
      session_traffic_source_last_click.manual_campaign.campaign_name
    ) AS stls_campaign,
    session_traffic_source_last_click.cross_channel_campaign.default_channel_group AS stls_channel_group
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
),
keyed AS (
  SELECT
    CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING)) AS session_key,
    *
  FROM base
  WHERE ga_session_id IS NOT NULL
),
paged AS (
  SELECT
    *,
    FIRST_VALUE(page_location IGNORE NULLS) OVER (PARTITION BY session_key ORDER BY event_timestamp ASC) AS landing_page_location,
    FIRST_VALUE(page_referrer IGNORE NULLS) OVER (PARTITION BY session_key ORDER BY event_timestamp ASC) AS first_referrer,
    LAST_VALUE(page_location IGNORE NULLS) OVER (
      PARTITION BY session_key ORDER BY event_timestamp ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS exit_page_location
  FROM keyed
)
SELECT
  session_key,
  ANY_VALUE(user_pseudo_id) AS user_pseudo_id,
  ANY_VALUE(ga_session_id) AS ga_session_id,
  MAX(ga_session_number) AS ga_session_number,
  MAX(ga_session_number) = 1 AS is_new_user,
  TIMESTAMP_MICROS(MIN(event_timestamp)) AS session_start_ts,
  TIMESTAMP_MICROS(MAX(event_timestamp)) AS session_end_ts,
  COUNTIF(event_name = 'page_view') AS pageviews,
  COUNT(*) AS events,
  (LOGICAL_OR(session_engaged = '1') OR SUM(engagement_time_msec) >= 10000
    OR COUNTIF(event_name = 'page_view') >= 2) AS engaged,
  SUM(engagement_time_msec) / 1000 AS engagement_time_sec,
  ANY_VALUE(landing_page_location) AS landing_page_location,
  REGEXP_EXTRACT(ANY_VALUE(landing_page_location), r'https?://[^/]+(/[^?#]*)') AS landing_page_path,
  ANY_VALUE(first_referrer) AS first_referrer,
  REGEXP_EXTRACT(ANY_VALUE(exit_page_location), r'https?://[^/]+(/[^?#]*)') AS exit_page_path,
  ANY_VALUE(stls_source) AS session_source,
  ANY_VALUE(stls_medium) AS session_medium,
  ANY_VALUE(stls_campaign) AS session_campaign,
  ANY_VALUE(stls_channel_group) AS default_channel_group,
  REGEXP_EXTRACT(ANY_VALUE(landing_page_location), r'[?&]gclid=([^&]+)') AS landing_gclid,
  REGEXP_EXTRACT(ANY_VALUE(landing_page_location), r'[?&]fbclid=([^&]+)') AS landing_fbclid,
  REGEXP_EXTRACT(ANY_VALUE(landing_page_location), r'[?&]ttclid=([^&]+)') AS landing_ttclid
FROM paged
GROUP BY session_key
ORDER BY session_start_ts;

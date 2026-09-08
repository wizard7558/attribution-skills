-- Returns: for one date window, session counts grouped by
-- (session_traffic_source_last_click source/medium) versus (source/medium
-- parsed from the landing page's own UTM params), to show how often GA4's
-- session attribution disagrees with a naive first-touch-of-session UTM
-- parse. Use this to decide which of the two you need for a given question
-- (see SKILL.md section 5).
-- Scan scale: comparable to sessions.sql - one pass over event_params plus
-- session_traffic_source_last_click for the window.

CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

WITH base AS (
  SELECT
    CONCAT(user_pseudo_id, '.', CAST(param_int(event_params, 'ga_session_id') AS STRING)) AS session_key,
    event_timestamp,
    param_string(event_params, 'page_location') AS page_location,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.source,
      session_traffic_source_last_click.manual_campaign.source
    ) AS stls_source,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.medium,
      session_traffic_source_last_click.manual_campaign.medium
    ) AS stls_medium
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
    AND param_int(event_params, 'ga_session_id') IS NOT NULL
),
landing AS (
  SELECT
    session_key,
    ANY_VALUE(stls_source) AS stls_source,
    ANY_VALUE(stls_medium) AS stls_medium,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp ASC LIMIT 1)[SAFE_OFFSET(0)] AS landing_page_location
  FROM base
  GROUP BY session_key
),
derived AS (
  SELECT
    session_key,
    stls_source,
    stls_medium,
    COALESCE(REGEXP_EXTRACT(landing_page_location, r'[?&]utm_source=([^&]+)'), '(direct)') AS derived_source,
    COALESCE(REGEXP_EXTRACT(landing_page_location, r'[?&]utm_medium=([^&]+)'), '(none)') AS derived_medium
  FROM landing
)
SELECT
  COALESCE(stls_source, '(missing)') AS session_last_click_source,
  COALESCE(stls_medium, '(missing)') AS session_last_click_medium,
  derived_source,
  derived_medium,
  COUNT(*) AS sessions
FROM derived
GROUP BY session_last_click_source, session_last_click_medium, derived_source, derived_medium
ORDER BY sessions DESC
LIMIT 20;

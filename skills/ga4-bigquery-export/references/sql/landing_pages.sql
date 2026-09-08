-- Returns: landing page path x sessions x engaged_sessions x key_events for
-- the window, ordered by sessions descending. Landing page = the first
-- page_location seen in the session, path-only (query string stripped).
-- Scan scale: comparable to sessions.sql - one pass over event_params for
-- every event in the window, plus a window function per session.

CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

-- Replace this array with the event names the user has agreed count as key events.
WITH events AS (
  SELECT
    CONCAT(user_pseudo_id, '.', CAST(param_int(event_params, 'ga_session_id') AS STRING)) AS session_key,
    event_timestamp,
    event_name,
    param_string(event_params, 'page_location') AS page_location,
    param_string(event_params, 'session_engaged') AS session_engaged,
    param_int(event_params, 'engagement_time_msec') AS engagement_time_msec
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
    AND param_int(event_params, 'ga_session_id') IS NOT NULL
),
landing AS (
  SELECT
    session_key,
    REGEXP_EXTRACT(
      FIRST_VALUE(page_location IGNORE NULLS) OVER (PARTITION BY session_key ORDER BY event_timestamp ASC),
      r'https?://[^/]+(/[^?#]*)'
    ) AS landing_page_path,
    session_engaged,
    engagement_time_msec,
    event_name,
    ROW_NUMBER() OVER (PARTITION BY session_key ORDER BY event_timestamp ASC) AS rn
  FROM events
),
key_events AS (
  SELECT session_key, COUNT(*) AS n
  FROM events
  WHERE event_name IN ('purchase', 'generate_lead', 'sign_up')
  GROUP BY session_key
),
per_session AS (
  SELECT
    session_key,
    ANY_VALUE(landing_page_path) AS landing_page_path,
    (LOGICAL_OR(session_engaged = '1') OR SUM(engagement_time_msec) >= 10000
      OR COUNTIF(event_name = 'page_view') >= 2) AS engaged
  FROM landing
  GROUP BY session_key
)
SELECT
  p.landing_page_path,
  COUNT(*) AS sessions,
  COUNTIF(p.engaged) AS engaged_sessions,
  COALESCE(SUM(ke.n), 0) AS key_events
FROM per_session p
LEFT JOIN key_events ke USING (session_key)
GROUP BY p.landing_page_path
ORDER BY sessions DESC
LIMIT 20;

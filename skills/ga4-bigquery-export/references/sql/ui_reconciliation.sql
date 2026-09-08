-- Returns: three sanity checks to run before you tell a user a BigQuery
-- number disagrees with the GA4 UI. (1) event row counts per _TABLE_SUFFIX
-- day, to catch a daily table that has not fully landed yet (allow up to
-- 72 hours). (2) the share of events with a NULL user_pseudo_id, which
-- cannot be sessionized or attributed by user. (3) the share of sessions
-- whose events span two different event_date values (midnight crossing).
-- Scan scale: light to moderate. Check 1 is a metadata-adjacent COUNT(*);
-- checks 2 and 3 scan user_pseudo_id and event_params for the window.

-- Check 1: daily table completeness / landing lag.
-- Row count by _TABLE_SUFFIX for the window; a day with an unusually low
-- count relative to its neighbors, especially the most recent day, means the
-- daily export has not fully landed yet (allow up to 72 hours).
SELECT
  _TABLE_SUFFIX AS table_date,
  COUNT(*) AS event_rows
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
GROUP BY table_date
ORDER BY table_date;

-- Check 2: share of events with a NULL user_pseudo_id (consent-mode traffic
-- that cannot be sessionized or attributed by user).
SELECT
  COUNTIF(user_pseudo_id IS NULL) AS null_user_pseudo_id_events,
  COUNT(*) AS total_events,
  ROUND(SAFE_DIVIDE(COUNTIF(user_pseudo_id IS NULL), COUNT(*)) * 100, 2) AS pct_null
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD';

-- Check 3: share of sessions whose events span two different event_date
-- values (midnight crossing). Explains session-count drift versus the UI
-- when you sum per-day session tables instead of aggregating across days.
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
WITH keyed AS (
  SELECT
    CONCAT(user_pseudo_id, '.', CAST(param_int(event_params, 'ga_session_id') AS STRING)) AS session_key,
    event_date
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
    AND param_int(event_params, 'ga_session_id') IS NOT NULL
),
spans AS (
  SELECT session_key, COUNT(DISTINCT event_date) AS n_dates
  FROM keyed
  GROUP BY session_key
)
SELECT
  COUNTIF(n_dates > 1) AS sessions_crossing_midnight,
  COUNT(*) AS total_sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(n_dates > 1), COUNT(*)) * 100, 2) AS pct_crossing_midnight
FROM spans;

-- Returns: raw page_view events with a handful of event_params extracted as
-- columns, using two idioms. Verified against the GA4 BigQuery export schema.
-- Scan scale: proportional to the events in the date window (roughly the
-- table's on-disk size for a 3-day window on a mid-size ecommerce property
-- is in the low hundreds of MB with only these columns selected).

-- Idiom A: correlated subquery, one param per column. No setup needed, but
-- repetitive when you need many params.
SELECT
  event_timestamp,
  event_name,
  user_pseudo_id,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
  AND event_name = 'page_view'
LIMIT 1000;

-- Idiom B: TEMP FUNCTION helpers. Define once per session, reuse across
-- every query in this skill. Prefer this when a query pulls more than two
-- or three params.
CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

CREATE TEMP FUNCTION param_number(params ANY TYPE, target_key STRING) AS ((
  SELECT COALESCE(value.float_value, value.double_value, CAST(value.int_value AS FLOAT64))
  FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

SELECT
  event_timestamp,
  event_name,
  user_pseudo_id,
  param_int(event_params, 'ga_session_id') AS ga_session_id,
  param_string(event_params, 'page_location') AS page_location,
  param_string(event_params, 'session_engaged') AS session_engaged,
  param_number(event_params, 'engagement_time_msec') AS engagement_time_msec
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
  AND event_name = 'page_view'
LIMIT 1000;

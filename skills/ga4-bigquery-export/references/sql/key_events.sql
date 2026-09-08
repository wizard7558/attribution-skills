-- Returns: one row per key-event occurrence (session_key, event_date,
-- event_name, timestamp, event_value_in_usd), for the event names in
-- key_event_names. The GA4 export carries no "is key event" flag - this
-- array is the explicit list you and the user agree on.
-- Scan scale: light. Filters to a handful of event_name values before doing
-- any param extraction, so BigQuery can prune most rows early.

-- Replace this array with the event names the user has agreed count as key events.
DECLARE key_event_names ARRAY<STRING> DEFAULT ['purchase', 'generate_lead', 'sign_up'];

CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

SELECT
  CONCAT(user_pseudo_id, '.', CAST(param_int(event_params, 'ga_session_id') AS STRING)) AS session_key,
  event_date,
  event_name,
  event_timestamp,
  TIMESTAMP_MICROS(event_timestamp) AS event_ts,
  event_value_in_usd
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
  AND user_pseudo_id IS NOT NULL
  AND param_int(event_params, 'ga_session_id') IS NOT NULL
  AND event_name IN UNNEST(key_event_names)
ORDER BY event_timestamp
LIMIT 1000;

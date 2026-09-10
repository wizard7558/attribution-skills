-- Sample of configured raw event occurrences with present visitor and session IDs.
-- Repeated purchases remain repeated; this is not ecommerce transaction deduplication.
-- The final top-1000 limit bounds presentation, not bytes scanned or population completeness.
DECLARE key_event_names ARRAY<STRING> DEFAULT ['purchase', 'generate_lead', 'sign_up'];
-- BEGIN GENERATED PARAMETER HELPERS
-- Generated consumers copy this GA4-owned authority verbatim.
-- Pick the first matching record by original offset, even when its selected value is NULL.
CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT p.value.string_value FROM UNNEST(params) AS p WITH OFFSET AS parameter_offset
  WHERE p.key = target_key ORDER BY parameter_offset LIMIT 1
));
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT p.value.int_value FROM UNNEST(params) AS p WITH OFFSET AS parameter_offset
  WHERE p.key = target_key ORDER BY parameter_offset LIMIT 1
));
CREATE TEMP FUNCTION param_number(params ANY TYPE, target_key STRING) AS ((
  SELECT COALESCE(p.value.float_value, p.value.double_value, CAST(p.value.int_value AS FLOAT64))
  FROM UNNEST(params) AS p WITH OFFSET AS parameter_offset
  WHERE p.key = target_key ORDER BY parameter_offset LIMIT 1
));
-- END GENERATED PARAMETER HELPERS

WITH extracted AS (
  SELECT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    user_pseudo_id, param_int(event_params,'ga_session_id') AS ga_session_id,
    PARSE_DATE('%Y%m%d',event_date) AS event_date, event_name, event_timestamp,
    TIMESTAMP_MICROS(event_timestamp) AS event_ts, event_value_in_usd
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND event_name IN UNNEST(key_event_names)
), keyed AS (
  SELECT *, CONCAT(user_pseudo_id,'.',CAST(ga_session_id AS STRING)) AS session_key
  FROM extracted WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
)
SELECT * FROM keyed
ORDER BY event_timestamp, source_system, source_scope, user_pseudo_id, ga_session_id,
  event_name, TO_JSON_STRING(keyed)
LIMIT 1000;

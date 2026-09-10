-- Raw page_view observations, including missing visitor/session IDs.
-- Both idioms select the first matching parameter by original array offset.
-- Each array is a deterministic top-1000 sample, not a completeness or cost guarantee.
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

CREATE TEMP TABLE parameter_input AS
SELECT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
  PARSE_DATE('%Y%m%d', event_date) AS event_date, event_timestamp, event_name,
  user_pseudo_id, event_params
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD' AND event_name = 'page_view';

-- Idiom A: inline first-offset typed extraction.
CREATE TEMP TABLE inline_rows AS
SELECT source_system, source_scope, event_date, event_timestamp, event_name, user_pseudo_id,
  (SELECT p.value.int_value FROM UNNEST(event_params) p WITH OFFSET o
    WHERE p.key='ga_session_id' ORDER BY o LIMIT 1) AS ga_session_id,
  (SELECT p.value.string_value FROM UNNEST(event_params) p WITH OFFSET o
    WHERE p.key='page_location' ORDER BY o LIMIT 1) AS page_location,
  GREATEST((SELECT COUNTIF(p.key='ga_session_id') FROM UNNEST(event_params) p)-1,0) AS ga_session_id_duplicate_count,
  GREATEST((SELECT COUNTIF(p.key='page_location') FROM UNNEST(event_params) p)-1,0) AS page_location_duplicate_count,
  TO_JSON_STRING(parameter_input) AS selected_evidence_json
FROM parameter_input;

-- Idiom B: the shared helpers; numeric fallback stays inside the selected record.
CREATE TEMP TABLE helper_rows AS
SELECT source_system, source_scope, event_date, event_timestamp, event_name, user_pseudo_id,
  param_int(event_params,'ga_session_id') AS ga_session_id,
  param_string(event_params,'page_location') AS page_location,
  GREATEST((SELECT COUNTIF(p.key='ga_session_id') FROM UNNEST(event_params) p)-1,0) AS ga_session_id_duplicate_count,
  GREATEST((SELECT COUNTIF(p.key='page_location') FROM UNNEST(event_params) p)-1,0) AS page_location_duplicate_count,
  param_string(event_params,'session_engaged') AS session_engaged,
  param_number(event_params,'engagement_time_msec') AS engagement_time_msec,
  GREATEST((SELECT COUNTIF(p.key='session_engaged') FROM UNNEST(event_params) p)-1,0) AS session_engaged_duplicate_count,
  GREATEST((SELECT COUNTIF(p.key='engagement_time_msec') FROM UNNEST(event_params) p)-1,0) AS engagement_time_msec_duplicate_count,
  TO_JSON_STRING(parameter_input) AS selected_evidence_json
FROM parameter_input;

SELECT TO_JSON_STRING(STRUCT(
  ARRAY(SELECT AS STRUCT * EXCEPT(selected_evidence_json) FROM inline_rows
    ORDER BY event_timestamp, selected_evidence_json LIMIT 1000) AS inline_rows,
  ARRAY(SELECT AS STRUCT * EXCEPT(selected_evidence_json) FROM helper_rows
    ORDER BY event_timestamp, selected_evidence_json LIMIT 1000) AS helper_rows
)) AS result_json;

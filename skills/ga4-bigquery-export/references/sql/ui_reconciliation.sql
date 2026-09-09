-- Three bounded observation diagnostics; none proves UI parity or export completeness.
-- No table metadata or consent fields are supplied, so existence/completeness/causes stay unknown.
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

CREATE TEMP TABLE diagnostic_events AS
SELECT PARSE_DATE('%Y%m%d',_TABLE_SUFFIX) AS table_date,
  PARSE_DATE('%Y%m%d',event_date) AS event_date, user_pseudo_id,
  param_int(event_params,'ga_session_id') AS ga_session_id
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD';

CREATE TEMP TABLE observed_spans AS
SELECT user_pseudo_id, ga_session_id, COUNT(DISTINCT event_date) AS observed_date_count,
  MIN(event_date) AS first_observed_date, MAX(event_date) AS last_observed_date
FROM diagnostic_events
WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
GROUP BY user_pseudo_id, ga_session_id;

SELECT TO_JSON_STRING(STRUCT(
  ARRAY(SELECT AS STRUCT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    date AS table_date, COUNT(e.table_date) AS observed_event_rows,
    'unknown' AS table_existence, 'unknown' AS export_completeness,
    'daily_export_rows_in_supplied_window' AS observation_scope,
    'row_counts_do_not_establish_table_existence_completeness_or_lag' AS limitations
    FROM UNNEST(GENERATE_DATE_ARRAY(PARSE_DATE('%Y%m%d','YYYYMMDD'),PARSE_DATE('%Y%m%d','YYYYMMDD'))) date
    LEFT JOIN diagnostic_events e ON e.table_date=date
    GROUP BY date ORDER BY date) AS daily_observations,
  (SELECT AS STRUCT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    COUNT(*) AS total_events, COUNTIF(user_pseudo_id IS NULL) AS null_user_pseudo_id_events,
    COUNTIF(ga_session_id IS NULL) AS missing_session_id_events,
    ROUND(SAFE_DIVIDE(COUNTIF(user_pseudo_id IS NULL),COUNT(*))*100,2) AS pct_null_user,
    'unknown' AS missing_identifier_cause,
    'all_observed_events_in_supplied_window' AS observation_scope,
    'identifier_absence_does_not_establish_consent_cause' AS limitations
    FROM diagnostic_events) AS identifier_observation,
  (SELECT AS STRUCT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    COUNT(*) AS total_sessions, COUNTIF(observed_date_count>1) AS sessions_crossing_midnight,
    ROUND(SAFE_DIVIDE(COUNTIF(observed_date_count>1),COUNT(*))*100,2) AS pct_crossing_midnight,
    'qualified_sessions_observed_in_supplied_window' AS observation_scope,
    'window_censored_date_spans_do_not_establish_lifetime_sessions_or_explain_ui_differences' AS limitations
    FROM observed_spans) AS session_date_spans
)) AS result_json;

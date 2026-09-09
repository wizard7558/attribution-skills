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

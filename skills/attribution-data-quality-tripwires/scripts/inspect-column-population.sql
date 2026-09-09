-- Read metadata first, then one bounded aggregate scan of supported top-level columns.
-- Required named parameters; source row values are never returned.
DECLARE target_project STRING DEFAULT @project;
DECLARE target_dataset STRING DEFAULT @dataset;
DECLARE target_table STRING DEFAULT @table_name;
DECLARE requested_columns ARRAY<STRING> DEFAULT @column_names;
DECLARE origin_system STRING DEFAULT @source_system;
DECLARE origin_scope STRING DEFAULT @source_scope;
DECLARE requested_mode STRING DEFAULT @population_mode;
DECLARE zone STRING DEFAULT @report_timezone;
DECLARE first_date DATE DEFAULT @start_date;
DECLARE last_date DATE DEFAULT @end_date;
DECLARE date_field STRING DEFAULT @date_column;
DECLARE present BOOL;
DECLARE date_type STRING;
DECLARE scan_expression STRING;
DECLARE filter_expression STRING DEFAULT '';
CREATE TEMP FUNCTION identifier(v STRING) AS (v IS NOT NULL AND LENGTH(v)<=1024 AND REGEXP_CONTAINS(v,r'^[A-Za-z_][A-Za-z0-9_]*$'));
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
ASSERT target_project IS NOT NULL AND REGEXP_CONTAINS(target_project,r'^[a-z][a-z0-9-]{4,61}[a-z0-9]$') AND identifier(target_dataset) AND identifier(target_table) AS 'invalid population identifiers';
ASSERT valid_key(origin_system) AND valid_key(origin_scope) AS 'invalid source identity';
ASSERT requested_columns IS NOT NULL AND ARRAY_LENGTH(requested_columns)>0 AND NOT EXISTS(SELECT 1 FROM UNNEST(requested_columns) v WHERE NOT identifier(v)) AS 'invalid requested columns';
ASSERT requested_mode IS NOT NULL AND requested_mode IN('report_window','full_table_snapshot')
 AND zone IS NOT NULL AND REGEXP_CONTAINS(zone,r'^[A-Za-z][A-Za-z0-9_+/-]*$') AND SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',zone) IS NOT NULL
 AND CASE WHEN requested_mode='report_window' THEN first_date IS NOT NULL AND last_date IS NOT NULL AND first_date<=last_date AND identifier(date_field)
 ELSE first_date IS NULL AND last_date IS NULL AND date_field IS NULL END AS 'invalid population configuration';
CREATE TEMP TABLE requested AS SELECT DISTINCT column_key FROM UNNEST(requested_columns) column_key;
EXECUTE IMMEDIATE FORMAT("SELECT COUNT(*)>0 FROM `%s.%s.INFORMATION_SCHEMA.TABLES` WHERE table_name=@t",target_project,target_dataset) INTO present USING target_table AS t;
EXECUTE IMMEDIATE FORMAT("CREATE TEMP TABLE metadata AS SELECT column_name,data_type FROM `%s.%s.INFORMATION_SCHEMA.COLUMNS` WHERE table_name=@t",target_project,target_dataset) USING target_table AS t;
CREATE TEMP TABLE targets AS SELECT r.column_key,m.data_type,m.column_name IS NOT NULL AS column_exists,
 IFNULL(m.data_type IN('BOOL','INT64','FLOAT64','NUMERIC','BIGNUMERIC','STRING','BYTES','DATE','DATETIME','TIME','TIMESTAMP','GEOGRAPHY','JSON'),FALSE) AS supported
 FROM requested r LEFT JOIN metadata m ON r.column_key=m.column_name;
CREATE TEMP TABLE counts(column_key STRING,row_count INT64,non_null_count INT64);
IF present AND requested_mode='report_window' THEN
 SET date_type=(SELECT data_type FROM metadata WHERE column_name=date_field);
 ASSERT date_type IS NOT NULL AND date_type IN('DATE','TIMESTAMP','DATETIME') AS 'unsupported or missing date column';
 SET filter_expression=CASE date_type WHEN 'TIMESTAMP' THEN FORMAT(' WHERE DATE(`%s`,@zone) BETWEEN @first_date AND @last_date',date_field)
 WHEN 'DATETIME' THEN FORMAT(' WHERE DATE(`%s`) BETWEEN @first_date AND @last_date',date_field)
 ELSE FORMAT(' WHERE `%s` BETWEEN @first_date AND @last_date',date_field) END;
END IF;
IF present AND EXISTS(SELECT 1 FROM targets WHERE supported) THEN
 -- One SELECT over the source table; its aggregate array is un-nested after aggregation.
 SET scan_expression=(SELECT STRING_AGG(FORMAT("STRUCT('%s' AS column_key,COUNT(*) AS row_count,COUNTIF(`%s` IS NOT NULL) AS non_null_count)",column_key,column_key),',' ORDER BY column_key) FROM targets WHERE supported);
 EXECUTE IMMEDIATE FORMAT('INSERT INTO counts SELECT c.* FROM (SELECT [%s] AS cells FROM `%s.%s.%s`%s),UNNEST(cells) c',scan_expression,target_project,target_dataset,target_table,filter_expression)
 USING zone AS zone,first_date AS first_date,last_date AS last_date;
END IF;
SELECT TO_JSON_STRING(STRUCT(origin_system AS source_system,origin_scope AS source_scope,target_project AS project,target_dataset AS dataset,target_table AS table_key,
 requested_mode AS population_mode,zone AS report_timezone,first_date AS observed_start,last_date AS observed_end,
 ARRAY(SELECT AS STRUCT origin_system AS source_system,origin_scope AS source_scope,target_table AS table_key,t.column_key,TRUE AS schema_complete,present AS table_exists,t.column_exists,c.column_key IS NOT NULL AS scan_complete FROM targets t LEFT JOIN counts c USING(column_key) ORDER BY column_key) AS membership,
 ARRAY(SELECT AS STRUCT origin_system AS source_system,origin_scope AS source_scope,target_table AS table_key,t.column_key,CAST(c.row_count AS STRING) AS row_count,CAST(c.non_null_count AS STRING) AS non_null_count,requested_mode AS population_mode,first_date AS observed_start,last_date AS observed_end FROM targets t LEFT JOIN counts c USING(column_key) ORDER BY column_key) AS observations,
 ARRAY(SELECT AS STRUCT column_key,'unsupported_type' AS reason,data_type FROM targets WHERE column_exists AND NOT supported ORDER BY column_key) AS diagnostics
)) AS result_json;

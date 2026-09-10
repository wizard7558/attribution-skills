-- Native BigQuery Standard SQL. Explicit SQL-NULL population evidence only.
-- BEGIN REPLACEABLE INPUTS
CREATE OR REPLACE TEMP TABLE configuration_input AS SELECT CAST('empty-baseline' AS STRING) AS invocation_key, CAST('synthetic-window' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-01' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, CAST('synthetic-schema' AS STRING) AS source_evidence_ref, CAST('synthetic-population' AS STRING) AS report_evidence_ref, CAST('report_window' AS STRING) AS population_mode;
CREATE OR REPLACE TEMP TABLE membership_input AS SELECT CAST('empty-baseline' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('sample_table' AS STRING) AS table_key, CAST('amount' AS STRING) AS column_key, TRUE AS schema_complete, TRUE AS table_exists, TRUE AS column_exists, TRUE AS scan_complete;
CREATE OR REPLACE TEMP TABLE observation_input AS SELECT CAST('empty-baseline' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('sample_table' AS STRING) AS table_key, CAST('amount' AS STRING) AS column_key, CAST('2' AS INT64) AS row_count, CAST('1' AS INT64) AS non_null_count, CAST('report_window' AS STRING) AS population_mode, CAST('2026-01-01' AS DATE) AS observed_start, CAST('2026-01-01' AS DATE) AS observed_end;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
-- BEGIN SINGLE INVOCATION
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'invalid configuration cardinality';
-- END SINGLE INVOCATION
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(report_scope))='STRING' AND TYPEOF(ANY_VALUE(report_timezone))='STRING' AND TYPEOF(ANY_VALUE(report_start))='DATE' AND TYPEOF(ANY_VALUE(report_end))='DATE' AND TYPEOF(ANY_VALUE(date_mode))='STRING' AND TYPEOF(ANY_VALUE(source_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(report_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(population_mode))='STRING' FROM configuration_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(table_key))='STRING' AND TYPEOF(ANY_VALUE(column_key))='STRING' AND TYPEOF(ANY_VALUE(schema_complete))='BOOL' AND TYPEOF(ANY_VALUE(table_exists))='BOOL' AND TYPEOF(ANY_VALUE(column_exists))='BOOL' AND TYPEOF(ANY_VALUE(scan_complete))='BOOL' FROM membership_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(table_key))='STRING' AND TYPEOF(ANY_VALUE(column_key))='STRING' AND TYPEOF(ANY_VALUE(row_count))='INT64' AND TYPEOF(ANY_VALUE(non_null_count))='INT64' AND TYPEOF(ANY_VALUE(population_mode))='STRING' AND TYPEOF(ANY_VALUE(observed_start))='DATE' AND TYPEOF(ANY_VALUE(observed_end))='DATE' FROM observation_input) AS 'invalid input column types';

ASSERT NOT EXISTS(SELECT invocation_key FROM configuration_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'invalid configuration cardinality';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope) OR NOT valid_key(source_evidence_ref) OR NOT valid_key(report_evidence_ref)
 OR report_start IS NULL OR report_end IS NULL OR report_start>report_end OR date_mode IS NULL OR date_mode NOT IN('cohort','activity')
 OR population_mode IS NULL OR population_mode NOT IN('report_window','full_table_snapshot')
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')
 OR SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',report_timezone) IS NULL) AS 'invalid invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM (SELECT invocation_key FROM membership_input UNION ALL SELECT invocation_key FROM observation_input) r LEFT JOIN configuration_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN membership_input m USING(invocation_key) WHERE m.invocation_key IS NULL) AS 'column inventory is required';
ASSERT NOT EXISTS(SELECT 1 FROM membership_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(table_key) OR NOT valid_key(column_key) OR schema_complete IS NULL OR scan_complete IS NULL
 OR (column_exists IS TRUE AND table_exists IS NOT TRUE) OR (scan_complete AND (table_exists IS NOT TRUE OR column_exists IS NOT TRUE))) AS 'invalid column inventory';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,table_key,column_key FROM membership_input GROUP BY 1,2,3,4,5 HAVING COUNT(DISTINCT TO_JSON_STRING(membership_input))>1) AS 'conflicting column inventory';
CREATE OR REPLACE TEMP TABLE members AS SELECT DISTINCT * FROM membership_input;
ASSERT NOT EXISTS(SELECT 1 FROM observation_input o JOIN configuration_input c USING(invocation_key) WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(table_key) OR NOT valid_key(column_key)
 OR (row_count IS NULL)!=(non_null_count IS NULL) OR row_count<0 OR non_null_count<0 OR non_null_count>row_count
 OR o.population_mode IS NULL OR o.population_mode!=c.population_mode
 OR (o.population_mode='report_window' AND (observed_start IS NULL OR observed_end IS NULL OR observed_start!=c.report_start OR observed_end!=c.report_end))
 OR (o.population_mode='full_table_snapshot' AND (observed_start IS NOT NULL OR observed_end IS NOT NULL))) AS 'invalid population observation';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,table_key,column_key FROM observation_input GROUP BY 1,2,3,4,5 HAVING COUNT(DISTINCT TO_JSON_STRING(observation_input))>1) AS 'conflicting population observation';
CREATE OR REPLACE TEMP TABLE observations AS SELECT DISTINCT * FROM observation_input;
ASSERT NOT EXISTS(SELECT 1 FROM members m LEFT JOIN observations o USING(invocation_key,source_system,source_scope,table_key,column_key)
 WHERE (m.scan_complete AND o.row_count IS NULL) OR (o.row_count IS NOT NULL AND (m.table_exists IS NOT TRUE OR m.column_exists IS NOT TRUE))) AS 'population contradicts inventory';
CREATE OR REPLACE TEMP TABLE findings AS SELECT m.*,o.row_count,o.non_null_count,o.observed_start,o.observed_end,
 CASE WHEN o.non_null_count>0 THEN 'pass' WHEN o.row_count>0 AND o.non_null_count=0 AND m.scan_complete THEN 'fail' ELSE 'unknown' END AS status,
 ARRAY(SELECT reason FROM UNNEST([
 IF(o.row_count>0 AND o.non_null_count=0 AND m.scan_complete,'column_all_null',NULL),
 IF(m.table_exists=FALSE,'table_absent',NULL),IF(m.table_exists IS NULL,'table_existence_unknown',NULL),
 IF(m.column_exists=FALSE,'column_absent',NULL),IF(m.column_exists IS NULL,'column_existence_unknown',NULL),
 IF(NOT m.schema_complete,'schema_incomplete',NULL),IF(NOT m.scan_complete,'scan_incomplete',NULL),
 IF(o.row_count=0,'no_observed_rows',NULL),IF(o.row_count IS NULL,'no_population_observation',NULL)]) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons
 FROM members m LEFT JOIN observations o USING(invocation_key,source_system,source_scope,table_key,column_key);
CREATE OR REPLACE TEMP TABLE summaries AS SELECT invocation_key,COUNT(*) AS declared_columns,COUNTIF(status='pass') AS populated_columns,COUNTIF(status='fail') AS all_null_columns,COUNTIF(status='unknown') AS unknown_columns,
 ARRAY_AGG(STRUCT(source_system,source_scope,table_key,column_key,schema_complete,table_exists,column_exists,scan_complete,CAST(row_count AS STRING) AS row_count,CAST(non_null_count AS STRING) AS non_null_count,observed_start,observed_end,status,reasons) ORDER BY source_system,source_scope,table_key,column_key) AS details FROM findings GROUP BY 1;
CREATE OR REPLACE TEMP TABLE reasons AS SELECT invocation_key,ARRAY_AGG(DISTINCT reason ORDER BY reason) AS reasons FROM findings,UNNEST(reasons) reason GROUP BY 1;
CREATE OR REPLACE TEMP TABLE raw_counts AS SELECT invocation_key,COUNT(*) AS raw_observations FROM observation_input GROUP BY 1;
CREATE OR REPLACE TEMP TABLE unique_counts AS SELECT o.invocation_key,COUNT(*) AS unique_observations,COUNTIF(m.invocation_key IS NULL) AS nonmember_observations FROM observations o LEFT JOIN members m USING(invocation_key,source_system,source_scope,table_key,column_key) GROUP BY 1;
SELECT c.invocation_key,TO_JSON_STRING(STRUCT('empty_column_probe' AS check_id,'0.1.0' AS contract_version,c AS configuration,
 CASE WHEN s.all_null_columns>0 THEN 'fail' WHEN s.unknown_columns>0 THEN 'unknown' ELSE 'pass' END AS status,IFNULL(r.reasons,[]) AS reasons,[c.source_evidence_ref,c.report_evidence_ref] AS evidence_refs,s.details,
 STRUCT(CAST(s.declared_columns AS STRING) AS declared_columns,CAST(s.populated_columns AS STRING) AS populated_columns,CAST(s.all_null_columns AS STRING) AS all_null_columns,CAST(s.unknown_columns AS STRING) AS unknown_columns,
 CAST(IFNULL(a.raw_observations,0) AS STRING) AS raw_observations,CAST(IFNULL(a.raw_observations,0)-IFNULL(u.unique_observations,0) AS STRING) AS duplicate_observations_collapsed,CAST(IFNULL(u.nonmember_observations,0) AS STRING) AS nonmember_observations) AS diagnostics
)) AS result_json FROM configuration_input c JOIN summaries s USING(invocation_key) LEFT JOIN reasons r USING(invocation_key) LEFT JOIN raw_counts a USING(invocation_key) LEFT JOIN unique_counts u USING(invocation_key) ORDER BY invocation_key;

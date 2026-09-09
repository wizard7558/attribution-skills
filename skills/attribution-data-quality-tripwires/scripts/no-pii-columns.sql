-- Native BigQuery Standard SQL. Temporary schema metadata and explicit policy only.
-- BEGIN REPLACEABLE INPUTS
CREATE OR REPLACE TEMP TABLE configuration_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic-window' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-01' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, CAST('synthetic-schema' AS STRING) AS source_evidence_ref, CAST('synthetic-policy' AS STRING) AS report_evidence_ref;
CREATE OR REPLACE TEMP TABLE membership_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('safe_table' AS STRING) AS table_key, TRUE AS schema_complete, TRUE AS table_exists;
CREATE OR REPLACE TEMP TABLE column_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('safe_table' AS STRING) AS table_key, CAST('lead_key' AS STRING) AS field_path, CAST('STRING' AS STRING) AS data_type;
CREATE OR REPLACE TEMP TABLE policy_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('email_leaf' AS STRING) AS rule_key, CAST('exact_leaf' AS STRING) AS match_kind, CAST('email' AS STRING) AS pattern;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
-- BEGIN SINGLE INVOCATION
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'invalid configuration cardinality';
-- END SINGLE INVOCATION
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(report_scope))='STRING' AND TYPEOF(ANY_VALUE(report_timezone))='STRING' AND TYPEOF(ANY_VALUE(report_start))='DATE' AND TYPEOF(ANY_VALUE(report_end))='DATE' AND TYPEOF(ANY_VALUE(date_mode))='STRING' AND TYPEOF(ANY_VALUE(source_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(report_evidence_ref))='STRING' FROM configuration_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(table_key))='STRING' AND TYPEOF(ANY_VALUE(schema_complete))='BOOL' AND TYPEOF(ANY_VALUE(table_exists))='BOOL' FROM membership_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(table_key))='STRING' AND TYPEOF(ANY_VALUE(field_path))='STRING' AND TYPEOF(ANY_VALUE(data_type))='STRING' FROM column_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(rule_key))='STRING' AND TYPEOF(ANY_VALUE(match_kind))='STRING' AND TYPEOF(ANY_VALUE(pattern))='STRING' FROM policy_input) AS 'invalid input column types';

ASSERT NOT EXISTS(SELECT invocation_key FROM configuration_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'invalid configuration cardinality';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope) OR NOT valid_key(source_evidence_ref) OR NOT valid_key(report_evidence_ref)
 OR report_start IS NULL OR report_end IS NULL OR report_start>report_end OR date_mode IS NULL OR date_mode NOT IN('cohort','activity')
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')
 OR SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',report_timezone) IS NULL) AS 'invalid invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM (SELECT invocation_key FROM membership_input UNION ALL SELECT invocation_key FROM column_input UNION ALL SELECT invocation_key FROM policy_input) r LEFT JOIN configuration_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM membership_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(table_key) OR schema_complete IS NULL) AS 'invalid table inventory';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN membership_input m USING(invocation_key) WHERE m.invocation_key IS NULL) AS 'table inventory is required';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,table_key FROM membership_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(membership_input))>1) AS 'conflicting table inventory';
CREATE OR REPLACE TEMP TABLE members AS SELECT DISTINCT * FROM membership_input;
ASSERT NOT EXISTS(SELECT 1 FROM column_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(table_key) OR NOT valid_key(field_path) OR NOT valid_key(data_type)) AS 'invalid column metadata';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,table_key,field_path FROM column_input GROUP BY 1,2,3,4,5 HAVING COUNT(DISTINCT TO_JSON_STRING(column_input))>1) AS 'conflicting column metadata';
CREATE OR REPLACE TEMP TABLE columns_unique AS SELECT DISTINCT * FROM column_input;
ASSERT NOT EXISTS(SELECT 1 FROM columns_unique x JOIN members m USING(invocation_key,source_system,source_scope,table_key) WHERE m.table_exists IS NOT TRUE) AS 'columns contradict table inventory';
ASSERT NOT EXISTS(SELECT 1 FROM policy_input WHERE NOT valid_key(rule_key) OR match_kind IS NULL OR match_kind NOT IN('exact_leaf','path_regex') OR NOT valid_key(pattern)
 OR (match_kind='path_regex' AND SAFE.REGEXP_CONTAINS('',pattern) IS NULL)) AS 'invalid schema policy';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN policy_input p USING(invocation_key) WHERE p.invocation_key IS NULL) AS 'schema policy is required';
ASSERT NOT EXISTS(SELECT invocation_key,rule_key FROM policy_input GROUP BY 1,2 HAVING COUNT(DISTINCT TO_JSON_STRING(policy_input))>1) AS 'conflicting schema policy';
CREATE OR REPLACE TEMP TABLE policies AS SELECT DISTINCT * FROM policy_input;
CREATE OR REPLACE TEMP TABLE selected_columns AS SELECT x.* FROM columns_unique x JOIN members m USING(invocation_key,source_system,source_scope,table_key);
CREATE OR REPLACE TEMP TABLE matching_rules AS SELECT x.invocation_key,x.source_system,x.source_scope,x.table_key,x.field_path,p.rule_key
 FROM selected_columns x JOIN policies p USING(invocation_key)
 WHERE CASE WHEN p.match_kind='exact_leaf' THEN LOWER(ARRAY_REVERSE(SPLIT(x.field_path,'.'))[OFFSET(0)])=LOWER(p.pattern)
 ELSE REGEXP_CONTAINS(LOWER(x.field_path),p.pattern) END;
CREATE OR REPLACE TEMP TABLE matching_paths AS SELECT invocation_key,source_system,source_scope,table_key,field_path,ARRAY_AGG(DISTINCT rule_key ORDER BY rule_key) AS matched_rule_ids FROM matching_rules GROUP BY 1,2,3,4,5;
CREATE OR REPLACE TEMP TABLE match_summary AS SELECT invocation_key,source_system,source_scope,table_key,COUNT(*) AS matched_count,ARRAY_AGG(STRUCT(field_path,matched_rule_ids) ORDER BY field_path) AS matching_paths FROM matching_paths GROUP BY 1,2,3,4;
CREATE OR REPLACE TEMP TABLE column_summary AS SELECT invocation_key,source_system,source_scope,table_key,COUNT(*) AS observed_count FROM selected_columns GROUP BY 1,2,3,4;
CREATE OR REPLACE TEMP TABLE table_findings AS SELECT m.*,IFNULL(x.observed_count,0) AS observed_column_count,IFNULL(h.matched_count,0) AS matched_count,IFNULL(h.matching_paths,[]) AS matching_paths,
 CASE WHEN IFNULL(h.matched_count,0)>0 THEN 'fail' WHEN m.table_exists IS NOT TRUE OR NOT m.schema_complete OR IFNULL(x.observed_count,0)=0 THEN 'unknown' ELSE 'pass' END AS status,
 ARRAY(SELECT reason FROM UNNEST([IF(IFNULL(h.matched_count,0)>0,'forbidden_column_name',NULL),IF(m.table_exists=FALSE,'table_absent',NULL),IF(m.table_exists IS NULL,'table_existence_unknown',NULL),
 IF(NOT m.schema_complete,'schema_incomplete',NULL),IF(IFNULL(x.observed_count,0)=0,'no_observed_columns',NULL)]) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons
 FROM members m LEFT JOIN column_summary x USING(invocation_key,source_system,source_scope,table_key) LEFT JOIN match_summary h USING(invocation_key,source_system,source_scope,table_key);
CREATE OR REPLACE TEMP TABLE finding_summary AS SELECT invocation_key,COUNT(*) AS declared_tables,SUM(observed_column_count) AS selected_columns,SUM(matched_count) AS matching_paths,
 COUNTIF(status='fail')>0 AS has_fail,COUNTIF(status='unknown')>0 AS has_unknown,
 ARRAY_AGG(STRUCT(source_system,source_scope,table_key,schema_complete,table_exists,CAST(observed_column_count AS STRING) AS observed_column_count,matching_paths,status,reasons) ORDER BY source_system,source_scope,table_key) AS details FROM table_findings GROUP BY 1;
CREATE OR REPLACE TEMP TABLE reason_summary AS SELECT invocation_key,ARRAY_AGG(DISTINCT reason ORDER BY reason) AS reasons FROM table_findings,UNNEST(reasons) reason GROUP BY 1;
CREATE OR REPLACE TEMP TABLE raw_summary AS SELECT invocation_key,COUNT(*) AS raw_columns FROM column_input GROUP BY 1;
CREATE OR REPLACE TEMP TABLE unique_summary AS SELECT x.invocation_key,COUNT(*) AS unique_columns,COUNTIF(m.invocation_key IS NULL) AS nonmember_columns FROM columns_unique x LEFT JOIN members m USING(invocation_key,source_system,source_scope,table_key) GROUP BY 1;
CREATE OR REPLACE TEMP TABLE policy_summary AS SELECT invocation_key,COUNT(*) AS policy_rules FROM policies GROUP BY 1;
-- BEGIN RESULT
SELECT c.invocation_key,TO_JSON_STRING(STRUCT('no_pii_columns' AS check_id,'0.1.0' AS contract_version,
 STRUCT(c.invocation_key,c.report_scope,c.report_timezone,c.report_start,c.report_end,c.date_mode,c.source_evidence_ref,c.report_evidence_ref) AS configuration,
 CASE WHEN f.has_fail THEN 'fail' WHEN f.has_unknown THEN 'unknown' ELSE 'pass' END AS status,IFNULL(z.reasons,[]) AS reasons,[c.source_evidence_ref,c.report_evidence_ref] AS evidence_refs,f.details,
 STRUCT(CAST(f.declared_tables AS STRING) AS declared_tables,CAST(IFNULL(r.raw_columns,0) AS STRING) AS raw_columns,CAST(IFNULL(r.raw_columns,0)-IFNULL(u.unique_columns,0) AS STRING) AS duplicate_columns_collapsed,
 CAST(f.selected_columns AS STRING) AS selected_columns,CAST(IFNULL(u.nonmember_columns,0) AS STRING) AS nonmember_columns,CAST(p.policy_rules AS STRING) AS policy_rules,CAST(f.matching_paths AS STRING) AS matching_paths) AS diagnostics
 )) AS result_json FROM configuration_input c JOIN finding_summary f USING(invocation_key) JOIN policy_summary p USING(invocation_key) LEFT JOIN reason_summary z USING(invocation_key) LEFT JOIN raw_summary r USING(invocation_key) LEFT JOIN unique_summary u USING(invocation_key) ORDER BY invocation_key;

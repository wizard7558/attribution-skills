-- Native BigQuery Standard SQL. Temporary synthetic inputs only.
-- BEGIN REPLACEABLE INPUTS
CREATE OR REPLACE TEMP TABLE configuration_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic-window' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-01' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, CAST('synthetic-source' AS STRING) AS source_evidence_ref, CAST('synthetic-report' AS STRING) AS report_evidence_ref, TRUE AS source_complete, CAST('0.5' AS NUMERIC) AS threshold, CAST('1' AS INT64) AS min_eligible_count;
CREATE OR REPLACE TEMP TABLE membership_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope;
CREATE OR REPLACE TEMP TABLE source_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Record+A' AS STRING) AS record_key, TRUE AS included, TRUE AS eligible, TRUE AS meets_condition;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
-- BEGIN SINGLE INVOCATION
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'invalid configuration cardinality';
-- END SINGLE INVOCATION
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(report_scope))='STRING' AND TYPEOF(ANY_VALUE(report_timezone))='STRING' AND TYPEOF(ANY_VALUE(report_start))='DATE' AND TYPEOF(ANY_VALUE(report_end))='DATE' AND TYPEOF(ANY_VALUE(date_mode))='STRING' AND TYPEOF(ANY_VALUE(source_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(report_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(source_complete))='BOOL' AND TYPEOF(ANY_VALUE(threshold))='NUMERIC' AND TYPEOF(ANY_VALUE(min_eligible_count))='INT64' FROM configuration_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' FROM membership_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(record_key))='STRING' AND TYPEOF(ANY_VALUE(included))='BOOL' AND TYPEOF(ANY_VALUE(eligible))='BOOL' AND TYPEOF(ANY_VALUE(meets_condition))='BOOL' FROM source_input) AS 'invalid input column types';
ASSERT NOT EXISTS(SELECT invocation_key FROM configuration_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'invalid configuration cardinality';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope) OR NOT valid_key(source_evidence_ref) OR NOT valid_key(report_evidence_ref)
 OR report_start IS NULL OR report_end IS NULL OR report_start>report_end OR date_mode IS NULL OR date_mode NOT IN('cohort','activity')
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')
 OR SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',report_timezone) IS NULL) AS 'invalid invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE source_complete IS NULL OR threshold IS NULL OR threshold<0 OR threshold>1 OR min_eligible_count IS NULL OR min_eligible_count<1) AS 'invalid rate configuration';
ASSERT NOT EXISTS(SELECT 1 FROM (SELECT invocation_key FROM membership_input UNION ALL SELECT invocation_key FROM source_input) r LEFT JOIN configuration_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM membership_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope)) AS 'invalid source membership';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN membership_input m USING(invocation_key) WHERE m.invocation_key IS NULL) AS 'source membership is required';
CREATE OR REPLACE TEMP TABLE members AS SELECT DISTINCT * FROM membership_input;
ASSERT NOT EXISTS(SELECT 1 FROM source_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(record_key) OR included IS NULL) AS 'invalid qualified source record';
ASSERT NOT EXISTS(SELECT 1 FROM source_input WHERE eligible IS NULL) AS 'invalid eligibility evidence';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,record_key FROM source_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(source_input))>1) AS 'conflicting qualified source record';
CREATE OR REPLACE TEMP TABLE source_unique AS SELECT DISTINCT * FROM source_input;
CREATE OR REPLACE TEMP TABLE source_scoped AS SELECT s.*,m.invocation_key IS NOT NULL AS is_member FROM source_unique s LEFT JOIN members m USING(invocation_key,source_system,source_scope);
CREATE OR REPLACE TEMP TABLE selected_source AS SELECT * FROM source_scoped WHERE is_member AND included;
CREATE OR REPLACE TEMP TABLE raw_summary AS SELECT invocation_key,COUNT(*) AS raw_rows FROM source_input GROUP BY 1;
CREATE OR REPLACE TEMP TABLE source_summary AS SELECT invocation_key,COUNT(*) AS unique_rows,COUNTIF(NOT is_member) AS nonmember_rows,COUNTIF(NOT included) AS excluded_rows,COUNTIF(is_member AND included) AS selected_rows FROM source_scoped GROUP BY 1;

CREATE OR REPLACE TEMP TABLE population_counts AS SELECT c.invocation_key,CAST(COUNTIF(s.eligible) AS BIGNUMERIC) AS eligible_count,
 CAST(COUNTIF(s.eligible AND s.meets_condition) AS BIGNUMERIC) AS true_count,CAST(COUNTIF(s.eligible AND NOT s.meets_condition) AS BIGNUMERIC) AS false_count,
 CAST(COUNTIF(s.eligible AND s.meets_condition IS NULL) AS BIGNUMERIC) AS unknown_count
 FROM configuration_input c LEFT JOIN selected_source s USING(invocation_key) GROUP BY 1;
CREATE OR REPLACE TEMP TABLE decisions AS SELECT p.*,CASE WHEN NOT source_complete OR eligible_count=0 OR eligible_count<min_eligible_count THEN 'unknown'
 WHEN (true_count+unknown_count)<threshold*eligible_count THEN 'fail' WHEN true_count>=threshold*eligible_count THEN 'pass' ELSE 'unknown' END AS status,
 SAFE_DIVIDE(true_count,eligible_count) AS lower_rate,SAFE_DIVIDE(true_count+unknown_count,eligible_count) AS upper_rate
 FROM population_counts p JOIN configuration_input c USING(invocation_key);
CREATE OR REPLACE TEMP TABLE findings AS SELECT d.*,
 ARRAY(SELECT reason FROM UNNEST([IF(NOT c.source_complete,'source_incomplete',NULL),IF(eligible_count=0,'no_eligible_records',NULL),
 IF(eligible_count>0 AND eligible_count<c.min_eligible_count,'below_minimum_eligible_count',NULL),
 IF(status='fail','rate_below_minimum',NULL),IF(status='unknown' AND c.source_complete AND eligible_count>=c.min_eligible_count AND unknown_count>0,'condition_uncertainty',NULL)]) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons
 FROM decisions d JOIN configuration_input c USING(invocation_key);
-- BEGIN RESULT
SELECT c.invocation_key,TO_JSON_STRING(STRUCT('match_rate' AS check_id,'0.1.0' AS contract_version,
 STRUCT(c.invocation_key AS invocation_key,c.report_scope AS report_scope,c.report_timezone AS report_timezone,c.report_start AS report_start,c.report_end AS report_end,c.date_mode AS date_mode,c.source_evidence_ref AS source_evidence_ref,c.report_evidence_ref AS report_evidence_ref,c.source_complete AS source_complete,CAST(c.threshold AS STRING) AS threshold,CAST(c.min_eligible_count AS STRING) AS min_eligible_count) AS configuration,f.status,f.reasons,[c.source_evidence_ref,c.report_evidence_ref] AS evidence_refs,
 [STRUCT(CAST(eligible_count AS STRING) AS eligible_count,CAST(true_count AS STRING) AS true_count,CAST(false_count AS STRING) AS false_count,CAST(unknown_count AS STRING) AS unknown_count,
 CAST(IF(unknown_count=0,lower_rate,NULL) AS STRING) AS point_rate,CAST(lower_rate AS STRING) AS lower_rate,CAST(upper_rate AS STRING) AS upper_rate,unknown_count>0 AS unknown_conditions_present,f.status,f.reasons)] AS details,
 STRUCT(CAST(IFNULL(r.raw_rows,0) AS STRING) AS source_raw_rows,CAST(IFNULL(r.raw_rows,0)-IFNULL(s.unique_rows,0) AS STRING) AS source_duplicate_rows_collapsed,CAST(IFNULL(s.selected_rows,0) AS STRING) AS source_selected_rows,CAST(IFNULL(s.nonmember_rows,0) AS STRING) AS source_nonmember_rows,CAST(IFNULL(s.excluded_rows,0) AS STRING) AS source_excluded_rows,CAST(IFNULL(s.selected_rows,0)-eligible_count AS STRING) AS ineligible_rows) AS diagnostics
 )) AS result_json FROM configuration_input c JOIN findings f USING(invocation_key) LEFT JOIN raw_summary r USING(invocation_key) LEFT JOIN source_summary s USING(invocation_key) ORDER BY invocation_key;

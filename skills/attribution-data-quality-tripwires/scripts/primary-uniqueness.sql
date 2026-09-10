-- Native BigQuery Standard SQL. Temporary synthetic inputs only.
-- BEGIN REPLACEABLE INPUTS
CREATE OR REPLACE TEMP TABLE configuration_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic-window' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-01' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, CAST('synthetic-source' AS STRING) AS source_evidence_ref, CAST('synthetic-report' AS STRING) AS report_evidence_ref, TRUE AS source_complete;
CREATE OR REPLACE TEMP TABLE membership_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope;
CREATE OR REPLACE TEMP TABLE source_input AS
SELECT CAST('synthetic-check' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Record+A' AS STRING) AS record_key, TRUE AS included, CAST('Click+Case' AS STRING) AS group_key, TRUE AS is_attribution_primary;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
-- BEGIN SINGLE INVOCATION
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'invalid configuration cardinality';
-- END SINGLE INVOCATION
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(report_scope))='STRING' AND TYPEOF(ANY_VALUE(report_timezone))='STRING' AND TYPEOF(ANY_VALUE(report_start))='DATE' AND TYPEOF(ANY_VALUE(report_end))='DATE' AND TYPEOF(ANY_VALUE(date_mode))='STRING' AND TYPEOF(ANY_VALUE(source_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(report_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(source_complete))='BOOL' FROM configuration_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' FROM membership_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(record_key))='STRING' AND TYPEOF(ANY_VALUE(included))='BOOL' AND TYPEOF(ANY_VALUE(group_key))='STRING' AND TYPEOF(ANY_VALUE(is_attribution_primary))='BOOL' FROM source_input) AS 'invalid input column types';
ASSERT NOT EXISTS(SELECT invocation_key FROM configuration_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'invalid configuration cardinality';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope) OR NOT valid_key(source_evidence_ref) OR NOT valid_key(report_evidence_ref)
 OR report_start IS NULL OR report_end IS NULL OR report_start>report_end OR date_mode IS NULL OR date_mode NOT IN('cohort','activity')
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')
 OR SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',report_timezone) IS NULL) AS 'invalid invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE source_complete IS NULL) AS 'invalid primary configuration';
ASSERT NOT EXISTS(SELECT 1 FROM (SELECT invocation_key FROM membership_input UNION ALL SELECT invocation_key FROM source_input) r LEFT JOIN configuration_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM membership_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope)) AS 'invalid source membership';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN membership_input m USING(invocation_key) WHERE m.invocation_key IS NULL) AS 'source membership is required';
CREATE OR REPLACE TEMP TABLE members AS SELECT DISTINCT * FROM membership_input;
ASSERT NOT EXISTS(SELECT 1 FROM source_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(record_key) OR included IS NULL) AS 'invalid qualified source record';
ASSERT NOT EXISTS(SELECT 1 FROM source_input WHERE is_attribution_primary IS NULL OR (group_key IS NOT NULL AND NOT valid_key(group_key))) AS 'invalid primary evidence';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,record_key FROM source_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(source_input))>1) AS 'conflicting qualified source record';
CREATE OR REPLACE TEMP TABLE source_unique AS SELECT DISTINCT * FROM source_input;
CREATE OR REPLACE TEMP TABLE source_scoped AS SELECT s.*,m.invocation_key IS NOT NULL AS is_member FROM source_unique s LEFT JOIN members m USING(invocation_key,source_system,source_scope);
CREATE OR REPLACE TEMP TABLE selected_source AS SELECT * FROM source_scoped WHERE is_member AND included;
CREATE OR REPLACE TEMP TABLE raw_summary AS SELECT invocation_key,COUNT(*) AS raw_rows FROM source_input GROUP BY 1;
CREATE OR REPLACE TEMP TABLE source_summary AS SELECT invocation_key,COUNT(*) AS unique_rows,COUNTIF(NOT is_member) AS nonmember_rows,COUNTIF(NOT included) AS excluded_rows,COUNTIF(is_member AND included) AS selected_rows FROM source_scoped GROUP BY 1;

CREATE OR REPLACE TEMP TABLE primary_groups AS SELECT invocation_key,source_system,source_scope,IF(group_key IS NULL,'singleton','declared') AS group_type,group_key,
 IF(group_key IS NULL,record_key,NULL) AS singleton_record_key,COUNT(*) AS member_count,COUNTIF(is_attribution_primary) AS primary_count,
 ARRAY_AGG(STRUCT(source_system,source_scope,record_key) ORDER BY record_key) AS member_keys,
 ARRAY_AGG(IF(is_attribution_primary,STRUCT(source_system,source_scope,record_key),NULL) IGNORE NULLS ORDER BY record_key) AS primary_keys
 FROM selected_source GROUP BY 1,2,3,4,5,6;
CREATE OR REPLACE TEMP TABLE group_findings AS SELECT g.*,CASE WHEN (group_type='singleton' AND primary_count!=1) OR primary_count>1 OR (source_complete AND primary_count=0) THEN 'fail' WHEN NOT source_complete AND group_type='declared' THEN 'unknown' ELSE 'pass' END AS status,
 ARRAY(SELECT reason FROM UNNEST([IF(NOT source_complete AND group_type='declared','source_incomplete',NULL),IF(group_type='singleton' AND primary_count!=1,'singleton_not_primary',NULL),
 IF(primary_count>1,'multiple_primary',NULL),IF(group_type='declared' AND primary_count=0 AND source_complete,'missing_primary',NULL)]) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons
 FROM primary_groups g JOIN configuration_input c USING(invocation_key);
CREATE OR REPLACE TEMP TABLE group_summary AS SELECT invocation_key,COUNT(*) AS group_count,COUNTIF(status='fail')>0 AS has_fail,COUNTIF(status='unknown')>0 AS has_unknown,
 ARRAY_AGG(STRUCT(source_system,source_scope,group_type,group_key,singleton_record_key,CAST(member_count AS STRING) AS member_count,CAST(primary_count AS STRING) AS primary_count,member_keys,IFNULL(primary_keys,[]) AS primary_keys,status,reasons)
 ORDER BY source_system,source_scope,group_type,group_key,singleton_record_key) AS details FROM group_findings GROUP BY 1;
CREATE OR REPLACE TEMP TABLE reason_summary AS SELECT invocation_key,ARRAY_AGG(DISTINCT reason ORDER BY reason) AS reasons FROM group_findings,UNNEST(reasons) reason GROUP BY 1;
-- BEGIN RESULT
SELECT c.invocation_key,TO_JSON_STRING(STRUCT('primary_uniqueness' AS check_id,'0.1.0' AS contract_version,
 STRUCT(c.invocation_key AS invocation_key,c.report_scope AS report_scope,c.report_timezone AS report_timezone,c.report_start AS report_start,c.report_end AS report_end,c.date_mode AS date_mode,c.source_evidence_ref AS source_evidence_ref,c.report_evidence_ref AS report_evidence_ref,c.source_complete AS source_complete) AS configuration,CASE WHEN IFNULL(g.has_fail,FALSE) THEN 'fail' WHEN NOT source_complete OR IFNULL(g.has_unknown,FALSE) THEN 'unknown' ELSE 'pass' END AS status,
 ARRAY(SELECT DISTINCT reason FROM UNNEST(ARRAY_CONCAT(IFNULL(z.reasons,[]),[IF(NOT source_complete,'source_incomplete',NULL)])) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons,
 [c.source_evidence_ref,c.report_evidence_ref] AS evidence_refs,IFNULL(g.details,[]) AS details,
 STRUCT(CAST(IFNULL(r.raw_rows,0) AS STRING) AS source_raw_rows,CAST(IFNULL(r.raw_rows,0)-IFNULL(s.unique_rows,0) AS STRING) AS source_duplicate_rows_collapsed,CAST(IFNULL(s.selected_rows,0) AS STRING) AS source_selected_rows,CAST(IFNULL(s.nonmember_rows,0) AS STRING) AS source_nonmember_rows,CAST(IFNULL(s.excluded_rows,0) AS STRING) AS source_excluded_rows,CAST(IFNULL(g.group_count,0) AS STRING) AS selected_groups) AS diagnostics
 )) AS result_json FROM configuration_input c LEFT JOIN group_summary g USING(invocation_key) LEFT JOIN reason_summary z USING(invocation_key)
 LEFT JOIN raw_summary r USING(invocation_key) LEFT JOIN source_summary s USING(invocation_key) ORDER BY invocation_key;

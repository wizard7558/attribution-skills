-- Native Standard SQL. Explicit cross-grain coverage evidence, never a deletion diagnosis.
-- BEGIN REPLACEABLE INPUTS
CREATE OR REPLACE TEMP TABLE configuration_input AS SELECT CAST('deleted-baseline' AS STRING) AS invocation_key, CAST('synthetic-window' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-01' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, CAST('synthetic-campaign' AS STRING) AS source_evidence_ref, CAST('synthetic-ads' AS STRING) AS report_evidence_ref, CAST('0' AS NUMERIC) AS abs_tolerance, CAST('0' AS NUMERIC) AS relative_tolerance;
CREATE OR REPLACE TEMP TABLE membership_input AS SELECT CAST('deleted-baseline' AS STRING) AS invocation_key, CAST('pair-a' AS STRING) AS pair_key, CAST('ad_export' AS STRING) AS ad_source_system, CAST('account-a' AS STRING) AS ad_source_scope, CAST('campaign_export' AS STRING) AS reference_source_system, CAST('account-a' AS STRING) AS reference_source_scope, TRUE AS ad_complete, TRUE AS reference_complete, CAST('UTC' AS STRING) AS ad_timezone, CAST('UTC' AS STRING) AS reference_timezone, CAST('2026-01-01' AS DATE) AS ad_history_start, CAST('2026-01-01' AS DATE) AS reference_history_start, TRUE AS ad_includes_deleted, TRUE AS reference_includes_deleted, CAST('all-statuses' AS STRING) AS ad_status_filter, CAST('all-statuses' AS STRING) AS reference_status_filter, CAST('incremental_snapshot' AS STRING) AS ad_capture_mode, CAST('incremental_snapshot' AS STRING) AS reference_capture_mode, CAST('synthetic-comparability' AS STRING) AS comparability_evidence_ref;
CREATE OR REPLACE TEMP TABLE ad_input AS SELECT CAST('deleted-baseline' AS STRING) AS invocation_key, CAST('ad_export' AS STRING) AS source_system, CAST('account-a' AS STRING) AS source_scope, CAST('hour-1' AS STRING) AS fact_key, CAST('2026-01-01' AS DATE) AS event_date, CAST('Campaign+A' AS STRING) AS campaign_key, CAST('10' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status, CAST('Ad+A' AS STRING) AS ad_key;
CREATE OR REPLACE TEMP TABLE reference_input AS SELECT CAST('deleted-baseline' AS STRING) AS invocation_key, CAST('campaign_export' AS STRING) AS source_system, CAST('account-a' AS STRING) AS source_scope, CAST('daily-1' AS STRING) AS fact_key, CAST('2026-01-01' AS DATE) AS event_date, CAST('Campaign+A' AS STRING) AS campaign_key, CAST('10' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
CREATE TEMP FUNCTION valid_zone(v STRING) AS (v IS NOT NULL AND REGEXP_CONTAINS(v,r'^[A-Za-z][A-Za-z0-9_+/-]*$') AND SAFE.FORMAT_TIMESTAMP('%F',TIMESTAMP '2026-01-01 00:00:00+00',v) IS NOT NULL);
-- BEGIN SINGLE INVOCATION
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'invalid configuration cardinality';
-- END SINGLE INVOCATION
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(report_scope))='STRING' AND TYPEOF(ANY_VALUE(report_timezone))='STRING' AND TYPEOF(ANY_VALUE(report_start))='DATE' AND TYPEOF(ANY_VALUE(report_end))='DATE' AND TYPEOF(ANY_VALUE(date_mode))='STRING' AND TYPEOF(ANY_VALUE(source_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(report_evidence_ref))='STRING' AND TYPEOF(ANY_VALUE(abs_tolerance))='NUMERIC' AND TYPEOF(ANY_VALUE(relative_tolerance))='NUMERIC' FROM configuration_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(pair_key))='STRING' AND TYPEOF(ANY_VALUE(ad_source_system))='STRING' AND TYPEOF(ANY_VALUE(ad_source_scope))='STRING' AND TYPEOF(ANY_VALUE(reference_source_system))='STRING' AND TYPEOF(ANY_VALUE(reference_source_scope))='STRING' AND TYPEOF(ANY_VALUE(ad_complete))='BOOL' AND TYPEOF(ANY_VALUE(reference_complete))='BOOL' AND TYPEOF(ANY_VALUE(ad_timezone))='STRING' AND TYPEOF(ANY_VALUE(reference_timezone))='STRING' AND TYPEOF(ANY_VALUE(ad_history_start))='DATE' AND TYPEOF(ANY_VALUE(reference_history_start))='DATE' AND TYPEOF(ANY_VALUE(ad_includes_deleted))='BOOL' AND TYPEOF(ANY_VALUE(reference_includes_deleted))='BOOL' AND TYPEOF(ANY_VALUE(ad_status_filter))='STRING' AND TYPEOF(ANY_VALUE(reference_status_filter))='STRING' AND TYPEOF(ANY_VALUE(ad_capture_mode))='STRING' AND TYPEOF(ANY_VALUE(reference_capture_mode))='STRING' AND TYPEOF(ANY_VALUE(comparability_evidence_ref))='STRING' FROM membership_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(fact_key))='STRING' AND TYPEOF(ANY_VALUE(event_date))='DATE' AND TYPEOF(ANY_VALUE(campaign_key))='STRING' AND TYPEOF(ANY_VALUE(spend))='NUMERIC' AND TYPEOF(ANY_VALUE(currency))='STRING' AND TYPEOF(ANY_VALUE(spend_status))='STRING' AND TYPEOF(ANY_VALUE(ad_key))='STRING' FROM ad_input) AS 'invalid input column types';
ASSERT (SELECT TYPEOF(ANY_VALUE(invocation_key))='STRING' AND TYPEOF(ANY_VALUE(source_system))='STRING' AND TYPEOF(ANY_VALUE(source_scope))='STRING' AND TYPEOF(ANY_VALUE(fact_key))='STRING' AND TYPEOF(ANY_VALUE(event_date))='DATE' AND TYPEOF(ANY_VALUE(campaign_key))='STRING' AND TYPEOF(ANY_VALUE(spend))='NUMERIC' AND TYPEOF(ANY_VALUE(currency))='STRING' AND TYPEOF(ANY_VALUE(spend_status))='STRING' FROM reference_input) AS 'invalid input column types';

ASSERT NOT EXISTS(SELECT invocation_key FROM configuration_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'invalid configuration cardinality';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope) OR NOT valid_key(source_evidence_ref) OR NOT valid_key(report_evidence_ref) OR NOT valid_zone(report_timezone)
 OR report_start IS NULL OR report_end IS NULL OR report_start>report_end OR date_mode IS NULL OR date_mode NOT IN('cohort','activity') OR abs_tolerance IS NULL OR abs_tolerance<0 OR relative_tolerance IS NULL OR relative_tolerance<0 OR relative_tolerance>1) AS 'invalid invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM (SELECT invocation_key FROM membership_input UNION ALL SELECT invocation_key FROM ad_input UNION ALL SELECT invocation_key FROM reference_input) x LEFT JOIN configuration_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
ASSERT NOT EXISTS(SELECT 1 FROM configuration_input c LEFT JOIN membership_input m USING(invocation_key) WHERE m.invocation_key IS NULL) AS 'comparison pairs are required';
ASSERT NOT EXISTS(SELECT 1 FROM membership_input WHERE NOT valid_key(pair_key) OR NOT valid_key(ad_source_system) OR NOT valid_key(ad_source_scope) OR NOT valid_key(reference_source_system) OR NOT valid_key(reference_source_scope) OR NOT valid_key(comparability_evidence_ref)
 OR ad_complete IS NULL OR reference_complete IS NULL OR NOT valid_zone(ad_timezone) OR NOT valid_zone(reference_timezone)
 OR (ad_status_filter IS NOT NULL AND NOT valid_key(ad_status_filter)) OR (reference_status_filter IS NOT NULL AND NOT valid_key(reference_status_filter))
 OR ad_capture_mode IS NULL OR ad_capture_mode NOT IN('incremental_snapshot','historical_backfill','unknown') OR reference_capture_mode IS NULL OR reference_capture_mode NOT IN('incremental_snapshot','historical_backfill','unknown')) AS 'invalid comparison pair';
ASSERT NOT EXISTS(SELECT invocation_key,pair_key FROM membership_input GROUP BY 1,2 HAVING COUNT(DISTINCT TO_JSON_STRING(membership_input))>1) AS 'conflicting comparison pair';
CREATE TEMP TABLE pairs AS SELECT DISTINCT * FROM membership_input;
ASSERT NOT EXISTS(SELECT 1 FROM ad_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(fact_key) OR event_date IS NULL OR (campaign_key IS NOT NULL AND NOT valid_key(campaign_key)) OR (ad_key IS NOT NULL AND NOT valid_key(ad_key)) OR spend_status IS NULL OR spend_status NOT IN('known','unknown','mixed_currency') OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$'))
 OR (spend_status='known' AND (spend IS NULL OR currency IS NULL)) OR (spend_status!='known' AND spend IS NOT NULL) OR (spend_status='mixed_currency' AND currency IS NOT NULL)) AS 'invalid spend fact';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,fact_key FROM ad_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(ad_input))>1) AS 'conflicting spend fact';
CREATE TEMP TABLE ad_unique AS SELECT DISTINCT * FROM ad_input;
CREATE TEMP TABLE ad_members AS SELECT DISTINCT invocation_key,ad_source_system AS source_system,ad_source_scope AS source_scope FROM pairs;
CREATE TEMP TABLE ad_selected AS SELECT f.* FROM ad_unique f JOIN ad_members USING(invocation_key,source_system,source_scope) JOIN configuration_input c USING(invocation_key) WHERE f.event_date BETWEEN c.report_start AND c.report_end;
CREATE TEMP TABLE ad_paired AS SELECT p.pair_key,f.* FROM ad_selected f JOIN pairs p ON f.invocation_key=p.invocation_key AND f.source_system=p.ad_source_system AND f.source_scope=p.ad_source_scope;
CREATE TEMP TABLE ad_summary AS SELECT invocation_key,pair_key,event_date,COUNT(*) AS fact_count,COUNTIF(campaign_key IS NULL) AS unassigned_count,COUNTIF(spend_status='unknown') AS unknown_money_count,COUNTIF(spend_status='mixed_currency') AS mixed_currency_count,COUNTIF(ad_key IS NULL) AS missing_ad_key_count,
ARRAY_AGG(STRUCT(fact_key,campaign_key,ad_key,CAST(spend AS STRING) AS spend,currency,spend_status) ORDER BY fact_key) AS evidence
 FROM ad_paired GROUP BY 1,2,3;
CREATE TEMP TABLE ad_currency AS SELECT invocation_key,pair_key,event_date,currency,SUM(CAST(spend AS BIGNUMERIC)) AS spend FROM ad_paired WHERE spend_status='known' GROUP BY 1,2,3,4;
CREATE TEMP TABLE ad_subtotals AS SELECT invocation_key,pair_key,event_date,ARRAY_AGG(STRUCT(currency,CAST(spend AS STRING) AS spend) ORDER BY currency) AS subtotals FROM ad_currency GROUP BY 1,2,3;
CREATE TEMP TABLE ad_campaign AS SELECT invocation_key,pair_key,event_date,campaign_key,currency,COUNT(*) AS fact_count,SUM(IF(spend_status='known',CAST(spend AS BIGNUMERIC),NULL)) AS known_spend FROM ad_paired WHERE campaign_key IS NOT NULL AND currency IS NOT NULL GROUP BY 1,2,3,4,5;
ASSERT NOT EXISTS(SELECT 1 FROM reference_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(fact_key) OR event_date IS NULL OR (campaign_key IS NOT NULL AND NOT valid_key(campaign_key)) OR spend_status IS NULL OR spend_status NOT IN('known','unknown','mixed_currency') OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$'))
 OR (spend_status='known' AND (spend IS NULL OR currency IS NULL)) OR (spend_status!='known' AND spend IS NOT NULL) OR (spend_status='mixed_currency' AND currency IS NOT NULL)) AS 'invalid spend fact';
ASSERT NOT EXISTS(SELECT invocation_key,source_system,source_scope,fact_key FROM reference_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(reference_input))>1) AS 'conflicting spend fact';
CREATE TEMP TABLE reference_unique AS SELECT DISTINCT * FROM reference_input;
CREATE TEMP TABLE reference_members AS SELECT DISTINCT invocation_key,reference_source_system AS source_system,reference_source_scope AS source_scope FROM pairs;
CREATE TEMP TABLE reference_selected AS SELECT f.* FROM reference_unique f JOIN reference_members USING(invocation_key,source_system,source_scope) JOIN configuration_input c USING(invocation_key) WHERE f.event_date BETWEEN c.report_start AND c.report_end;
CREATE TEMP TABLE reference_paired AS SELECT p.pair_key,f.* FROM reference_selected f JOIN pairs p ON f.invocation_key=p.invocation_key AND f.source_system=p.reference_source_system AND f.source_scope=p.reference_source_scope;
CREATE TEMP TABLE reference_summary AS SELECT invocation_key,pair_key,event_date,COUNT(*) AS fact_count,COUNTIF(campaign_key IS NULL) AS unassigned_count,COUNTIF(spend_status='unknown') AS unknown_money_count,COUNTIF(spend_status='mixed_currency') AS mixed_currency_count,0 AS missing_ad_key_count,
ARRAY_AGG(STRUCT(fact_key,campaign_key,CAST(spend AS STRING) AS spend,currency,spend_status) ORDER BY fact_key) AS evidence
 FROM reference_paired GROUP BY 1,2,3;
CREATE TEMP TABLE reference_currency AS SELECT invocation_key,pair_key,event_date,currency,SUM(CAST(spend AS BIGNUMERIC)) AS spend FROM reference_paired WHERE spend_status='known' GROUP BY 1,2,3,4;
CREATE TEMP TABLE reference_subtotals AS SELECT invocation_key,pair_key,event_date,ARRAY_AGG(STRUCT(currency,CAST(spend AS STRING) AS spend) ORDER BY currency) AS subtotals FROM reference_currency GROUP BY 1,2,3;
CREATE TEMP TABLE reference_campaign AS SELECT invocation_key,pair_key,event_date,campaign_key,currency,COUNT(*) AS fact_count,SUM(IF(spend_status='known',CAST(spend AS BIGNUMERIC),NULL)) AS known_spend FROM reference_paired WHERE campaign_key IS NOT NULL AND currency IS NOT NULL GROUP BY 1,2,3,4,5;

CREATE TEMP TABLE date_evidence AS SELECT p.invocation_key,p.pair_key,(SELECT AS STRUCT p.* EXCEPT(invocation_key)) AS pair,event_date,
 IFNULL(a.fact_count,0) AS ad_fact_count,IFNULL(r.fact_count,0) AS reference_fact_count,
 IFNULL(a.unassigned_count,0) AS ad_unassigned_count,IFNULL(r.unassigned_count,0) AS reference_unassigned_count,
 IFNULL(a.unknown_money_count,0) AS ad_unknown_money_count,IFNULL(r.unknown_money_count,0) AS reference_unknown_money_count,
 IFNULL(a.mixed_currency_count,0) AS ad_mixed_currency_count,IFNULL(r.mixed_currency_count,0) AS reference_mixed_currency_count,
 IFNULL(a.missing_ad_key_count,0) AS ad_missing_key_count,IFNULL(a.evidence,[]) AS ad_evidence,IFNULL(r.evidence,[]) AS reference_evidence,
 IFNULL(ac.subtotals,[]) AS ad_known_subtotals,IFNULL(rc.subtotals,[]) AS reference_known_subtotals,
 ARRAY(SELECT reason FROM UNNEST([
 IF(NOT p.ad_complete,'ad_incomplete',NULL),IF(NOT p.reference_complete,'reference_incomplete',NULL),
 IF(p.ad_history_start IS NULL,'ad_history_unknown',NULL),IF(p.reference_history_start IS NULL,'reference_history_unknown',NULL),
 IF(p.ad_history_start>event_date,'ad_history_not_covered',NULL),IF(p.reference_history_start>event_date,'reference_history_not_covered',NULL),
 IF(p.ad_timezone!=c.report_timezone,'ad_timezone_mismatch',NULL),IF(p.reference_timezone!=c.report_timezone,'reference_timezone_mismatch',NULL),
 IF(p.ad_includes_deleted IS NULL OR p.reference_includes_deleted IS NULL,'deleted_scope_unknown',NULL),
 IF(p.ad_includes_deleted!=p.reference_includes_deleted,'deleted_scope_mismatch',NULL),IF(p.ad_includes_deleted=FALSE OR p.reference_includes_deleted=FALSE,'deleted_scope_excluded',NULL),
 IF(p.ad_status_filter IS NULL OR p.reference_status_filter IS NULL,'status_filter_unknown',NULL),IF(p.ad_status_filter!=p.reference_status_filter,'status_filter_mismatch',NULL),
 IF(p.ad_capture_mode='unknown' OR p.reference_capture_mode='unknown','capture_mode_unknown',NULL),
 IF(IFNULL(a.unassigned_count,0)+IFNULL(r.unassigned_count,0)>0,'unassigned_campaign',NULL),
 IF(IFNULL(a.unknown_money_count,0)+IFNULL(r.unknown_money_count,0)>0,'unknown_money',NULL),
 IF(IFNULL(a.mixed_currency_count,0)+IFNULL(r.mixed_currency_count,0)>0,'mixed_currency_money',NULL)
 ]) reason WHERE reason IS NOT NULL ORDER BY reason) AS blocking_reasons,
 ARRAY(SELECT reason FROM UNNEST([
 IF(p.ad_capture_mode!=p.reference_capture_mode AND p.ad_capture_mode!='unknown' AND p.reference_capture_mode!='unknown','capture_mode_difference',NULL),
 IF(IFNULL(a.missing_ad_key_count,0)>0,'missing_ad_key',NULL)]) reason WHERE reason IS NOT NULL ORDER BY reason) AS caveat_reasons
 FROM pairs p JOIN configuration_input c USING(invocation_key) CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(c.report_start,c.report_end)) event_date
 LEFT JOIN ad_summary a USING(invocation_key,pair_key,event_date) LEFT JOIN reference_summary r USING(invocation_key,pair_key,event_date)
 LEFT JOIN ad_subtotals ac USING(invocation_key,pair_key,event_date) LEFT JOIN reference_subtotals rc USING(invocation_key,pair_key,event_date);
CREATE TEMP TABLE campaign_keys AS SELECT invocation_key,pair_key,event_date,campaign_key,currency FROM ad_campaign UNION DISTINCT SELECT invocation_key,pair_key,event_date,campaign_key,currency FROM reference_campaign;
CREATE TEMP TABLE comparison_amounts AS SELECT k.*,IFNULL(a.fact_count,0) AS ad_fact_count,IFNULL(r.fact_count,0) AS reference_fact_count,a.known_spend AS ad_known_spend,r.known_spend AS reference_known_spend,
 IF(ARRAY_LENGTH(d.blocking_reasons)=0,IFNULL(a.known_spend,0),NULL) AS ad_spend,IF(ARRAY_LENGTH(d.blocking_reasons)=0,IFNULL(r.known_spend,0),NULL) AS reference_spend,c.abs_tolerance,c.relative_tolerance
 FROM campaign_keys k JOIN date_evidence d USING(invocation_key,pair_key,event_date) JOIN configuration_input c USING(invocation_key)
 LEFT JOIN ad_campaign a USING(invocation_key,pair_key,event_date,campaign_key,currency) LEFT JOIN reference_campaign r USING(invocation_key,pair_key,event_date,campaign_key,currency);
CREATE TEMP TABLE comparison_values AS SELECT *,ad_spend-reference_spend AS difference,IF(reference_spend IS NOT NULL,GREATEST(CAST(abs_tolerance AS BIGNUMERIC),ABS(reference_spend)*CAST(relative_tolerance AS BIGNUMERIC)),NULL) AS allowed_tolerance FROM comparison_amounts;
CREATE TEMP TABLE comparisons AS SELECT invocation_key,pair_key,event_date,COUNTIF(ABS(difference)>allowed_tolerance)>0 AS has_gap,
 ARRAY_AGG(STRUCT(campaign_key,currency,CAST(ad_fact_count AS STRING) AS ad_fact_count,CAST(reference_fact_count AS STRING) AS reference_fact_count,CAST(ad_known_spend AS STRING) AS ad_known_spend,CAST(reference_known_spend AS STRING) AS reference_known_spend,
 CAST(ad_spend AS STRING) AS ad_spend,CAST(reference_spend AS STRING) AS reference_spend,CAST(difference AS STRING) AS difference,CAST(allowed_tolerance AS STRING) AS allowed_tolerance,
 CASE WHEN difference IS NULL THEN 'unknown' WHEN ABS(difference)>allowed_tolerance THEN 'fail' ELSE 'pass' END AS status) ORDER BY campaign_key,currency) AS comparisons FROM comparison_values GROUP BY 1,2,3;
CREATE TEMP TABLE date_findings AS SELECT d.* EXCEPT(blocking_reasons,caveat_reasons),ARRAY_LENGTH(blocking_reasons)=0 AS comparable,IFNULL(x.comparisons,[]) AS comparisons,
 CASE WHEN ARRAY_LENGTH(blocking_reasons)>0 THEN 'unknown' WHEN IFNULL(x.has_gap,FALSE) THEN 'fail' ELSE 'pass' END AS status,
 ARRAY(SELECT DISTINCT reason FROM UNNEST(ARRAY_CONCAT(blocking_reasons,caveat_reasons,[IF(IFNULL(x.has_gap,FALSE),'spend_coverage_gap',NULL),IF(ARRAY_LENGTH(blocking_reasons)=0 AND ad_fact_count=0 AND reference_fact_count=0,'empty_complete_date',NULL)])) reason WHERE reason IS NOT NULL ORDER BY reason) AS reasons
 FROM date_evidence d LEFT JOIN comparisons x USING(invocation_key,pair_key,event_date);
CREATE TEMP TABLE ad_diagnostics AS SELECT c.invocation_key,
 (SELECT COUNT(*) FROM ad_input x WHERE x.invocation_key=c.invocation_key) AS raw_facts,
 (SELECT COUNT(*) FROM ad_input x WHERE x.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM ad_unique x WHERE x.invocation_key=c.invocation_key) AS duplicates_collapsed,
 (SELECT COUNT(*) FROM ad_unique x LEFT JOIN ad_members m USING(invocation_key,source_system,source_scope) WHERE x.invocation_key=c.invocation_key AND m.invocation_key IS NULL) AS nonmember_facts,
 (SELECT COUNT(*) FROM ad_unique x JOIN ad_members m USING(invocation_key,source_system,source_scope) WHERE x.invocation_key=c.invocation_key AND x.event_date NOT BETWEEN c.report_start AND c.report_end) AS out_of_window_facts,
 (SELECT COUNT(*) FROM ad_selected x WHERE x.invocation_key=c.invocation_key) AS selected_facts
 FROM configuration_input c;
CREATE TEMP TABLE reference_diagnostics AS SELECT c.invocation_key,
 (SELECT COUNT(*) FROM reference_input x WHERE x.invocation_key=c.invocation_key) AS raw_facts,
 (SELECT COUNT(*) FROM reference_input x WHERE x.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM reference_unique x WHERE x.invocation_key=c.invocation_key) AS duplicates_collapsed,
 (SELECT COUNT(*) FROM reference_unique x LEFT JOIN reference_members m USING(invocation_key,source_system,source_scope) WHERE x.invocation_key=c.invocation_key AND m.invocation_key IS NULL) AS nonmember_facts,
 (SELECT COUNT(*) FROM reference_unique x JOIN reference_members m USING(invocation_key,source_system,source_scope) WHERE x.invocation_key=c.invocation_key AND x.event_date NOT BETWEEN c.report_start AND c.report_end) AS out_of_window_facts,
 (SELECT COUNT(*) FROM reference_selected x WHERE x.invocation_key=c.invocation_key) AS selected_facts
 FROM configuration_input c;

CREATE TEMP TABLE reason_summary AS SELECT invocation_key,ARRAY_AGG(DISTINCT reason ORDER BY reason) AS reasons FROM date_findings,UNNEST(reasons) reason GROUP BY 1;
CREATE TEMP TABLE detail_summary AS SELECT invocation_key,COUNTIF(status='fail')>0 AS has_fail,COUNTIF(status='unknown')>0 AS has_unknown,COUNT(*) AS compared_dates,COUNT(DISTINCT pair_key) AS compared_pairs,
 ARRAY_AGG(STRUCT(pair,event_date,comparable,CAST(ad_fact_count AS STRING) AS ad_fact_count,CAST(reference_fact_count AS STRING) AS reference_fact_count,CAST(ad_unassigned_count AS STRING) AS ad_unassigned_count,CAST(reference_unassigned_count AS STRING) AS reference_unassigned_count,CAST(ad_unknown_money_count AS STRING) AS ad_unknown_money_count,CAST(reference_unknown_money_count AS STRING) AS reference_unknown_money_count,CAST(ad_mixed_currency_count AS STRING) AS ad_mixed_currency_count,CAST(reference_mixed_currency_count AS STRING) AS reference_mixed_currency_count,CAST(ad_missing_key_count AS STRING) AS ad_missing_key_count,ad_known_subtotals,reference_known_subtotals,ad_evidence,reference_evidence,comparisons,status,reasons) ORDER BY pair_key,event_date) AS details FROM date_findings GROUP BY 1;
CREATE TEMP TABLE missing_ad_summary AS SELECT invocation_key,COUNTIF(ad_key IS NULL) AS missing_ad_key_count FROM ad_selected GROUP BY 1;
SELECT c.invocation_key,TO_JSON_STRING(STRUCT('deleted_ad_coverage' AS check_id,'0.1.0' AS contract_version,
 STRUCT(c.invocation_key,c.report_scope,c.report_timezone,c.report_start,c.report_end,c.date_mode,c.source_evidence_ref,c.report_evidence_ref,CAST(c.abs_tolerance AS STRING) AS abs_tolerance,CAST(c.relative_tolerance AS STRING) AS relative_tolerance) AS configuration,
 CASE WHEN d.has_fail THEN 'fail' WHEN d.has_unknown THEN 'unknown' ELSE 'pass' END AS status,
 IFNULL(z.reasons,[]) AS reasons,[c.source_evidence_ref,c.report_evidence_ref] AS evidence_refs,
 d.details,
 STRUCT(CAST(a.raw_facts AS STRING) AS ad_raw_facts,CAST(a.duplicates_collapsed AS STRING) AS ad_duplicates_collapsed,CAST(a.nonmember_facts AS STRING) AS ad_nonmember_facts,CAST(a.out_of_window_facts AS STRING) AS ad_out_of_window_facts,CAST(a.selected_facts AS STRING) AS ad_selected_facts,
 CAST(r.raw_facts AS STRING) AS reference_raw_facts,CAST(r.duplicates_collapsed AS STRING) AS reference_duplicates_collapsed,CAST(r.nonmember_facts AS STRING) AS reference_nonmember_facts,CAST(r.out_of_window_facts AS STRING) AS reference_out_of_window_facts,CAST(r.selected_facts AS STRING) AS reference_selected_facts,
 CAST(d.compared_pairs AS STRING) AS compared_pairs,CAST(d.compared_dates AS STRING) AS compared_dates,CAST(IFNULL(k.missing_ad_key_count,0) AS STRING) AS missing_ad_key_count) AS diagnostics
)) AS result_json FROM configuration_input c JOIN detail_summary d USING(invocation_key) LEFT JOIN missing_ad_summary k USING(invocation_key) JOIN ad_diagnostics a USING(invocation_key) JOIN reference_diagnostics r USING(invocation_key) LEFT JOIN reason_summary z USING(invocation_key) ORDER BY invocation_key;

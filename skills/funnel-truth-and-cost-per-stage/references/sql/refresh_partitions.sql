-- Native Standard SQL refresh planning. Authoritative snapshots; temporary objects only.
-- BEGIN REPLACEABLE INPUTS
CREATE TEMP TABLE invocation_input AS
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('UTC' AS STRING) AS prior_report_timezone, CAST('2026-07-10T00:00:00Z' AS TIMESTAMP) AS prior_watermark, CAST('2026-07-12T00:00:00Z' AS TIMESTAMP) AS as_of, CAST('2' AS INT64) AS overlap_days, TRUE AS change_feed_complete, TRUE AS prior_snapshot_complete, TRUE AS current_snapshot_complete;
CREATE TEMP TABLE prior_ledger_input AS
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Changed' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS INT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-01T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-05-10T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, CAST('2026-01-01' AS DATE) AS cohort_date, CAST('2026-05-10' AS DATE) AS activity_date, TRUE AS is_attribution_primary, CAST('10' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, [STRUCT(CAST('synthetic_opportunities' AS STRING) AS source_system,CAST('opportunity-a' AS STRING) AS source_scope,CAST('opportunity' AS STRING) AS record_kind,CAST('Win+Changed' AS STRING) AS record_key)] AS evidence_keys, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution
UNION ALL
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Unaffected' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS INT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-01T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-05-10T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, CAST('2026-01-01' AS DATE) AS cohort_date, CAST('2026-05-10' AS DATE) AS activity_date, TRUE AS is_attribution_primary, CAST('10' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, [STRUCT(CAST('synthetic_opportunities' AS STRING) AS source_system,CAST('opportunity-a' AS STRING) AS source_scope,CAST('opportunity' AS STRING) AS record_kind,CAST('Win+Unaffected' AS STRING) AS record_key)] AS evidence_keys, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution;
CREATE TEMP TABLE current_ledger_input AS
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Changed' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS INT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-01T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-07-11T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, CAST('2026-01-01' AS DATE) AS cohort_date, CAST('2026-07-11' AS DATE) AS activity_date, TRUE AS is_attribution_primary, CAST('15' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, [STRUCT(CAST('synthetic_opportunities' AS STRING) AS source_system,CAST('opportunity-a' AS STRING) AS source_scope,CAST('opportunity' AS STRING) AS record_kind,CAST('Win+Changed' AS STRING) AS record_key)] AS evidence_keys, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution
UNION ALL
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Unaffected' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS INT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-01T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-05-10T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, CAST('2026-01-01' AS DATE) AS cohort_date, CAST('2026-05-10' AS DATE) AS activity_date, TRUE AS is_attribution_primary, CAST('10' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, [STRUCT(CAST('synthetic_opportunities' AS STRING) AS source_system,CAST('opportunity-a' AS STRING) AS source_scope,CAST('opportunity' AS STRING) AS record_kind,CAST('Win+Unaffected' AS STRING) AS record_key)] AS evidence_keys, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution;
CREATE TEMP TABLE change_input AS
SELECT CAST('late-won-rewrite-preserves-unaffected' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Changed' AS STRING) AS lead_key, CAST('Change+A' AS STRING) AS change_key, CAST('2026-07-11T00:00:00Z' AS TIMESTAMP) AS changed_at, CAST('opportunity' AS STRING) AS reason;
-- END REPLACEABLE INPUTS
-- BEGIN INVOCATION CARDINALITY CHECK
ASSERT (SELECT COUNT(*)=1 FROM invocation_input) AS 'exactly one invocation configuration is required';
-- END INVOCATION CARDINALITY CHECK
ASSERT NOT EXISTS (SELECT 1 FROM invocation_input WHERE invocation_key IS NULL OR invocation_key='' OR invocation_key!=TRIM(invocation_key)
 OR source_system IS NULL OR source_system='' OR source_system!=TRIM(source_system)
 OR source_scope IS NULL OR source_scope='' OR source_scope!=TRIM(source_scope)
 OR prior_watermark IS NULL OR as_of IS NULL OR as_of<prior_watermark OR overlap_days IS NULL OR overlap_days<=0
 OR change_feed_complete IS NULL OR prior_snapshot_complete IS NULL OR current_snapshot_complete IS NULL
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')
 OR prior_report_timezone IS NULL OR NOT REGEXP_CONTAINS(prior_report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$')) AS 'invalid required invocation configuration';
ASSERT (SELECT COUNTIF(FORMAT_TIMESTAMP('%F',as_of,report_timezone) IS NOT NULL AND FORMAT_TIMESTAMP('%F',as_of,prior_report_timezone) IS NOT NULL)=COUNT(*) FROM invocation_input) AS 'invalid report timezone';
ASSERT NOT EXISTS (SELECT 1 FROM invocation_input WHERE NOT prior_snapshot_complete OR NOT current_snapshot_complete)
 AS 'complete prior and current snapshots are required for replacement planning';
ASSERT NOT EXISTS (SELECT invocation_key FROM invocation_input GROUP BY 1 HAVING COUNT(*)!=1) AS 'duplicate invocation configuration';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT invocation_key FROM prior_ledger_input UNION ALL SELECT invocation_key FROM current_ledger_input UNION ALL SELECT invocation_key FROM change_input
 ) x LEFT JOIN invocation_input c USING(invocation_key) WHERE c.invocation_key IS NULL) AS 'missing invocation configuration';
CREATE TEMP TABLE raw_snapshots AS
SELECT 'prior' AS snapshot_side,* FROM prior_ledger_input UNION ALL SELECT 'current',* FROM current_ledger_input;
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT invocation_key,source_system,source_scope,lead_key FROM raw_snapshots
 UNION ALL SELECT invocation_key,source_system,source_scope,lead_key FROM change_input
 ) l JOIN invocation_input c USING(invocation_key) WHERE l.source_system IS NULL OR l.source_scope IS NULL OR l.lead_key IS NULL
 OR l.source_system='' OR l.source_scope='' OR l.lead_key='' OR l.source_system!=TRIM(l.source_system)
 OR l.source_scope!=TRIM(l.source_scope) OR l.lead_key!=TRIM(l.lead_key)
 OR l.source_system!=c.source_system OR l.source_scope!=c.source_scope) AS 'invalid scoped CRM lead identity';
ASSERT NOT EXISTS (SELECT 1 FROM change_input WHERE change_key IS NULL OR change_key='' OR change_key!=TRIM(change_key)
 OR changed_at IS NULL OR reason IS NULL OR reason NOT IN ('lead','opportunity','event','deletion','configuration')) AS 'invalid change record';
ASSERT NOT EXISTS (SELECT 1 FROM raw_snapshots WHERE stage_key IS NULL OR stage_key='' OR stage_key!=TRIM(stage_key)
 OR stage_order IS NULL OR stage_kind IS NULL OR stage_kind NOT IN ('lead','qualified','converted','won','event')
 OR is_attribution_primary IS NULL OR evidence_keys IS NULL OR attribution IS NULL
 OR stage_truth_status IS NULL OR stage_truth_status NOT IN ('achieved','achieved_undated','not_achieved','pending_future_evidence','unknown')
 OR (achieved IS NULL AND stage_truth_status!='unknown')
 OR (achieved IS TRUE AND (stage_truth_status NOT IN ('achieved','achieved_undated') OR (stage_entered_at IS NULL)!=(stage_truth_status='achieved_undated')))
 OR (achieved IS FALSE AND stage_truth_status NOT IN ('not_achieved','pending_future_evidence'))
 OR (achieved IS NOT TRUE AND stage_entered_at IS NOT NULL)) AS 'invalid stage ledger record';
ASSERT NOT EXISTS (SELECT 1 FROM raw_snapshots,UNNEST(evidence_keys) e
 WHERE e.source_system IS NULL OR e.source_scope IS NULL OR e.record_key IS NULL OR e.record_kind IS NULL
 OR e.source_system='' OR e.source_scope='' OR e.record_key='' OR e.source_system!=TRIM(e.source_system)
 OR e.source_scope!=TRIM(e.source_scope) OR e.record_key!=TRIM(e.record_key)
 OR e.record_kind NOT IN ('lead','opportunity','event')) AS 'invalid qualified stage evidence';
ASSERT NOT EXISTS (SELECT 1 FROM raw_snapshots WHERE value_status IS NULL OR value_status NOT IN ('known','unknown','mixed_currency')
 OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$'))
 OR (value_status='known' AND (value IS NULL OR currency IS NULL))
 OR (value_status!='known' AND value IS NOT NULL) OR (value_status='mixed_currency' AND currency IS NOT NULL)) AS 'invalid monetary contract';
ASSERT NOT EXISTS (SELECT 1 FROM raw_snapshots WHERE
 (attribution.channel IS NOT NULL OR attribution.taxonomy_version IS NOT NULL) AND
 (attribution.channel IS NULL OR attribution.taxonomy_version IS NULL OR attribution.taxonomy_version!='0.1.0'
 OR attribution.channel NOT IN ('Paid Search','Paid Social','Paid Other','Organic Search','Organic Social','Email','SMS','Direct','Referral','Affiliate','Other')))
 AS 'invalid canonical attribution metadata';
ASSERT NOT EXISTS (SELECT 1 FROM raw_snapshots WHERE
 (attribution.network_id IS NOT NULL AND (attribution.network_id='' OR attribution.network_id!=TRIM(attribution.network_id)))
 OR (attribution.campaign_key IS NOT NULL AND (attribution.campaign_key='' OR attribution.campaign_key!=TRIM(attribution.campaign_key)))
 OR ((attribution.ad_source_system IS NOT NULL OR attribution.ad_source_scope IS NOT NULL OR attribution.ad_key IS NOT NULL)
 AND (attribution.ad_source_system IS NULL OR attribution.ad_source_scope IS NULL OR attribution.ad_key IS NULL
 OR attribution.ad_source_system='' OR attribution.ad_source_scope='' OR attribution.ad_key=''
 OR attribution.ad_source_system!=TRIM(attribution.ad_source_system) OR attribution.ad_source_scope!=TRIM(attribution.ad_source_scope) OR attribution.ad_key!=TRIM(attribution.ad_key))))
 AS 'invalid optional attribution identity';
-- Canonical evidence ordering makes physical row/array ordering irrelevant; all fields and multiplicity remain.
CREATE TEMP TABLE normalized_snapshots AS
SELECT * REPLACE(ARRAY(SELECT AS STRUCT e.* FROM UNNEST(evidence_keys) e ORDER BY e.source_system,e.source_scope,e.record_kind,e.record_key) AS evidence_keys)
FROM raw_snapshots;
ASSERT NOT EXISTS (SELECT snapshot_side,invocation_key,source_system,source_scope,lead_key,stage_key FROM normalized_snapshots
 GROUP BY 1,2,3,4,5,6 HAVING COUNT(DISTINCT TO_JSON_STRING(normalized_snapshots))>1) AS 'conflicting scoped stage ledger identity';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,change_key FROM change_input
 GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(change_input))>1) AS 'conflicting scoped change identity';
CREATE TEMP TABLE snapshots AS SELECT DISTINCT * FROM normalized_snapshots;
CREATE TEMP TABLE changes AS SELECT DISTINCT * FROM change_input;
-- BEGIN SATURATED OVERLAP
-- BIGNUMERIC prevents INT64 day-to-microsecond overflow before the timestamp operation.
CREATE TEMP TABLE bounded_invocation AS
SELECT c.*,IF(
 CAST(overlap_days AS BIGNUMERIC)*BIGNUMERIC '86400000000'
 >=CAST(TIMESTAMP_DIFF(prior_watermark,TIMESTAMP '0001-01-01T00:00:00Z',MICROSECOND) AS BIGNUMERIC),
 TIMESTAMP '0001-01-01T00:00:00Z',
 TIMESTAMP_SUB(prior_watermark,INTERVAL overlap_days DAY)) AS overlap_start
FROM invocation_input c;
-- END SATURATED OVERLAP
CREATE TEMP TABLE change_evidence AS
SELECT x.*,CASE WHEN x.changed_at<c.overlap_start THEN 'before_overlap'
 WHEN x.changed_at>c.as_of THEN 'future' ELSE 'selected' END AS selection_status
FROM changes x JOIN bounded_invocation c USING(invocation_key);
CREATE TEMP TABLE selected_changes AS SELECT * FROM change_evidence WHERE selection_status='selected';
CREATE TEMP TABLE changed_leads AS SELECT DISTINCT invocation_key,source_system,source_scope,lead_key FROM selected_changes;
CREATE TEMP TABLE semantic_rows AS
SELECT snapshot_side,invocation_key,source_system,source_scope,lead_key,stage_key,
 (SELECT AS STRUCT s.* EXCEPT(snapshot_side,invocation_key)) AS ledger
FROM snapshots s;
CREATE TEMP TABLE different_leads AS
SELECT DISTINCT COALESCE(p.invocation_key,n.invocation_key) AS invocation_key,
 COALESCE(p.source_system,n.source_system) AS source_system,COALESCE(p.source_scope,n.source_scope) AS source_scope,
 COALESCE(p.lead_key,n.lead_key) AS lead_key
FROM (SELECT * FROM semantic_rows WHERE snapshot_side='prior') p
FULL OUTER JOIN (SELECT * FROM semantic_rows WHERE snapshot_side='current') n
 ON p.invocation_key=n.invocation_key AND p.source_system=n.source_system AND p.source_scope=n.source_scope
 AND p.lead_key=n.lead_key AND p.stage_key=n.stage_key
WHERE p.lead_key IS NULL OR n.lead_key IS NULL OR TO_JSON_STRING(p.ledger)!=TO_JSON_STRING(n.ledger);
CREATE TEMP TABLE uncovered_leads AS
SELECT d.* FROM different_leads d LEFT JOIN changed_leads c USING(invocation_key,source_system,source_scope,lead_key) WHERE c.lead_key IS NULL;
CREATE TEMP TABLE refresh_modes AS
SELECT c.*,
 IF(c.prior_report_timezone!=c.report_timezone OR NOT c.change_feed_complete OR IFNULL(u.uncovered_count,0)>0,'full_reconciliation','incremental') AS mode,
 ARRAY_CONCAT(IF(c.prior_report_timezone!=c.report_timezone,['timezone_changed'],[]),IF(NOT c.change_feed_complete,['incomplete_change_feed'],[]),IF(IFNULL(u.uncovered_count,0)>0,['uncovered_snapshot_differences'],[])) AS fallback_reasons
FROM bounded_invocation c LEFT JOIN (SELECT invocation_key,COUNT(*) AS uncovered_count FROM uncovered_leads GROUP BY 1) u USING(invocation_key);
CREATE TEMP TABLE expanded_snapshots AS
SELECT s.snapshot_side,s.invocation_key,s.source_system,s.source_scope,s.lead_key,s.stage_key,date_mode,
 DATE(IF(date_mode='cohort',s.ledger.cohort_at,s.ledger.stage_entered_at),IF(s.snapshot_side='prior',c.prior_report_timezone,c.report_timezone)) AS report_date,s.ledger
FROM semantic_rows s JOIN invocation_input c USING(invocation_key) CROSS JOIN UNNEST(['cohort','activity']) AS date_mode;
CREATE TEMP TABLE target_members AS
SELECT DISTINCT e.invocation_key,e.source_system,e.source_scope,e.date_mode,e.report_date,e.lead_key
FROM expanded_snapshots e JOIN refresh_modes m USING(invocation_key)
LEFT JOIN changed_leads c ON c.invocation_key=e.invocation_key AND c.source_system=e.source_system AND c.source_scope=e.source_scope AND c.lead_key=e.lead_key
WHERE m.mode='full_reconciliation' OR c.lead_key IS NOT NULL;
CREATE TEMP TABLE target_keys AS SELECT DISTINCT invocation_key,source_system,source_scope,date_mode,report_date FROM target_members;
CREATE TEMP TABLE target_evidence AS
WITH links AS (
 SELECT DISTINCT t.invocation_key,t.source_system,t.source_scope,t.date_mode,t.report_date,c.change_key
 FROM target_members t JOIN selected_changes c USING(invocation_key,source_system,source_scope,lead_key)
)
SELECT invocation_key,source_system,source_scope,date_mode,report_date,
 ARRAY_AGG(STRUCT(source_system,source_scope,change_key) ORDER BY change_key) AS evidence_keys
FROM links GROUP BY 1,2,3,4,5;
CREATE TEMP TABLE target_partitions AS
SELECT k.*,IF(m.mode='incremental','selected_change','full_reconciliation') AS reason,IFNULL(e.evidence_keys,[]) AS evidence_keys
FROM target_keys k JOIN refresh_modes m USING(invocation_key)
LEFT JOIN target_evidence e ON e.invocation_key=k.invocation_key AND e.source_system=k.source_system AND e.source_scope=k.source_scope
 AND e.date_mode=k.date_mode AND e.report_date IS NOT DISTINCT FROM k.report_date;
-- Fetch the COMPLETE current population for each target, not merely changed leads.
CREATE TEMP TABLE replacement_ledger AS
SELECT n.invocation_key,n.date_mode,n.report_date,n.ledger
FROM expanded_snapshots n JOIN target_keys t ON t.invocation_key=n.invocation_key AND t.source_system=n.source_system AND t.source_scope=n.source_scope
 AND t.date_mode=n.date_mode AND t.report_date IS NOT DISTINCT FROM n.report_date
WHERE n.snapshot_side='current';
CREATE TEMP TABLE refresh_diagnostics AS
SELECT c.invocation_key,
 (SELECT COUNT(*) FROM change_evidence x WHERE x.invocation_key=c.invocation_key AND selection_status='selected') AS selected_change_count,
 (SELECT COUNT(*) FROM change_evidence x WHERE x.invocation_key=c.invocation_key AND selection_status='before_overlap') AS before_overlap_change_count,
 (SELECT COUNT(*) FROM change_evidence x WHERE x.invocation_key=c.invocation_key AND selection_status='future') AS future_change_count,
 (SELECT COUNT(*) FROM prior_ledger_input x WHERE x.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM snapshots x WHERE x.invocation_key=c.invocation_key AND snapshot_side='prior') AS duplicate_prior_rows_collapsed,
 (SELECT COUNT(*) FROM current_ledger_input x WHERE x.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM snapshots x WHERE x.invocation_key=c.invocation_key AND snapshot_side='current') AS duplicate_current_rows_collapsed,
 (SELECT COUNT(*) FROM change_input x WHERE x.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM changes x WHERE x.invocation_key=c.invocation_key) AS duplicate_changes_collapsed
FROM invocation_input c;
WITH t AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT x.* EXCEPT(invocation_key)) ORDER BY date_mode,(report_date IS NULL),report_date) AS target_partitions FROM target_partitions x GROUP BY 1),
 r AS (SELECT invocation_key,ARRAY_AGG(STRUCT(date_mode,report_date,ledger) ORDER BY date_mode,(report_date IS NULL),report_date,ledger.lead_key,ledger.stage_order,ledger.stage_key) AS replacement_ledger FROM replacement_ledger GROUP BY 1),
 ch AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT x.* EXCEPT(invocation_key)) ORDER BY lead_key) AS changed_leads FROM changed_leads x GROUP BY 1),
 df AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT x.* EXCEPT(invocation_key)) ORDER BY lead_key) AS different_leads FROM different_leads x GROUP BY 1),
 u AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT x.* EXCEPT(invocation_key)) ORDER BY lead_key) AS uncovered_leads FROM uncovered_leads x GROUP BY 1),
 e AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT x.* EXCEPT(invocation_key)) ORDER BY change_key) AS change_evidence FROM change_evidence x GROUP BY 1)
SELECT m.invocation_key,TO_JSON_STRING(STRUCT(m.source_system,m.source_scope,m.prior_report_timezone,m.report_timezone,m.mode,m.fallback_reasons,m.overlap_start,
 m.as_of AS proposed_next_watermark,IFNULL(t.target_partitions,[]) AS target_partitions,IFNULL(r.replacement_ledger,[]) AS replacement_ledger,
 IFNULL(ch.changed_leads,[]) AS changed_leads,IFNULL(df.different_leads,[]) AS different_leads,IFNULL(u.uncovered_leads,[]) AS uncovered_leads,
 IFNULL(e.change_evidence,[]) AS change_evidence,(SELECT AS STRUCT d.* EXCEPT(invocation_key)) AS diagnostics)) AS result_json
FROM refresh_modes m JOIN refresh_diagnostics d USING(invocation_key) LEFT JOIN t USING(invocation_key) LEFT JOIN r USING(invocation_key)
LEFT JOIN ch USING(invocation_key) LEFT JOIN df USING(invocation_key) LEFT JOIN u USING(invocation_key) LEFT JOIN e USING(invocation_key)
ORDER BY m.invocation_key;

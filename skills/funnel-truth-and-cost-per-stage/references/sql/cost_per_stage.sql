-- Native Standard SQL cost reconciliation. Temporary synthetic inputs only.
-- BEGIN REPLACEABLE INPUTS
CREATE TEMP TABLE invocation_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-01-01' AS DATE) AS report_start, CAST('2026-01-31' AS DATE) AS report_end, CAST('cohort' AS STRING) AS date_mode, TRUE AS spend_complete;
CREATE TEMP TABLE stage_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS FLOAT64) AS stage_order, CAST('won' AS STRING) AS stage_kind;
CREATE TEMP TABLE stage_ledger_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Matched' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS FLOAT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-02T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-01-04T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, TRUE AS is_attribution_primary, CAST(NULL AS NUMERIC) AS value, CAST(NULL AS STRING) AS currency, CAST('unknown' AS STRING) AS value_status, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Unmatched' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS FLOAT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-02T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-01-04T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, TRUE AS is_attribution_primary, CAST(NULL AS NUMERIC) AS value, CAST(NULL AS STRING) AS currency, CAST('unknown' AS STRING) AS value_status, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Ambiguous' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS FLOAT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-02T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-01-04T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, TRUE AS is_attribution_primary, CAST(NULL AS NUMERIC) AS value, CAST(NULL AS STRING) AS currency, CAST('unknown' AS STRING) AS value_status, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Missing' AS STRING) AS lead_key, CAST('won' AS STRING) AS stage_key, CAST('70' AS FLOAT64) AS stage_order, CAST('won' AS STRING) AS stage_kind, TRUE AS achieved, CAST('2026-01-02T00:00:00Z' AS TIMESTAMP) AS cohort_at, CAST('2026-01-04T00:00:00Z' AS TIMESTAMP) AS stage_entered_at, TRUE AS is_attribution_primary, CAST(NULL AS NUMERIC) AS value, CAST(NULL AS STRING) AS currency, CAST('unknown' AS STRING) AS value_status, CAST('achieved' AS STRING) AS stage_truth_status, STRUCT(CAST(NULL AS STRING) AS channel,CAST(NULL AS STRING) AS taxonomy_version,CAST(NULL AS STRING) AS network_id,CAST(NULL AS STRING) AS campaign_key,CAST(NULL AS STRING) AS ad_source_system,CAST(NULL AS STRING) AS ad_source_scope,CAST(NULL AS STRING) AS ad_key) AS attribution;
CREATE TEMP TABLE crm_attribution_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Matched' AS STRING) AS lead_key, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('matched' AS STRING) AS quality_status, CAST('google_ads' AS STRING) AS network_id, CAST('Campaign+Case' AS STRING) AS campaign_key, CAST(NULL AS STRING) AS ad_source_system, CAST(NULL AS STRING) AS ad_source_scope, CAST(NULL AS STRING) AS ad_key, CAST('unmatched' AS STRING) AS ad_match_status, ARRAY<STRUCT<source_system STRING,source_scope STRING,ad_key STRING,campaign_key STRING>>[] AS candidate_ads
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Unmatched' AS STRING) AS lead_key, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('matched' AS STRING) AS quality_status, CAST('google_ads' AS STRING) AS network_id, CAST('NoCatalog' AS STRING) AS campaign_key, CAST(NULL AS STRING) AS ad_source_system, CAST(NULL AS STRING) AS ad_source_scope, CAST(NULL AS STRING) AS ad_key, CAST('unmatched' AS STRING) AS ad_match_status, ARRAY<STRUCT<source_system STRING,source_scope STRING,ad_key STRING,campaign_key STRING>>[] AS candidate_ads
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS source_system, CAST('crm-a' AS STRING) AS source_scope, CAST('Ambiguous' AS STRING) AS lead_key, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('matched' AS STRING) AS quality_status, CAST('google_ads' AS STRING) AS network_id, CAST('Ambiguous' AS STRING) AS campaign_key, CAST(NULL AS STRING) AS ad_source_system, CAST(NULL AS STRING) AS ad_source_scope, CAST(NULL AS STRING) AS ad_key, CAST('ambiguous' AS STRING) AS ad_match_status, [STRUCT(CAST('synthetic_ads' AS STRING) AS source_system,CAST('ads-a' AS STRING) AS source_scope,CAST('Ad+One' AS STRING) AS ad_key,CAST('Ambiguous' AS STRING) AS campaign_key)] AS candidate_ads;
CREATE TEMP TABLE account_currency_input AS
SELECT CAST(NULL AS STRING) AS invocation_key, CAST(NULL AS STRING) AS source_system, CAST(NULL AS STRING) AS source_scope, CAST(NULL AS STRING) AS network_id, CAST(NULL AS STRING) AS currency FROM UNNEST(ARRAY<INT64>[]);
CREATE TEMP TABLE campaign_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_ads' AS STRING) AS source_system, CAST('ads-a' AS STRING) AS source_scope, CAST('google_ads' AS STRING) AS network_id, CAST('Campaign+Case' AS STRING) AS campaign_key
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_ads' AS STRING) AS source_system, CAST('ads-a' AS STRING) AS source_scope, CAST('google_ads' AS STRING) AS network_id, CAST('Ambiguous' AS STRING) AS campaign_key;
CREATE TEMP TABLE binding_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_crm' AS STRING) AS crm_source_system, CAST('crm-a' AS STRING) AS crm_source_scope, CAST('synthetic_ads' AS STRING) AS ad_source_system, CAST('ads-a' AS STRING) AS ad_source_scope, CAST('google_ads' AS STRING) AS platform, CAST('campaign' AS STRING) AS entity_type;
CREATE TEMP TABLE spend_input AS
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_ads' AS STRING) AS source_system, CAST('ads-a' AS STRING) AS source_scope, CAST('Spend+A' AS STRING) AS spend_key, CAST('2026-01-02' AS DATE) AS event_date, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('google_ads' AS STRING) AS network_id, CAST('Campaign+Case' AS STRING) AS campaign_key, CAST('20' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_ads' AS STRING) AS source_system, CAST('ads-a' AS STRING) AS source_scope, CAST('Spend+B' AS STRING) AS spend_key, CAST('2026-01-02' AS DATE) AS event_date, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('google_ads' AS STRING) AS network_id, CAST('Ambiguous' AS STRING) AS campaign_key, CAST('12' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status
UNION ALL
SELECT CAST('all-five-buckets' AS STRING) AS invocation_key, CAST('synthetic_ads' AS STRING) AS source_system, CAST('unbound' AS STRING) AS source_scope, CAST('Spend+C' AS STRING) AS spend_key, CAST('2026-01-02' AS DATE) AS event_date, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('google_ads' AS STRING) AS network_id, CAST('NoCatalog' AS STRING) AS campaign_key, CAST('9' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status;
-- END REPLACEABLE INPUTS

-- BEGIN INVOCATION CARDINALITY CHECK
ASSERT (SELECT COUNT(*) = 1 FROM invocation_input)
 AS 'exactly one invocation configuration is required';
-- END INVOCATION CARDINALITY CHECK
ASSERT NOT EXISTS (SELECT 1 FROM invocation_input WHERE invocation_key IS NULL OR invocation_key = ''
 OR source_system IS NULL OR source_scope IS NULL OR source_system = '' OR source_scope = ''
 OR source_system != TRIM(source_system) OR source_scope != TRIM(source_scope)
 OR report_start IS NULL OR report_end IS NULL OR report_start > report_end
 OR date_mode IS NULL OR date_mode NOT IN ('cohort','activity') OR spend_complete IS NULL
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^(UTC|[A-Za-z_]+/[A-Za-z0-9_+/-]+)$'))
 AS 'invalid required invocation configuration';
ASSERT (SELECT COUNTIF(FORMAT_TIMESTAMP('%F', CURRENT_TIMESTAMP(),report_timezone) IS NOT NULL) = COUNT(*) FROM invocation_input)
 AS 'invalid report timezone';
ASSERT NOT EXISTS (SELECT invocation_key FROM invocation_input GROUP BY 1 HAVING COUNT(*) != 1)
 AS 'duplicate invocation configuration';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT invocation_key FROM stage_input UNION ALL SELECT invocation_key FROM stage_ledger_input
 UNION ALL SELECT invocation_key FROM crm_attribution_input UNION ALL SELECT invocation_key FROM campaign_input
 UNION ALL SELECT invocation_key FROM binding_input UNION ALL SELECT invocation_key FROM spend_input UNION ALL SELECT invocation_key FROM account_currency_input
 ) x LEFT JOIN invocation_input c USING(invocation_key) WHERE c.invocation_key IS NULL)
 AS 'missing invocation configuration';
ASSERT NOT EXISTS (SELECT 1 FROM stage_input WHERE stage_key IS NULL OR stage_key = '' OR stage_key != TRIM(stage_key)
 OR stage_order IS NULL OR IS_INF(stage_order) OR IS_NAN(stage_order) OR stage_order != TRUNC(stage_order) OR SAFE_CAST(stage_order AS INT64) IS NULL
 OR stage_kind IS NULL OR stage_kind NOT IN ('lead','qualified','converted','won','event')) AS 'invalid stage configuration';
ASSERT NOT EXISTS (SELECT 1 FROM invocation_input c WHERE NOT EXISTS (SELECT 1 FROM stage_input s WHERE s.invocation_key=c.invocation_key))
 AS 'at least one configured stage is required';
ASSERT NOT EXISTS (SELECT invocation_key,stage_key FROM stage_input GROUP BY 1,2 HAVING COUNT(DISTINCT TO_JSON_STRING(STRUCT(stage_order,stage_kind)))>1)
 AND NOT EXISTS (SELECT invocation_key,stage_order FROM stage_input GROUP BY 1,2 HAVING COUNT(DISTINCT stage_key)>1)
 AS 'conflicting stage configuration';
CREATE TEMP TABLE stages AS SELECT DISTINCT * REPLACE(CAST(stage_order AS INT64) AS stage_order) FROM stage_input;

-- Identity validation preserves case, literal plus, and percent escapes without normalization.
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT source_system,source_scope,lead_key AS record_key FROM stage_ledger_input
 UNION ALL SELECT source_system,source_scope,lead_key FROM crm_attribution_input
 UNION ALL SELECT source_system,source_scope,spend_key FROM spend_input
 UNION ALL SELECT source_system,source_scope,campaign_key FROM campaign_input
 UNION ALL SELECT source_system,source_scope,network_id FROM account_currency_input
 UNION ALL SELECT crm_source_system,crm_source_scope,platform FROM binding_input
 UNION ALL SELECT ad_source_system,ad_source_scope,entity_type FROM binding_input
 UNION ALL SELECT a.source_system,a.source_scope,a.ad_key FROM crm_attribution_input,UNNEST(candidate_ads) a
 ) WHERE source_system IS NULL OR source_system='' OR source_system!=TRIM(source_system)
 OR source_scope IS NULL OR source_scope='' OR source_scope!=TRIM(source_scope)
 OR record_key IS NULL OR record_key='' OR record_key!=TRIM(record_key)) AS 'invalid qualified identity';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT network_id,campaign_key,ad_source_system,ad_source_scope,ad_key FROM crm_attribution_input
 UNION ALL SELECT attribution.network_id,attribution.campaign_key,attribution.ad_source_system,attribution.ad_source_scope,attribution.ad_key FROM stage_ledger_input
 ) WHERE (network_id IS NOT NULL AND (network_id='' OR network_id!=TRIM(network_id)))
 OR (campaign_key IS NOT NULL AND (campaign_key='' OR campaign_key!=TRIM(campaign_key)))
 OR ((ad_source_system IS NOT NULL OR ad_source_scope IS NOT NULL OR ad_key IS NOT NULL) AND
 (ad_source_system IS NULL OR ad_source_scope IS NULL OR ad_key IS NULL OR ad_source_system='' OR ad_source_scope='' OR ad_key=''
 OR ad_source_system!=TRIM(ad_source_system) OR ad_source_scope!=TRIM(ad_source_scope) OR ad_key!=TRIM(ad_key))))
 AS 'invalid optional attribution identity';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT network_id,campaign_key FROM spend_input UNION ALL SELECT network_id,campaign_key FROM campaign_input
 UNION ALL SELECT NULL,a.campaign_key FROM crm_attribution_input,UNNEST(candidate_ads) a
 ) WHERE (network_id IS NOT NULL AND (network_id='' OR network_id!=TRIM(network_id)))
 OR (campaign_key IS NOT NULL AND (campaign_key='' OR campaign_key!=TRIM(campaign_key)))) AS 'invalid campaign identity';
ASSERT NOT EXISTS (SELECT 1 FROM campaign_input WHERE network_id IS NULL) AS 'catalog network is required';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT invocation_key,source_system,source_scope FROM stage_ledger_input
 UNION ALL SELECT invocation_key,source_system,source_scope FROM crm_attribution_input
 ) l JOIN invocation_input c USING(invocation_key) WHERE l.source_system!=c.source_system OR l.source_scope!=c.source_scope)
 AS 'CRM source reference does not match invocation';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT channel,taxonomy_version,FALSE AS optional FROM crm_attribution_input
 UNION ALL SELECT channel,taxonomy_version,FALSE FROM spend_input
 UNION ALL SELECT attribution.channel,attribution.taxonomy_version,TRUE FROM stage_ledger_input
 ) WHERE NOT (optional AND channel IS NULL AND taxonomy_version IS NULL)
 AND (channel IS NULL OR taxonomy_version IS NULL OR taxonomy_version!='0.1.0'
 OR channel NOT IN ('Paid Search','Paid Social','Paid Other','Organic Search','Organic Social','Email','SMS','Direct','Referral','Affiliate','Other')))
 AS 'invalid canonical classification';
ASSERT NOT EXISTS (SELECT 1 FROM crm_attribution_input WHERE quality_status IS NULL OR quality_status NOT IN ('matched','unmapped','unattributed')
 OR ad_match_status IS NULL OR ad_match_status NOT IN ('matched','unmatched','ambiguous') OR candidate_ads IS NULL
 OR (ad_match_status='matched' AND ad_key IS NULL)) AS 'invalid attribution resolution status';
ASSERT NOT EXISTS (SELECT 1 FROM stage_ledger_input WHERE is_attribution_primary IS NULL
 OR stage_truth_status IS NULL OR stage_truth_status NOT IN ('achieved','achieved_undated','not_achieved','pending_future_evidence','unknown')
 OR (achieved IS NULL AND stage_truth_status!='unknown')
 OR (achieved IS TRUE AND (stage_truth_status NOT IN ('achieved','achieved_undated') OR (stage_entered_at IS NULL)!=(stage_truth_status='achieved_undated')))
 OR (achieved IS FALSE AND stage_truth_status NOT IN ('not_achieved','pending_future_evidence'))
 OR (achieved IS NOT TRUE AND stage_entered_at IS NOT NULL)) AS 'invalid stage truth record';
ASSERT NOT EXISTS (SELECT 1 FROM (
 SELECT value,currency,value_status AS status FROM stage_ledger_input
 UNION ALL SELECT spend,currency,spend_status FROM spend_input
 ) WHERE status IS NULL OR status NOT IN ('known','unknown','mixed_currency')
 OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$'))
 OR (status='known' AND (value IS NULL OR currency IS NULL))
 OR (status!='known' AND value IS NOT NULL) OR (status='mixed_currency' AND currency IS NOT NULL)) AS 'invalid monetary contract';
ASSERT NOT EXISTS (SELECT 1 FROM spend_input WHERE event_date IS NULL) AS 'spend event date is required';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,lead_key,stage_key FROM stage_ledger_input
 GROUP BY 1,2,3,4,5 HAVING COUNT(DISTINCT TO_JSON_STRING(stage_ledger_input))>1) AS 'conflicting stage ledger identity';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,lead_key FROM crm_attribution_input
 GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(crm_attribution_input))>1) AS 'conflicting attribution identity';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,spend_key FROM spend_input
 GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(spend_input))>1) AS 'conflicting spend identity';
ASSERT NOT EXISTS (SELECT 1 FROM account_currency_input WHERE currency IS NULL OR NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$')) AS 'invalid account currency';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,network_id FROM account_currency_input GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT currency)>1) AS 'conflicting account currency';
CREATE TEMP TABLE account_currencies AS SELECT DISTINCT * FROM account_currency_input;
ASSERT NOT EXISTS (SELECT 1 FROM spend_input s JOIN account_currencies a USING(invocation_key,source_system,source_scope,network_id) JOIN invocation_input c USING(invocation_key)
 WHERE s.event_date BETWEEN c.report_start AND c.report_end AND s.currency IS NOT NULL AND s.currency!=a.currency) AS 'account currency conflicts with observed spend';
CREATE TEMP TABLE ledger AS SELECT DISTINCT * FROM stage_ledger_input;
CREATE TEMP TABLE attribution AS SELECT DISTINCT * FROM crm_attribution_input;
CREATE TEMP TABLE campaigns AS SELECT DISTINCT * FROM campaign_input;
CREATE TEMP TABLE bindings AS SELECT DISTINCT * FROM binding_input;
CREATE TEMP TABLE spend_facts AS SELECT DISTINCT * FROM spend_input;
ASSERT NOT EXISTS (SELECT 1 FROM ledger l LEFT JOIN stages s USING(invocation_key,stage_key)
 WHERE s.stage_key IS NULL OR l.stage_order!=s.stage_order OR l.stage_order IS NULL OR l.stage_kind!=s.stage_kind OR l.stage_kind IS NULL)
 AS 'stage ledger configuration mismatch';
ASSERT NOT EXISTS (SELECT invocation_key,source_system,source_scope,lead_key FROM ledger
 GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT TO_JSON_STRING(STRUCT(cohort_at,is_attribution_primary,attribution)))>1)
 AS 'inconsistent lead metadata across stages';
ASSERT NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT invocation_key,source_system,source_scope,lead_key FROM ledger) l
 JOIN stages s USING(invocation_key) LEFT JOIN ledger r USING(invocation_key,source_system,source_scope,lead_key,stage_key)
 WHERE r.lead_key IS NULL) AS 'missing configured stage ledger row';
ASSERT NOT EXISTS (SELECT 1 FROM ledger l JOIN attribution a USING(invocation_key,source_system,source_scope,lead_key)
 WHERE l.attribution.channel IS NOT NULL AND (l.attribution.channel!=a.channel OR l.attribution.taxonomy_version!=a.taxonomy_version))
 AS 'stage and attribution classification conflict';

CREATE TEMP TABLE lead_reconciliation AS
WITH base AS (
 SELECT l.*,a.channel,a.taxonomy_version,a.quality_status,a.network_id,a.campaign_key,
 a.ad_source_system AS upstream_ad_source_system,a.ad_source_scope AS upstream_ad_source_scope,
 a.ad_match_status,IFNULL(a.candidate_ads,[]) AS candidate_ads,a.lead_key IS NULL AS missing_attribution
 FROM (SELECT DISTINCT invocation_key,source_system,source_scope,lead_key FROM ledger) l
 LEFT JOIN attribution a USING(invocation_key,source_system,source_scope,lead_key)
), authorized_catalog AS (
 SELECT DISTINCT c.invocation_key,x.crm_source_system,x.crm_source_scope,c.source_system,c.source_scope,c.network_id,c.campaign_key
 FROM campaigns c JOIN bindings x ON x.invocation_key=c.invocation_key AND x.ad_source_system=c.source_system
 AND x.ad_source_scope=c.source_scope AND x.platform=c.network_id AND x.entity_type='campaign'
), candidate_groups AS (
 SELECT b.invocation_key,b.source_system,b.source_scope,b.lead_key,
 ARRAY_AGG(STRUCT(c.source_system,c.source_scope,c.network_id,c.campaign_key) ORDER BY c.source_system,c.source_scope,c.network_id,c.campaign_key) AS candidate_campaigns
 FROM base b JOIN authorized_catalog c ON c.invocation_key=b.invocation_key
 AND c.crm_source_system=b.source_system AND c.crm_source_scope=b.source_scope
 AND c.network_id=b.network_id AND c.campaign_key=b.campaign_key
 AND (b.upstream_ad_source_system IS NULL OR (c.source_system=b.upstream_ad_source_system AND c.source_scope=b.upstream_ad_source_scope))
 GROUP BY 1,2,3,4
), candidates AS (
 SELECT b.*,IFNULL(c.candidate_campaigns,[]) AS candidate_campaigns
 FROM base b LEFT JOIN candidate_groups c USING(invocation_key,source_system,source_scope,lead_key)
), resolved AS (
 SELECT *,CASE WHEN missing_attribution OR quality_status='unattributed' THEN 'unattributed'
 WHEN ad_match_status='ambiguous' OR ARRAY_LENGTH(candidate_campaigns)>1 THEN 'ambiguous'
 WHEN ARRAY_LENGTH(candidate_campaigns)=1 THEN 'matched' ELSE 'unmatched' END AS bucket FROM candidates
)
SELECT invocation_key,source_system,source_scope,lead_key,
 IF(missing_attribution,'Other',channel) AS channel,'0.1.0' AS taxonomy_version,
 IF(missing_attribution,'missing_attribution','classified') AS channel_status,
 quality_status,network_id,campaign_key,bucket,
 IF(bucket='matched',candidate_campaigns[SAFE_OFFSET(0)].source_system,NULL) AS ad_source_system,
 IF(bucket='matched',candidate_campaigns[SAFE_OFFSET(0)].source_scope,NULL) AS ad_source_scope,
 CASE WHEN missing_attribution THEN 'missing_attribution' WHEN quality_status='unattributed' THEN 'upstream_unattributed'
 WHEN ad_match_status='ambiguous' THEN 'upstream_ad_ambiguity' WHEN ARRAY_LENGTH(candidate_campaigns)>1 THEN 'multiple_authorized_campaigns'
 WHEN bucket='matched' THEN 'exact_authorized_campaign' ELSE 'no_authorized_campaign' END AS reconciliation_reason,
 IF(bucket='matched','explicit_campaign_binding','none') AS reconciliation_method,
 candidate_campaigns,candidate_ads FROM resolved;

CREATE TEMP TABLE stage_evidence AS
SELECT l.invocation_key,l.source_system,l.source_scope,l.lead_key,l.stage_key,CAST(l.stage_order AS INT64) AS stage_order,l.stage_kind,
 l.achieved,l.is_attribution_primary,l.stage_truth_status,l.cohort_at,l.stage_entered_at,
 DATE(IF(c.date_mode='cohort',l.cohort_at,l.stage_entered_at),c.report_timezone) AS report_date,
 DATE(IF(c.date_mode='cohort',l.cohort_at,l.stage_entered_at),c.report_timezone) IS NULL
 OR DATE(IF(c.date_mode='cohort',l.cohort_at,l.stage_entered_at),c.report_timezone) BETWEEN c.report_start AND c.report_end AS included,
 l.value,l.currency,l.value_status,r.channel,r.channel_status,r.network_id,r.campaign_key,r.bucket,r.ad_source_system,r.ad_source_scope
FROM ledger l JOIN invocation_input c USING(invocation_key)
JOIN lead_reconciliation r ON r.invocation_key=l.invocation_key AND r.source_system=l.source_system AND r.source_scope=l.source_scope AND r.lead_key=l.lead_key;
CREATE TEMP TABLE spend_evidence AS
SELECT s.*,s.event_date BETWEEN c.report_start AND c.report_end AS included
FROM spend_facts s JOIN invocation_input c USING(invocation_key);

-- Currency is intentionally not a grouping dimension on either side.
CREATE TEMP TABLE funnel_groups AS
WITH grouped AS (
 SELECT invocation_key,report_date,stage_key,stage_order,stage_kind,channel,channel_status,network_id,campaign_key,bucket,ad_source_system,ad_source_scope,
 COUNT(*) AS lead_count,COUNTIF(achieved) AS stage_count_total,COUNTIF(achieved AND is_attribution_primary) AS stage_count_primary,
 COUNTIF(achieved IS NULL) AS stage_unknown_count,
 COUNTIF(achieved) AS revenue_records,COUNTIF(achieved AND value_status='unknown') AS revenue_unknowns,
 COUNTIF(achieved AND value_status='mixed_currency') AS revenue_mixed,
 COUNT(DISTINCT IF(achieved AND value_status='known',currency,NULL)) AS revenue_currencies,
 SUM(IF(achieved AND value_status='known',value,NULL)) AS revenue_sum,
 MIN(IF(achieved,currency,NULL)) AS one_revenue_currency
 FROM stage_evidence WHERE included GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12
), statuses AS (
 SELECT *,CASE WHEN revenue_mixed>0 OR revenue_currencies>1 THEN 'mixed_currency'
 WHEN revenue_records=0 OR revenue_unknowns>0 THEN 'unknown' ELSE 'known' END AS revenue_status FROM grouped
)
SELECT * EXCEPT(revenue_records,revenue_unknowns,revenue_mixed,revenue_currencies,revenue_sum,one_revenue_currency),
 IF(revenue_status='known',revenue_sum,NULL) AS revenue,
 IF(revenue_status='known',one_revenue_currency,NULL) AS revenue_currency FROM statuses;
CREATE TEMP TABLE spend_groups AS
WITH grouped AS (
 SELECT invocation_key,event_date AS report_date,source_system AS ad_source_system,source_scope AS ad_source_scope,
 channel,taxonomy_version,network_id,campaign_key,COUNT(*) AS spend_fact_count,
 COUNTIF(spend_status='unknown') AS unknowns,COUNTIF(spend_status='mixed_currency') AS mixed,
 COUNT(DISTINCT IF(spend_status='known',currency,NULL)) AS currencies,SUM(IF(spend_status='known',spend,NULL)) AS amount,MIN(currency) AS one_currency
 FROM spend_evidence WHERE included GROUP BY 1,2,3,4,5,6,7,8
), statuses AS (
 SELECT *,CASE WHEN mixed>0 OR currencies>1 THEN 'mixed_currency' WHEN unknowns>0 THEN 'unknown' ELSE 'known' END AS observed_spend_status FROM grouped
)
SELECT * EXCEPT(unknowns,mixed,currencies,amount,one_currency),
 IF(observed_spend_status='known',amount,NULL) AS observed_spend,
 IF(observed_spend_status='known',one_currency,NULL) AS observed_spend_currency FROM statuses;
CREATE TEMP TABLE joined_groups AS
WITH expanded AS (SELECT p.*,s.stage_key,s.stage_order,s.stage_kind FROM spend_groups p JOIN stages s USING(invocation_key))
SELECT COALESCE(f.invocation_key,p.invocation_key) AS invocation_key,COALESCE(f.report_date,p.report_date) AS report_date,
 COALESCE(f.stage_key,p.stage_key) AS stage_key,COALESCE(f.stage_order,p.stage_order) AS stage_order,
 COALESCE(f.stage_kind,p.stage_kind) AS stage_kind,COALESCE(f.channel,p.channel) AS channel,
 COALESCE(f.channel_status,'classified') AS channel_status,COALESCE(f.network_id,p.network_id) AS network_id,
 COALESCE(f.campaign_key,p.campaign_key) AS campaign_key,COALESCE(f.ad_source_system,p.ad_source_system) AS ad_source_system,
 COALESCE(f.ad_source_scope,p.ad_source_scope) AS ad_source_scope,IF(f.stage_key IS NULL,'spend_only','matched') AS bucket,
 IFNULL(f.lead_count,0) AS lead_count,IFNULL(f.stage_count_total,0) AS stage_count_total,
 IFNULL(f.stage_count_primary,0) AS stage_count_primary,IFNULL(f.stage_unknown_count,0) AS stage_unknown_count,
 f.revenue,f.revenue_currency,IFNULL(f.revenue_status,'unknown') AS revenue_status,
 IFNULL(p.spend_fact_count,0) AS spend_fact_count,p.observed_spend,p.observed_spend_currency,
 IFNULL(p.observed_spend_status,'unknown') AS observed_spend_status
FROM (SELECT * FROM funnel_groups WHERE bucket='matched') f FULL OUTER JOIN expanded p
 ON f.invocation_key=p.invocation_key AND f.report_date=p.report_date AND f.stage_key=p.stage_key
 AND f.channel=p.channel AND f.network_id=p.network_id AND f.campaign_key=p.campaign_key
 AND f.ad_source_system=p.ad_source_system AND f.ad_source_scope=p.ad_source_scope
UNION ALL
SELECT invocation_key,report_date,stage_key,stage_order,stage_kind,channel,channel_status,network_id,campaign_key,ad_source_system,ad_source_scope,bucket,
 lead_count,stage_count_total,stage_count_primary,stage_unknown_count,revenue,revenue_currency,revenue_status,
 0,NULL,NULL,'unknown' FROM funnel_groups WHERE bucket!='matched';
CREATE TEMP TABLE cost_report AS
WITH finalized AS (
 SELECT g.*,c.source_system AS crm_source_system,c.source_scope AS crm_source_scope,c.date_mode,c.report_timezone,'0.1.0' AS taxonomy_version,
 CASE WHEN NOT c.spend_complete THEN NULL WHEN spend_fact_count>0 THEN observed_spend
 WHEN bucket='matched' AND report_date IS NOT NULL AND a.currency IS NOT NULL THEN NUMERIC '0' ELSE NULL END AS spend,
 IF(c.spend_complete,IF(spend_fact_count>0,observed_spend_currency,IF(bucket='matched' AND report_date IS NOT NULL,a.currency,NULL)),NULL) AS spend_currency,
 CASE WHEN NOT c.spend_complete THEN 'unknown' WHEN spend_fact_count>0 THEN observed_spend_status
 WHEN bucket='matched' AND report_date IS NOT NULL AND a.currency IS NOT NULL THEN 'known' ELSE 'unknown' END AS spend_status,
 CASE WHEN NOT c.spend_complete THEN 'incomplete_spend_snapshot' WHEN spend_fact_count>0 THEN NULL
 WHEN bucket='matched' AND report_date IS NOT NULL AND a.currency IS NOT NULL THEN 'complete_snapshot_zero'
 WHEN bucket='matched' AND report_date IS NOT NULL THEN 'complete_snapshot_currency_unknown'
 WHEN report_date IS NULL THEN 'undated_stage' ELSE 'unresolved_campaign' END AS absence_reason
 FROM joined_groups g JOIN invocation_input c USING(invocation_key)
 LEFT JOIN account_currencies a ON a.invocation_key=g.invocation_key AND a.source_system=g.ad_source_system AND a.source_scope=g.ad_source_scope AND a.network_id=g.network_id
)
SELECT *,IF(bucket='matched' AND spend_status='known' AND stage_count_primary>0,SAFE_DIVIDE(spend,stage_count_primary),NULL) AS cost_per_stage,
 CASE WHEN bucket!='matched' THEN 'campaign_not_matched' WHEN spend_status!='known' THEN 'spend_unknown'
 WHEN stage_count_primary=0 THEN 'no_primary_stage_attainment' ELSE 'known' END AS cost_status FROM finalized;

CREATE TEMP TABLE cost_diagnostics AS
SELECT c.invocation_key,
 (SELECT COUNT(*) FROM lead_reconciliation l WHERE l.invocation_key=c.invocation_key AND l.channel_status='missing_attribution') AS missing_attribution_leads,
 (SELECT COUNT(*) FROM attribution a LEFT JOIN (SELECT DISTINCT invocation_key,lead_key FROM ledger) l USING(invocation_key,lead_key) WHERE a.invocation_key=c.invocation_key AND l.lead_key IS NULL) AS extra_attribution_leads,
 (SELECT COUNT(*) FROM stage_evidence s WHERE s.invocation_key=c.invocation_key AND NOT included) AS outside_range_stage_rows,
 (SELECT COUNT(*) FROM spend_evidence s WHERE s.invocation_key=c.invocation_key AND NOT included) AS outside_range_spend_rows,
 (SELECT COUNT(*) FROM stage_evidence s WHERE s.invocation_key=c.invocation_key AND report_date IS NULL) AS undated_stage_rows,
 IF(c.spend_complete,0,1) AS incomplete_spend_source,
 (SELECT COUNT(*) FROM stage_ledger_input l WHERE l.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM ledger l WHERE l.invocation_key=c.invocation_key) AS duplicate_ledger_rows_collapsed,
 (SELECT COUNT(*) FROM crm_attribution_input l WHERE l.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM attribution l WHERE l.invocation_key=c.invocation_key) AS duplicate_attribution_rows_collapsed,
 (SELECT COUNT(*) FROM spend_input l WHERE l.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM spend_facts l WHERE l.invocation_key=c.invocation_key) AS duplicate_spend_rows_collapsed,
 (SELECT COUNT(*) FROM stage_input l WHERE l.invocation_key=c.invocation_key)-(SELECT COUNT(*) FROM stages l WHERE l.invocation_key=c.invocation_key) AS duplicate_stages_collapsed
FROM invocation_input c;
WITH r AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT t.* EXCEPT(invocation_key)) ORDER BY stage_order,(report_date IS NULL),report_date,channel,bucket,network_id,ad_source_system,ad_source_scope,campaign_key,channel_status) AS report FROM cost_report t GROUP BY 1),
 l AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT t.* EXCEPT(invocation_key)) ORDER BY lead_key) AS lead_reconciliation FROM lead_reconciliation t GROUP BY 1),
 s AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT t.* EXCEPT(invocation_key)) ORDER BY source_system,source_scope,spend_key) AS spend_evidence FROM spend_evidence t GROUP BY 1),
 e AS (SELECT invocation_key,ARRAY_AGG((SELECT AS STRUCT t.* EXCEPT(invocation_key)) ORDER BY lead_key,stage_order) AS stage_evidence FROM stage_evidence t GROUP BY 1)
SELECT d.invocation_key,TO_JSON_STRING(STRUCT(IFNULL(r.report,[]) AS report,IFNULL(l.lead_reconciliation,[]) AS lead_reconciliation,
 IFNULL(s.spend_evidence,[]) AS spend_evidence,IFNULL(e.stage_evidence,[]) AS stage_evidence,
 (SELECT AS STRUCT d.* EXCEPT(invocation_key)) AS diagnostics)) AS result_json
FROM cost_diagnostics d LEFT JOIN r USING(invocation_key) LEFT JOIN l USING(invocation_key) LEFT JOIN s USING(invocation_key) LEFT JOIN e USING(invocation_key)
ORDER BY d.invocation_key;

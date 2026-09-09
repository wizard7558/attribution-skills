-- BigQuery Standard SQL. Synthetic temporary tables only.
-- BEGIN REPLACEABLE INPUTS
CREATE TEMP TABLE configuration_input AS
SELECT CAST('matched-two' AS STRING) AS invocation_key, CAST('synthetic-population' AS STRING) AS report_scope, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-02-01' AS DATE) AS report_start_date, CAST('2026-02-28' AS DATE) AS report_end_date, CAST('2026-03-01T00:00:00Z' AS TIMESTAMP) AS as_of, CAST('linear' AS STRING) AS selected_model, CAST('full_lookback' AS STRING) AS conversion_window_mode, CAST('true' AS BOOL) AS spend_complete, CAST('conversions' AS STRING) AS outcome_kind, CAST('false' AS BOOL) AS acquisition_history_complete;
CREATE TEMP TABLE conversion_scope_input AS
SELECT CAST('crm' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope;
CREATE TEMP TABLE spend_scope_input AS
SELECT CAST('ads' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('USD' AS STRING) AS currency;
CREATE TEMP TABLE ledger_input AS
SELECT CAST('crm' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('c1' AS STRING) AS conversion_key, CAST('web' AS STRING) AS touch_source_system, CAST('a' AS STRING) AS touch_source_scope, CAST('t1' AS STRING) AS touch_key, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS conversion_at, CAST('2026-02-10' AS DATE) AS conversion_date, CAST('2026-02-09T00:00:00Z' AS TIMESTAMP) AS touch_at, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('linear' AS STRING) AS model, CAST('0.5' AS FLOAT64) AS credit, CAST('100' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, CAST('full_lookback' AS STRING) AS conversion_window_mode, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-02-01' AS DATE) AS report_start_date, CAST('2026-02-28' AS DATE) AS report_end_date, CAST('2026-03-01T00:00:00Z' AS TIMESTAMP) AS as_of
UNION ALL
SELECT CAST('crm' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('c1' AS STRING) AS conversion_key, CAST('web' AS STRING) AS touch_source_system, CAST('a' AS STRING) AS touch_source_scope, CAST('t2' AS STRING) AS touch_key, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS conversion_at, CAST('2026-02-10' AS DATE) AS conversion_date, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS touch_at, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('linear' AS STRING) AS model, CAST('0.5' AS FLOAT64) AS credit, CAST('100' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, CAST('full_lookback' AS STRING) AS conversion_window_mode, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-02-01' AS DATE) AS report_start_date, CAST('2026-02-28' AS DATE) AS report_end_date, CAST('2026-03-01T00:00:00Z' AS TIMESTAMP) AS as_of;
CREATE TEMP TABLE coverage_input AS
SELECT CAST('crm' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('c1' AS STRING) AS conversion_key, CAST('linear' AS STRING) AS model, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS conversion_at, CAST('2026-02-10' AS DATE) AS conversion_date, CAST('100' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status, CAST('full_lookback' AS STRING) AS conversion_window_mode, CAST('2' AS INT64) AS eligible_touch_count, CAST('1' AS FLOAT64) AS total_credit, CAST('credited' AS STRING) AS status;
CREATE TEMP TABLE spend_input AS
SELECT CAST('ads' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('s1' AS STRING) AS spend_key, CAST('2026-02-10' AS DATE) AS event_date, CAST('UTC' AS STRING) AS date_timezone, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('25' AS NUMERIC) AS spend, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS spend_status;
-- END REPLACEABLE INPUTS
CREATE TEMP FUNCTION valid_key(s STRING) AS (s IS NOT NULL AND s!='' AND s=TRIM(s) AND NOT REGEXP_CONTAINS(s,r'[\x00-\x1F\x7F-\x{009F}]'));
CREATE TEMP FUNCTION valid_money(v NUMERIC,c STRING,s STRING) AS (
 s IS NOT NULL AND s IN ('known','unknown','mixed_currency') AND (c IS NULL OR REGEXP_CONTAINS(c,r'^[A-Z]{3}$'))
 AND CASE s WHEN 'known' THEN v IS NOT NULL AND c IS NOT NULL WHEN 'unknown' THEN v IS NULL ELSE v IS NULL AND c IS NULL END);
CREATE TEMP FUNCTION valid_channel(c STRING,v STRING) AS (c IS NOT NULL AND c IN ('Paid Search','Paid Social','Paid Other','Organic Search','Organic Social','Email','SMS','Direct','Referral','Affiliate','Other') AND v IS NOT NULL AND v='0.1.0');
CREATE TEMP FUNCTION valid_model(m STRING) AS (m IS NOT NULL AND m IN ('first_touch','last_touch','linear','position_based','time_decay'));
CREATE TEMP FUNCTION valid_mode(m STRING) AS (m IS NOT NULL AND m IN ('full_lookback','segmented','acquisition'));
ASSERT (SELECT COUNT(*)=1 FROM configuration_input) AS 'exactly one metrics configuration required';
ASSERT NOT EXISTS (SELECT 1 FROM configuration_input WHERE NOT valid_key(invocation_key) OR NOT valid_key(report_scope)
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$') OR report_start_date IS NULL OR report_end_date IS NULL OR report_end_date<report_start_date OR as_of IS NULL
 OR NOT valid_model(selected_model) OR NOT valid_mode(conversion_window_mode) OR spend_complete IS NULL OR acquisition_history_complete IS NULL
 OR outcome_kind IS NULL OR outcome_kind NOT IN ('conversions','new_customers') OR (outcome_kind='new_customers' AND (conversion_window_mode!='acquisition' OR NOT acquisition_history_complete))) AS 'invalid metrics configuration';
ASSERT (SELECT FORMAT_TIMESTAMP('%F',as_of,report_timezone) IS NOT NULL FROM configuration_input) AS 'invalid timezone';
CREATE TEMP TABLE mc AS SELECT * FROM configuration_input;
ASSERT (SELECT COUNT(*)>0 FROM conversion_scope_input) AND (SELECT COUNT(*)>0 FROM spend_scope_input) AS 'nonempty explicit source memberships required';
ASSERT NOT EXISTS (SELECT 1 FROM conversion_scope_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope)) AS 'invalid conversion membership';
ASSERT NOT EXISTS (SELECT 1 FROM spend_scope_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency,r'^[A-Z]{3}$'))) AS 'invalid spend membership';
ASSERT NOT EXISTS (SELECT 1 FROM spend_scope_input GROUP BY source_system,source_scope HAVING COUNT(DISTINCT TO_JSON_STRING(STRUCT(currency)))>1) AS 'conflicting spend membership';
CREATE TEMP TABLE cm AS SELECT DISTINCT * FROM conversion_scope_input;
CREATE TEMP TABLE sm AS SELECT DISTINCT * FROM spend_scope_input;
ASSERT NOT EXISTS (SELECT 1 FROM ledger_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(conversion_key)
 OR NOT valid_key(touch_source_system) OR NOT valid_key(touch_source_scope) OR NOT valid_key(touch_key) OR NOT valid_channel(channel,taxonomy_version)
 OR NOT valid_model(model) OR NOT valid_mode(conversion_window_mode) OR NOT valid_money(value,currency,value_status)
 OR credit IS NULL OR IS_NAN(credit) OR IS_INF(credit) OR credit<0 OR conversion_at IS NULL OR touch_at IS NULL OR touch_at>conversion_at OR conversion_date IS NULL
 OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone,r'^[A-Za-z][A-Za-z0-9_+/-]*$') OR report_start_date IS NULL OR report_end_date IS NULL OR report_end_date<report_start_date OR as_of IS NULL
 OR conversion_date!=DATE(conversion_at,report_timezone) OR conversion_at>as_of OR conversion_date NOT BETWEEN report_start_date AND report_end_date) AS 'invalid raw ledger';
ASSERT NOT EXISTS (SELECT 1 FROM coverage_input WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(conversion_key)
 OR NOT valid_model(model) OR NOT valid_mode(conversion_window_mode) OR NOT valid_money(value,currency,value_status) OR conversion_at IS NULL OR conversion_date IS NULL
 OR eligible_touch_count IS NULL OR eligible_touch_count<0 OR total_credit IS NULL OR IS_NAN(total_credit) OR IS_INF(total_credit) OR total_credit<0
 OR status IS NULL OR status NOT IN ('credited','unresolved_subject','no_eligible_touches','acquisition_repeat_excluded')) AS 'invalid raw coverage';
ASSERT NOT EXISTS (SELECT 1 FROM spend_input CROSS JOIN mc WHERE NOT valid_key(source_system) OR NOT valid_key(source_scope) OR NOT valid_key(spend_key)
 OR event_date IS NULL OR date_timezone IS NULL OR date_timezone!=report_timezone OR NOT valid_channel(channel,taxonomy_version) OR NOT valid_money(spend,currency,spend_status)) AS 'invalid raw spend';
ASSERT NOT EXISTS (SELECT 1 FROM ledger_input l GROUP BY source_system,source_scope,conversion_key,model,touch_source_system,touch_source_scope,touch_key HAVING COUNT(DISTINCT TO_JSON_STRING(l))>1) AS 'conflicting ledger duplicate';
ASSERT NOT EXISTS (SELECT 1 FROM coverage_input c GROUP BY source_system,source_scope,conversion_key,model HAVING COUNT(DISTINCT TO_JSON_STRING(c))>1) AS 'conflicting coverage duplicate';
ASSERT NOT EXISTS (SELECT 1 FROM spend_input s GROUP BY source_system,source_scope,spend_key HAVING COUNT(DISTINCT TO_JSON_STRING(s))>1) AS 'conflicting spend duplicate';
CREATE TEMP TABLE ld AS SELECT DISTINCT * FROM ledger_input;
CREATE TEMP TABLE cd AS SELECT DISTINCT * FROM coverage_input;
CREATE TEMP TABLE sd AS SELECT DISTINCT * FROM spend_input;
ASSERT NOT EXISTS (SELECT 1 FROM sd JOIN sm USING(source_system,source_scope) WHERE sm.currency IS NOT NULL AND sd.currency IS NOT NULL AND sm.currency!=sd.currency) AS 'spend currency disagrees with membership';
CREATE TEMP TABLE ls AS SELECT l.* FROM ld l JOIN cm USING(source_system,source_scope) CROSS JOIN mc WHERE model=selected_model;
CREATE TEMP TABLE cs AS SELECT c.* FROM cd c JOIN cm USING(source_system,source_scope) CROSS JOIN mc WHERE model=selected_model;
ASSERT NOT EXISTS (SELECT 1 FROM ls CROSS JOIN mc WHERE ls.report_timezone!=mc.report_timezone OR ls.report_start_date!=mc.report_start_date OR ls.report_end_date!=mc.report_end_date OR ls.as_of!=mc.as_of OR ls.conversion_window_mode!=mc.conversion_window_mode) AS 'selected ledger boundary mismatch';
ASSERT NOT EXISTS (SELECT 1 FROM cs CROSS JOIN mc WHERE cs.conversion_window_mode!=mc.conversion_window_mode OR conversion_date!=DATE(conversion_at,report_timezone) OR conversion_at>as_of OR conversion_date NOT BETWEEN report_start_date AND report_end_date) AS 'selected coverage boundary mismatch';
ASSERT NOT EXISTS (SELECT 1 FROM ls l LEFT JOIN cs c USING(source_system,source_scope,conversion_key,model) WHERE c.conversion_key IS NULL
 OR TO_JSON_STRING(STRUCT(l.conversion_at,l.conversion_date,l.value,l.currency,l.value_status,l.conversion_window_mode))!=TO_JSON_STRING(STRUCT(c.conversion_at,c.conversion_date,c.value,c.currency,c.value_status,c.conversion_window_mode))) AS 'ledger coverage metadata mismatch';
CREATE TEMP TABLE actual_coverage AS SELECT source_system,source_scope,conversion_key,model,COUNT(*) n,SUM(credit) credit FROM ls GROUP BY 1,2,3,4;
ASSERT NOT EXISTS (SELECT 1 FROM cs c LEFT JOIN actual_coverage a USING(source_system,source_scope,conversion_key,model)
 WHERE CASE WHEN status='credited' THEN COALESCE(n,0)=0 OR eligible_touch_count!=n OR ABS(total_credit-credit)>1e-12 OR ABS(credit-1)>1e-12
 ELSE COALESCE(n,0)!=0 OR eligible_touch_count!=0 OR total_credit!=0 END) AS 'coverage count or credit mismatch';
CREATE TEMP TABLE allocation_weights AS SELECT *,SAFE_CAST(credit AS BIGNUMERIC) numeric_credit FROM ls;
ASSERT NOT EXISTS (SELECT 1 FROM allocation_weights WHERE numeric_credit IS NULL) AS 'unrepresentable allocation credit';
CREATE TEMP TABLE allocation_endpoints AS
WITH cumulative AS (SELECT *,SUM(numeric_credit) OVER conv total_weight,SUM(numeric_credit) OVER (ordered ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_weight,ROW_NUMBER() OVER ordered position,COUNT(*) OVER conv touch_count
 FROM allocation_weights WINDOW conv AS (PARTITION BY source_system,source_scope,conversion_key,model), ordered AS (PARTITION BY source_system,source_scope,conversion_key,model ORDER BY touch_at,touch_source_system,touch_source_scope,touch_key))
SELECT *,CASE WHEN value_status!='known' THEN NULL WHEN position=touch_count THEN ABS(CAST(value AS BIGNUMERIC))*1000000000
 ELSE ROUND(SAFE_MULTIPLY(ABS(CAST(value AS BIGNUMERIC))*1000000000,SAFE_DIVIDE(running_weight,total_weight)),0) END endpoint FROM cumulative;
ASSERT NOT EXISTS (SELECT 1 FROM allocation_endpoints WHERE total_weight<=0 OR (value_status='known' AND endpoint IS NULL)) AS 'allocation numeric failure';
CREATE TEMP TABLE allocations AS
SELECT * EXCEPT(numeric_credit,total_weight,running_weight,position,touch_count,endpoint),
 SAFE_CAST(SIGN(value)*SAFE_DIVIDE(endpoint-COALESCE(LAG(endpoint) OVER (PARTITION BY source_system,source_scope,conversion_key,model ORDER BY touch_at,touch_source_system,touch_source_scope,touch_key),0),BIGNUMERIC '1000000000') AS NUMERIC) allocated_value
FROM allocation_endpoints;
-- TEST ALLOCATION MUTATION POINT
ASSERT NOT EXISTS (SELECT 1 FROM allocations WHERE (value_status='known' AND (allocated_value IS NULL OR (value>=0 AND allocated_value<0) OR (value<0 AND allocated_value>0))) OR (value_status!='known' AND allocated_value IS NOT NULL)) AS 'invalid monetary allocation';
ASSERT NOT EXISTS (SELECT 1 FROM allocations WHERE value_status='known' GROUP BY source_system,source_scope,conversion_key,model HAVING SUM(CAST(allocated_value AS BIGNUMERIC))!=CAST(ANY_VALUE(value) AS BIGNUMERIC)) AS 'monetary conservation failed';
CREATE TEMP TABLE spend_selected AS SELECT s.* FROM sd s JOIN sm USING(source_system,source_scope) CROSS JOIN mc WHERE event_date BETWEEN report_start_date AND report_end_date;
-- Aggregate facts before joining; currency never partitions the join.
CREATE TEMP TABLE revenue AS SELECT conversion_date event_date,channel,taxonomy_version,SUM(credit) credited_conversion_count,
 COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_system,source_scope,conversion_key))) qualified_conversion_count,
 COUNT(DISTINCT TO_JSON_STRING(STRUCT(touch_source_system,touch_source_scope,touch_key))) qualified_touch_count,
 COUNTIF(credit=0) zero_credit_row_count,
 CASE WHEN COUNTIF(credit>0 AND value_status='mixed_currency')>0 OR COUNT(DISTINCT IF(credit>0,currency,NULL))>1 THEN 'mixed_currency'
 WHEN COUNTIF(credit>0 AND value_status='unknown')>0 THEN 'unknown' WHEN COUNTIF(credit>0)=0 AND (COUNTIF(value_status!='known')>0 OR COUNT(DISTINCT currency)!=1) THEN 'unknown' ELSE 'known' END revenue_status,
 CASE WHEN COUNTIF(credit>0)=0 AND COUNTIF(value_status!='known')=0 AND COUNT(DISTINCT currency)=1 THEN MAX(currency) WHEN COUNTIF(credit>0 AND value_status='mixed_currency')=0 AND COUNT(DISTINCT IF(credit>0,currency,NULL))=1 THEN MAX(IF(credit>0,currency,NULL)) ELSE NULL END revenue_currency,
 SUM(IF(value_status='known',CAST(allocated_value AS BIGNUMERIC),BIGNUMERIC '0')) known_revenue
FROM allocations GROUP BY 1,2,3;
CREATE TEMP TABLE spend_aggregated AS SELECT event_date,channel,taxonomy_version,COUNT(*) spend_fact_count,
 CASE WHEN COUNTIF(spend_status='mixed_currency')>0 OR COUNT(DISTINCT currency)>1 THEN 'mixed_currency' WHEN COUNTIF(spend_status='unknown')>0 THEN 'unknown' ELSE 'known' END observed_spend_status,
 IF(COUNTIF(spend_status='mixed_currency')=0 AND COUNT(DISTINCT currency)=1,MAX(currency),NULL) observed_spend_currency,
 SUM(IF(spend_status='known',CAST(spend AS BIGNUMERIC),BIGNUMERIC '0')) known_spend FROM spend_selected GROUP BY 1,2,3;
CREATE TEMP TABLE declared_currency AS SELECT CASE WHEN COUNT(DISTINCT currency)>1 THEN 'mixed_currency' WHEN COUNTIF(currency IS NULL)>0 THEN 'unknown' ELSE 'known' END declared_status,IF(COUNT(DISTINCT currency)=1,MAX(currency),NULL) declared_currency FROM sm;
CREATE TEMP TABLE joined AS SELECT event_date,channel,taxonomy_version,COALESCE(credited_conversion_count,0.0) credited_conversion_count,COALESCE(qualified_conversion_count,0) qualified_conversion_count,COALESCE(qualified_touch_count,0) qualified_touch_count,COALESCE(zero_credit_row_count,0) zero_credit_row_count,
 IF(r.channel IS NULL,'spend_only',IF(s.channel IS NULL,'credited_only','matched')) row_kind,
 COALESCE(revenue_status,'unknown') revenue_status,revenue_currency,IF(revenue_status='known',known_revenue,NULL) allocated_revenue,
 CASE WHEN r.channel IS NULL THEN 'no_attributed_revenue_currency' WHEN revenue_status='known' THEN NULL ELSE revenue_status END revenue_reason,
 COALESCE(spend_fact_count,0) spend_fact_count,COALESCE(observed_spend_status,'absent') observed_spend_status,observed_spend_currency,IF(observed_spend_status='known',known_spend,NULL) observed_spend,
 CASE WHEN NOT spend_complete THEN 'unknown' WHEN s.channel IS NOT NULL THEN observed_spend_status ELSE declared_status END spend_status,
 CASE WHEN s.channel IS NOT NULL THEN observed_spend_currency ELSE dc.declared_currency END spend_currency,
 CASE WHEN NOT spend_complete THEN NULL WHEN s.channel IS NOT NULL THEN IF(observed_spend_status='known',known_spend,NULL) WHEN declared_status='known' THEN BIGNUMERIC '0' ELSE NULL END final_spend,
 CASE WHEN NOT spend_complete THEN 'incomplete_spend' WHEN s.channel IS NOT NULL THEN IF(observed_spend_status='known',NULL,observed_spend_status) WHEN declared_status='known' THEN 'complete_absent_zero' ELSE CONCAT('absent_',declared_status) END spend_reason
 FROM revenue r FULL OUTER JOIN spend_aggregated s USING(event_date,channel,taxonomy_version) CROSS JOIN mc CROSS JOIN declared_currency dc;
-- TEST JOIN MUTATION POINT
ASSERT (SELECT COALESCE(SUM(credited_conversion_count),0) FROM joined) BETWEEN (SELECT COUNTIF(status='credited')-GREATEST(1,COUNTIF(status='credited'))*1e-12 FROM cs) AND (SELECT COUNTIF(status='credited')+GREATEST(1,COUNTIF(status='credited'))*1e-12 FROM cs) AS 'metric credit conservation failed';
ASSERT (SELECT COUNT(*) FROM joined)=(SELECT COUNT(*) FROM (SELECT event_date,channel,taxonomy_version FROM revenue UNION DISTINCT SELECT event_date,channel,taxonomy_version FROM spend_aggregated)) AS 'metric join inflation';
CREATE TEMP TABLE ratios AS SELECT *,
 CASE WHEN spend_status!='known' THEN spend_reason WHEN final_spend<0 THEN 'negative_spend' WHEN credited_conversion_count<=0 THEN 'no_attributed_conversions' WHEN SAFE_DIVIDE(final_spend,SAFE_CAST(credited_conversion_count AS BIGNUMERIC)) IS NULL OR (final_spend!=0 AND SAFE_DIVIDE(final_spend,SAFE_CAST(credited_conversion_count AS BIGNUMERIC))=0) THEN 'numeric_failure' ELSE NULL END cost_reason,
 CASE WHEN revenue_status!='known' THEN revenue_reason WHEN spend_status!='known' THEN spend_reason WHEN final_spend<0 THEN 'negative_spend' WHEN final_spend=0 THEN 'zero_spend' WHEN revenue_currency IS NULL OR spend_currency IS NULL OR revenue_currency!=spend_currency THEN 'currency_mismatch' WHEN SAFE_DIVIDE(allocated_revenue,final_spend) IS NULL OR (allocated_revenue!=0 AND SAFE_DIVIDE(allocated_revenue,final_spend)=0) THEN 'numeric_failure' ELSE NULL END roas_reason
 FROM joined;
CREATE TEMP TABLE metrics AS SELECT *,IF(cost_reason IS NULL,SAFE_DIVIDE(final_spend,SAFE_CAST(credited_conversion_count AS BIGNUMERIC)),NULL) cost_per_attributed_conversion,
 IF(outcome_kind='new_customers' AND cost_reason IS NULL,SAFE_DIVIDE(final_spend,SAFE_CAST(credited_conversion_count AS BIGNUMERIC)),NULL) cac,
 IF(outcome_kind='new_customers',cost_reason,'not_new_customer_population') cac_reason,
 IF(roas_reason IS NULL,SAFE_DIVIDE(allocated_revenue,final_spend),NULL) roas FROM ratios CROSS JOIN mc;
CREATE TEMP TABLE metrics_diagnostics AS SELECT mc.*,
 (SELECT COUNT(*) FROM ledger_input)-(SELECT COUNT(*) FROM ld) ledger_duplicates_collapsed,
 (SELECT COUNT(*) FROM coverage_input)-(SELECT COUNT(*) FROM cd) coverage_duplicates_collapsed,
 (SELECT COUNT(*) FROM spend_input)-(SELECT COUNT(*) FROM sd) spend_duplicates_collapsed,
 (SELECT COUNT(*) FROM conversion_scope_input)-(SELECT COUNT(*) FROM cm) conversion_membership_duplicates_collapsed,
 (SELECT COUNT(*) FROM spend_scope_input)-(SELECT COUNT(*) FROM sm) spend_membership_duplicates_collapsed,
 (SELECT COUNT(*) FROM ld l WHERE NOT EXISTS(SELECT 1 FROM cm WHERE cm.source_system=l.source_system AND cm.source_scope=l.source_scope)) nonmember_ledger_rows,
 (SELECT COUNT(*) FROM cd c WHERE NOT EXISTS(SELECT 1 FROM cm WHERE cm.source_system=c.source_system AND cm.source_scope=c.source_scope)) nonmember_coverage_rows,
 (SELECT COUNT(*) FROM sd s WHERE NOT EXISTS(SELECT 1 FROM sm WHERE sm.source_system=s.source_system AND sm.source_scope=s.source_scope)) nonmember_spend_rows,
 (SELECT COUNT(*) FROM sd JOIN sm USING(source_system,source_scope) WHERE event_date NOT BETWEEN report_start_date AND report_end_date) outside_report_spend_rows,
 (SELECT COUNT(*) FROM cs) selected_conversion_count,(SELECT COUNTIF(status='credited') FROM cs) credited_conversion_count,
 (SELECT COUNTIF(status!='credited') FROM cs) uncredited_conversion_count,(SELECT COALESCE(SUM(credit),0.0) FROM ls) total_credit FROM mc;
SELECT invocation_key,TO_JSON_STRING(STRUCT(
 ARRAY(SELECT AS STRUCT a.* EXCEPT(value,allocated_value),CAST(value AS STRING) value,CAST(allocated_value AS STRING) allocated_value,currency allocated_currency,value_status allocation_status,mc.invocation_key,mc.report_scope,mc.outcome_kind,mc.acquisition_history_complete FROM allocations a CROSS JOIN mc ORDER BY conversion_at,source_system,source_scope,conversion_key,touch_at,touch_source_system,touch_source_scope,touch_key) AS allocation_ledger,
 ARRAY(SELECT AS STRUCT * EXCEPT(allocated_revenue,observed_spend,final_spend,cost_per_attributed_conversion,cac,roas),CAST(allocated_revenue AS STRING) allocated_revenue,CAST(observed_spend AS STRING) observed_spend,CAST(final_spend AS STRING) final_spend,CAST(cost_per_attributed_conversion AS STRING) cost_per_attributed_conversion,CAST(cac AS STRING) cac,CAST(roas AS STRING) roas FROM metrics ORDER BY event_date,channel,taxonomy_version) AS channel_metrics,
 ARRAY(SELECT AS STRUCT * EXCEPT(value),CAST(value AS STRING) value FROM cs WHERE status!='credited' ORDER BY conversion_at,source_system,source_scope,conversion_key) AS uncredited_coverage,
 (SELECT AS STRUCT * FROM metrics_diagnostics) AS diagnostics)) result_json FROM mc;

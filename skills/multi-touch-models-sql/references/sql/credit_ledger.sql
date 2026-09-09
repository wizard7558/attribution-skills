-- Native BigQuery Standard SQL multi-touch credit ledger.
-- Inputs are synthetic in this reference and are replaced by the test runner.
-- All tables are temporary; no customer data or permanent objects are used.
-- BEGIN REPLACEABLE INPUTS
CREATE TEMP TABLE invocation_input AS
SELECT CAST('one-touch-all-models' AS STRING) AS invocation_key, CAST('UTC' AS STRING) AS report_timezone, CAST('2026-02-01' AS DATE) AS report_start_date, CAST('2026-02-28' AS DATE) AS report_end_date, CAST('2026-03-01T00:00:00Z' AS TIMESTAMP) AS as_of, CAST('30' AS INT64) AS requested_lookback_days, CAST('1' AS INT64) AS min_lookback_days, CAST('90' AS INT64) AS max_lookback_days, CAST('30' AS FLOAT64) AS half_life_days, CAST('full_lookback' AS STRING) AS conversion_window_mode;
CREATE TEMP TABLE touch_input AS
SELECT CAST('one-touch-all-models' AS STRING) AS invocation_key, CAST('web' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('t1' AS STRING) AS touch_key, CAST('v1' AS STRING) AS visitor_key, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS occurred_at, CAST('Paid Search' AS STRING) AS channel, CAST('0.1.0' AS STRING) AS taxonomy_version, CAST('crm' AS STRING) AS subject_source_system, CAST('a' AS STRING) AS subject_source_scope, CAST('s1' AS STRING) AS subject_key;
CREATE TEMP TABLE conversion_input AS
SELECT CAST('one-touch-all-models' AS STRING) AS invocation_key, CAST('crm' AS STRING) AS source_system, CAST('a' AS STRING) AS source_scope, CAST('c1' AS STRING) AS conversion_key, CAST('2026-02-10T00:00:00Z' AS TIMESTAMP) AS occurred_at, CAST('crm' AS STRING) AS subject_source_system, CAST('a' AS STRING) AS subject_source_scope, CAST('s1' AS STRING) AS subject_key, CAST('100' AS NUMERIC) AS value, CAST('USD' AS STRING) AS currency, CAST('known' AS STRING) AS value_status;
-- END REPLACEABLE INPUTS

ASSERT (SELECT COUNT(*) = 1 FROM invocation_input) AS 'exactly one invocation configuration is required';
ASSERT NOT EXISTS (SELECT 1 FROM invocation_input WHERE invocation_key IS NULL OR invocation_key = '' OR invocation_key != TRIM(invocation_key)
  OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone, r'^[A-Za-z][A-Za-z0-9_+/-]*$')
  OR report_start_date IS NULL OR report_end_date IS NULL OR report_end_date < report_start_date
  OR as_of IS NULL OR requested_lookback_days IS NULL OR min_lookback_days IS NULL OR max_lookback_days IS NULL OR conversion_window_mode IS NULL
  OR TYPEOF(requested_lookback_days) != 'INT64' OR TYPEOF(min_lookback_days) != 'INT64' OR TYPEOF(max_lookback_days) != 'INT64'
  OR TYPEOF(half_life_days) != 'FLOAT64' OR requested_lookback_days <= 0 OR min_lookback_days <= 0 OR max_lookback_days < min_lookback_days
  OR half_life_days IS NULL OR half_life_days <= 0 OR IS_NAN(half_life_days) OR IS_INF(half_life_days)
  OR conversion_window_mode NOT IN ('full_lookback','segmented','acquisition')) AS 'invalid ledger configuration';
ASSERT (SELECT COUNTIF(FORMAT_TIMESTAMP('%F', as_of, report_timezone) IS NOT NULL) = COUNT(*) FROM invocation_input)
  AS 'invalid report timezone';
ASSERT NOT EXISTS (SELECT 1 FROM touch_input WHERE invocation_key IS NULL OR invocation_key != (SELECT invocation_key FROM invocation_input) OR source_system IS NULL OR source_scope IS NULL OR touch_key IS NULL
  OR visitor_key IS NULL OR TRIM(source_system) = '' OR TRIM(source_scope) = '' OR TRIM(touch_key) = '' OR TRIM(visitor_key) = ''
  OR source_system != TRIM(source_system) OR source_scope != TRIM(source_scope) OR touch_key != TRIM(touch_key) OR visitor_key != TRIM(visitor_key)
  OR occurred_at IS NULL OR channel IS NULL OR channel NOT IN ('Paid Search','Paid Social','Paid Other','Organic Search','Organic Social','Email','SMS','Direct','Referral','Affiliate','Other') OR taxonomy_version IS NULL OR taxonomy_version != '0.1.0'
  OR (subject_source_system IS NULL) != (subject_source_scope IS NULL)
  OR (subject_source_system IS NULL) != (subject_key IS NULL)
  OR (subject_source_system IS NOT NULL AND (TRIM(subject_source_system)='' OR TRIM(subject_source_scope)='' OR TRIM(subject_key)='' OR subject_source_system != TRIM(subject_source_system) OR subject_source_scope != TRIM(subject_source_scope) OR subject_key != TRIM(subject_key))) ) AS 'invalid touch input';
ASSERT NOT EXISTS (SELECT 1 FROM conversion_input WHERE invocation_key IS NULL OR invocation_key != (SELECT invocation_key FROM invocation_input) OR source_system IS NULL OR source_scope IS NULL OR conversion_key IS NULL
  OR TRIM(source_system) = '' OR TRIM(source_scope) = '' OR TRIM(conversion_key) = ''
  OR source_system != TRIM(source_system) OR source_scope != TRIM(source_scope) OR conversion_key != TRIM(conversion_key)
  OR occurred_at IS NULL
  OR (subject_source_system IS NULL) != (subject_source_scope IS NULL)
  OR (subject_source_system IS NULL) != (subject_key IS NULL)
  OR TYPEOF(value) != 'NUMERIC' OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency, r'^[A-Z]{3}$'))
  OR value_status IS NULL OR value_status NOT IN ('known','unknown','mixed_currency')
  OR (value_status = 'known' AND (value IS NULL OR currency IS NULL OR NOT REGEXP_CONTAINS(currency, r'^[A-Z]{3}$')))
  OR (value_status = 'mixed_currency' AND (value IS NOT NULL OR currency IS NOT NULL))
  OR (value_status = 'unknown' AND value IS NOT NULL)
  OR (subject_source_system IS NOT NULL AND (TRIM(subject_source_system)='' OR TRIM(subject_source_scope)='' OR TRIM(subject_key)='' OR subject_source_system != TRIM(subject_source_system) OR subject_source_scope != TRIM(subject_source_scope) OR subject_key != TRIM(subject_key)))) AS 'invalid conversion input';
ASSERT NOT EXISTS (SELECT 1 FROM (SELECT source_system, source_scope, touch_key, COUNT(DISTINCT TO_JSON_STRING(t)) n
  FROM touch_input t GROUP BY 1,2,3) WHERE n > 1) AS 'conflicting duplicate touch payload';
ASSERT NOT EXISTS (SELECT 1 FROM (SELECT source_system, source_scope, conversion_key, COUNT(DISTINCT TO_JSON_STRING(c)) n
  FROM conversion_input c GROUP BY 1,2,3) WHERE n > 1) AS 'conflicting duplicate conversion payload';

CREATE TEMP TABLE cfg AS SELECT *, LEAST(max_lookback_days, GREATEST(min_lookback_days, requested_lookback_days)) effective_lookback_days,
  requested_lookback_days < min_lookback_days OR requested_lookback_days > max_lookback_days clamped FROM invocation_input;
CREATE TEMP TABLE touches AS SELECT * FROM touch_input
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_system, source_scope, touch_key ORDER BY occurred_at, TO_JSON_STRING(touch_input)) = 1;
CREATE TEMP TABLE conversions AS SELECT * FROM conversion_input
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_system, source_scope, conversion_key ORDER BY occurred_at, TO_JSON_STRING(conversion_input)) = 1;
-- Tagged JSON of fixed-field STRUCTs keeps unresolved conversions in distinct partitions.
CREATE TEMP TABLE history AS
WITH keyed AS (
 SELECT c.*, IF(subject_key IS NULL,
   TO_JSON_STRING(STRUCT('conversion' AS kind, source_system AS system, source_scope AS scope, conversion_key AS native_key)),
   TO_JSON_STRING(STRUCT('subject' AS kind, subject_source_system AS system, subject_source_scope AS scope, subject_key AS native_key))) subject_partition
 FROM conversions c CROSS JOIN cfg WHERE occurred_at <= as_of
)
SELECT *, ROW_NUMBER() OVER subject_order subject_sequence,
 LAG(occurred_at) OVER subject_order prev_conversion_at
FROM keyed WINDOW subject_order AS (PARTITION BY subject_partition ORDER BY occurred_at, source_system, source_scope, conversion_key);

CREATE TEMP TABLE report_conversions AS
WITH bounded AS (
 SELECT h.*, DATE(occurred_at, report_timezone) conversion_date,
 -- Saturate at BigQuery's earliest timestamp when a valid INT64 lookback exceeds its range.
 TIMESTAMP_MICROS(CAST(GREATEST(BIGNUMERIC '-62135596800000000',
   CAST(UNIX_MICROS(occurred_at) AS BIGNUMERIC) - CAST(effective_lookback_days AS BIGNUMERIC)*86400000000) AS INT64)) lookback_start,
 conversion_window_mode='acquisition' AND subject_sequence>1 acquisition_repeat_excluded
 FROM history h CROSS JOIN cfg
 WHERE DATE(occurred_at, report_timezone) BETWEEN report_start_date AND report_end_date
)
SELECT b.*, IF(conversion_window_mode='segmented' AND prev_conversion_at IS NOT NULL,
 GREATEST(lookback_start,prev_conversion_at),lookback_start) window_start,
 occurred_at window_end,
 conversion_window_mode='segmented' AND prev_conversion_at IS NOT NULL AND prev_conversion_at>=lookback_start window_start_exclusive
FROM bounded b CROSS JOIN cfg;

CREATE TEMP TABLE eligible AS
SELECT c.*, t.source_system touch_source_system, t.source_scope touch_source_scope,
 t.touch_key,t.visitor_key,t.occurred_at touch_at,t.channel,t.taxonomy_version,
 TIMESTAMP_DIFF(c.occurred_at,t.occurred_at,MICROSECOND)/86400000000.0 age_days,
 ROW_NUMBER() OVER touch_order touch_position,
 COUNT(*) OVER (PARTITION BY c.source_system,c.source_scope,c.conversion_key) touch_count
FROM report_conversions c CROSS JOIN cfg JOIN touches t
 ON NOT c.acquisition_repeat_excluded AND c.subject_source_system IS NOT NULL
 AND t.subject_source_system=c.subject_source_system AND t.subject_source_scope=c.subject_source_scope AND t.subject_key=c.subject_key
 AND t.occurred_at>=c.lookback_start AND t.occurred_at<=c.occurred_at
 AND (conversion_window_mode!='segmented' OR c.prev_conversion_at IS NULL OR t.occurred_at>c.prev_conversion_at)
WINDOW touch_order AS (PARTITION BY c.source_system,c.source_scope,c.conversion_key ORDER BY t.occurred_at,t.source_system,t.source_scope,t.touch_key);

CREATE TEMP TABLE ledger AS
WITH ages AS (
 SELECT *, TIMESTAMP_DIFF(
  MAX(touch_at) OVER (PARTITION BY source_system,source_scope,conversion_key),
  touch_at, MICROSECOND)/86400000000.0 relative_age_days FROM eligible
), raw AS (
 SELECT a.*, CASE WHEN relative_age_days=0 THEN 1.0
 -- Overflow for tiny positive half-lives means an effectively zero older weight.
 WHEN SAFE_DIVIDE(relative_age_days,half_life_days) IS NULL THEN 0.0
 ELSE POW(2.0,-SAFE_DIVIDE(relative_age_days,half_life_days)) END decay_raw
 FROM ages a CROSS JOIN cfg
), normalized AS (
 SELECT *, SUM(decay_raw) OVER (PARTITION BY source_system,source_scope,conversion_key) decay_sum FROM raw
)
SELECT source_system,source_scope,conversion_key,subject_source_system,subject_source_scope,subject_key,
 touch_source_system,touch_source_scope,touch_key,visitor_key,channel,taxonomy_version,
 occurred_at conversion_at,touch_at,conversion_date,DATE(touch_at,report_timezone) touch_date,
 report_timezone,report_start_date,report_end_date,as_of,conversion_window_mode,
 lookback_start,window_start,window_end,window_start_exclusive,prev_conversion_at,
 requested_lookback_days,min_lookback_days,max_lookback_days,effective_lookback_days,clamped,half_life_days,
 value,currency,value_status,model,
 CAST(CASE model WHEN 'first_touch' THEN IF(touch_position=1,1.0,0.0)
 WHEN 'last_touch' THEN IF(touch_position=touch_count,1.0,0.0)
 WHEN 'linear' THEN 1.0/touch_count
 WHEN 'time_decay' THEN decay_raw/decay_sum
 WHEN 'position_based' THEN CASE WHEN touch_count=1 THEN 1.0 WHEN touch_count=2 THEN .5
 WHEN touch_position=1 OR touch_position=touch_count THEN .4 ELSE .2/(touch_count-2) END END AS FLOAT64) credit
FROM normalized CROSS JOIN cfg CROSS JOIN UNNEST(['first_touch','last_touch','linear','time_decay','position_based']) model;

-- TEST CREDIT MUTATION POINT: production assertions below also run on injected test mutations.
ASSERT NOT EXISTS (SELECT 1 FROM ledger WHERE credit IS NULL OR IS_NAN(credit) OR IS_INF(credit) OR credit<0)
 AS 'invalid credit value';
ASSERT NOT EXISTS (SELECT 1 FROM ledger GROUP BY source_system,source_scope,conversion_key,model HAVING ABS(SUM(credit)-1)>1e-12)
 AS 'credit conservation failed';

CREATE TEMP TABLE coverage AS
SELECT c.source_system,c.source_scope,c.conversion_key,c.subject_source_system,c.subject_source_scope,c.subject_key,
 c.occurred_at conversion_at,c.conversion_date,c.value,c.currency,c.value_status,m AS model,
 cfg.conversion_window_mode,cfg.requested_lookback_days,cfg.effective_lookback_days,
 COUNT(l.touch_key) eligible_touch_count, COALESCE(SUM(l.credit),0.0) total_credit,
 CASE WHEN c.subject_source_system IS NULL THEN 'unresolved_subject'
 WHEN LOGICAL_OR(c.acquisition_repeat_excluded) THEN 'acquisition_repeat_excluded'
 WHEN COUNT(l.touch_key)=0 THEN 'no_eligible_touches' ELSE 'credited' END status
FROM report_conversions c CROSS JOIN cfg
CROSS JOIN UNNEST(['first_touch','last_touch','linear','time_decay','position_based']) AS m
LEFT JOIN ledger l ON l.source_system=c.source_system AND l.source_scope=c.source_scope AND l.conversion_key=c.conversion_key AND l.model=m
GROUP BY ALL;
CREATE TEMP TABLE diagnostics AS SELECT cfg.invocation_key,
 (SELECT COUNT(*) FROM touch_input) input_touch_count,(SELECT COUNT(*) FROM touches) deduped_touch_count,
 (SELECT COUNT(*) FROM conversion_input) input_conversion_count,(SELECT COUNT(*) FROM conversions) deduped_conversion_count,
 (SELECT COUNT(*) FROM touch_input WHERE occurred_at>cfg.as_of) future_touches_excluded,
 (SELECT COUNT(*) FROM conversion_input WHERE occurred_at>cfg.as_of) future_conversions_excluded,
 (SELECT COUNT(*) FROM conversions WHERE DATE(occurred_at,cfg.report_timezone) NOT BETWEEN cfg.report_start_date AND cfg.report_end_date AND occurred_at<=cfg.as_of) outside_report_conversions,
 (SELECT COUNT(*) FROM touches WHERE subject_source_system IS NULL) unresolved_touch_count,
 cfg.requested_lookback_days,cfg.effective_lookback_days,cfg.clamped FROM cfg;
SELECT cfg.invocation_key, TO_JSON_STRING(STRUCT(
 ARRAY(SELECT AS STRUCT * FROM ledger ORDER BY conversion_at,source_system,source_scope,conversion_key,model,touch_at,touch_source_system,touch_source_scope,touch_key) AS ledger,
 ARRAY(SELECT AS STRUCT * FROM coverage ORDER BY conversion_at,source_system,source_scope,conversion_key,model) AS coverage,
 (SELECT AS STRUCT * FROM diagnostics) AS diagnostics)) result_json FROM cfg;

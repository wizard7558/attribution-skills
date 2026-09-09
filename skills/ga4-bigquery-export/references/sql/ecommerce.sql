-- Standalone observed-export dedup policy; this is not GA4 UI reconciliation.
-- Replace the scope token and both window pairs. Daily tables only; no intraday union.
CREATE TEMP FUNCTION finite_money(x FLOAT64)
RETURNS STRUCT<value FLOAT64, status STRING>
AS (STRUCT(IF(x IS NULL OR IS_NAN(x) OR IS_INF(x), NULL, x),
  CASE WHEN x IS NULL THEN 'unknown' WHEN IS_NAN(x) OR IS_INF(x) THEN 'invalid' ELSE 'known' END));

CREATE TEMP TABLE purchase_raw AS
SELECT 'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
  platform, stream_id, user_pseudo_id, ecommerce.transaction_id AS transaction_id,
  PARSE_DATE('%Y%m%d', event_date) AS event_date, event_timestamp,
  STRUCT(ecommerce.purchase_revenue_in_usd AS revenue_usd,
    ecommerce.tax_value_in_usd AS tax_usd,
    ecommerce.shipping_value_in_usd AS shipping_usd,
    ecommerce.purchase_revenue AS native_revenue,
    (SELECT p.value.string_value FROM UNNEST(event_params) p WITH OFFSET o
      WHERE p.key = 'currency' ORDER BY o LIMIT 1) AS currency,
    ecommerce.total_item_quantity AS total_item_quantity,
    ecommerce.unique_items AS unique_items,
    ARRAY(SELECT AS STRUCT o AS item_offset, i.item_id, i.item_name, i.item_category,
      i.quantity, i.item_revenue_in_usd AS revenue_usd, i.item_revenue AS native_revenue
      FROM UNNEST(items) i WITH OFFSET o ORDER BY o) AS items) AS payload
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
  AND event_name = 'purchase';

CREATE TEMP TABLE purchase_evidence AS
SELECT *, TO_JSON_STRING(payload) AS payload_json,
  NULLIF(TRIM(platform), '') IS NOT NULL AND NULLIF(TRIM(stream_id), '') IS NOT NULL
    AND NULLIF(TRIM(user_pseudo_id), '') IS NOT NULL
    AND NULLIF(TRIM(transaction_id), '') IS NOT NULL AS qualified,
  TO_JSON_STRING(STRUCT(source_system, source_scope, platform, stream_id,
    user_pseudo_id, transaction_id, event_date, event_timestamp, payload)) AS evidence_json
FROM purchase_raw;

CREATE TEMP TABLE occurrences AS
SELECT source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  payload_json, event_date, event_timestamp, evidence_json, COUNT(*) AS occurrence_count
FROM purchase_evidence WHERE qualified
GROUP BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  payload_json, event_date, event_timestamp, evidence_json;

CREATE TEMP TABLE variants AS
SELECT source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  payload_json, SUM(occurrence_count) AS occurrence_count,
  ARRAY_AGG(STRUCT(event_date, CAST(event_timestamp AS STRING) AS event_timestamp_micros,
    occurrence_count) ORDER BY event_timestamp, event_date, evidence_json) AS occurrences,
  ARRAY_AGG(STRUCT(event_date, event_timestamp, evidence_json)
    ORDER BY event_timestamp, event_date, evidence_json LIMIT 1)[OFFSET(0)] AS first_occurrence
FROM occurrences
GROUP BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id, payload_json;

CREATE TEMP TABLE transactions AS
SELECT source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  ARRAY_AGG(first_occurrence ORDER BY first_occurrence.event_timestamp,
    first_occurrence.event_date, first_occurrence.evidence_json LIMIT 1)[OFFSET(0)].event_date AS event_date,
  SUM(occurrence_count) AS occurrence_count, COUNT(*) AS payload_variant_count,
  SUM(occurrence_count) - COUNT(*) AS collapsed_duplicate_events,
  IF(COUNT(*) = 1, 'accepted', 'conflict') AS status,
  IF(COUNT(*) = 1, MIN(payload_json), NULL) AS accepted_payload_json,
  ARRAY_AGG(STRUCT(payload_json, occurrence_count, occurrences) ORDER BY payload_json) AS variants
FROM variants
GROUP BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id;

CREATE TEMP TABLE transaction_money AS
SELECT t.source_system, t.source_scope, t.platform, t.stream_id, t.user_pseudo_id,
  t.transaction_id, t.event_date, metric,
  IF(t.status = 'conflict', STRUCT(CAST(NULL AS FLOAT64) AS value, 'conflict' AS status),
    finite_money(CAST(CASE metric
      WHEN 'revenue_usd' THEN JSON_VALUE(t.accepted_payload_json, '$.revenue_usd')
      WHEN 'shipping_usd' THEN JSON_VALUE(t.accepted_payload_json, '$.shipping_usd')
      WHEN 'tax_usd' THEN JSON_VALUE(t.accepted_payload_json, '$.tax_usd') END AS FLOAT64))) AS amount
FROM transactions t
CROSS JOIN UNNEST(['revenue_usd', 'tax_usd', 'shipping_usd']) AS metric;

CREATE TEMP TABLE item_lines AS
SELECT t.source_system, t.source_scope, t.platform, t.stream_id, t.user_pseudo_id,
  t.transaction_id, t.event_date,
  CAST(JSON_VALUE(i, '$.item_offset') AS INT64) AS item_offset,
  JSON_VALUE(i, '$.item_id') AS item_id, JSON_VALUE(i, '$.item_name') AS item_name,
  JSON_VALUE(i, '$.item_category') AS item_category,
  STRUCT(CAST(JSON_VALUE(i, '$.quantity') AS INT64) AS value,
    IF(JSON_VALUE(i, '$.quantity') IS NULL, 'unknown', 'known') AS status) AS quantity,
  finite_money(CAST(JSON_VALUE(i, '$.revenue_usd') AS FLOAT64)) AS revenue_usd
FROM transactions t
CROSS JOIN UNNEST(JSON_QUERY_ARRAY(t.accepted_payload_json, '$.items')) i
WHERE t.status = 'accepted';
-- TEST ITEM MUTATION POINT

CREATE TEMP TABLE unkeyed AS
SELECT source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  event_date, CAST(event_timestamp AS STRING) AS event_timestamp_micros,
  payload_json, evidence_json, COUNT(*) AS occurrence_count,
  ARRAY(SELECT reason FROM UNNEST([
    IF(NULLIF(TRIM(platform), '') IS NULL, 'missing_platform', NULL),
    IF(NULLIF(TRIM(stream_id), '') IS NULL, 'missing_stream_id', NULL),
    IF(NULLIF(TRIM(user_pseudo_id), '') IS NULL, 'missing_user_pseudo_id', NULL),
    IF(NULLIF(TRIM(transaction_id), '') IS NULL, 'missing_transaction_id', NULL)]) reason
    WHERE reason IS NOT NULL) AS reasons
FROM purchase_evidence WHERE NOT qualified
GROUP BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
  event_date, event_timestamp, payload_json, evidence_json;

CREATE TEMP TABLE daily_counts AS
SELECT d.event_date,
  (SELECT COUNTIF(NOT qualified) > 0 FROM purchase_evidence) AS window_has_unkeyed_evidence,
  (SELECT COUNT(*) FROM purchase_evidence p WHERE p.event_date = d.event_date) AS observed_purchase_events,
  (SELECT COUNT(*) FROM transactions t WHERE t.event_date = d.event_date) AS qualified_transaction_count,
  (SELECT COUNTIF(t.status = 'accepted') FROM transactions t WHERE t.event_date = d.event_date) AS accepted_transaction_count,
  (SELECT COUNTIF(t.status = 'conflict') FROM transactions t WHERE t.event_date = d.event_date) AS conflicting_transaction_count,
  COALESCE((SELECT SUM(t.occurrence_count) FROM transactions t WHERE t.event_date = d.event_date), 0) AS assigned_qualified_events,
  COALESCE((SELECT SUM(t.collapsed_duplicate_events) FROM transactions t WHERE t.event_date = d.event_date), 0) AS collapsed_duplicate_events,
  COALESCE((SELECT SUM(u.occurrence_count) FROM unkeyed u WHERE u.event_date = d.event_date), 0) AS unkeyed_purchase_events,
  (SELECT COUNT(*) FROM item_lines i WHERE i.event_date = d.event_date) AS item_line_count
FROM (SELECT DISTINCT event_date FROM purchase_evidence) d;

CREATE TEMP TABLE daily_scaled AS
SELECT d.event_date, metric_name AS metric,
  COUNTIF(m.amount.status = 'known') AS known_count,
  COUNTIF(m.amount.status = 'unknown') AS unknown_count,
  COUNTIF(m.amount.status = 'invalid') AS invalid_count,
  COUNTIF(m.amount.status = 'conflict') AS conflict_count,
  MAX(ABS(m.amount.value)) AS scale
FROM daily_counts d CROSS JOIN UNNEST(['revenue_usd', 'tax_usd', 'shipping_usd']) metric_name
LEFT JOIN transaction_money m ON m.event_date = d.event_date AND m.metric = metric_name
GROUP BY d.event_date, metric_name;

CREATE TEMP TABLE daily_subtotals AS
SELECT s.*,
  CASE WHEN known_count = 0 THEN NULL WHEN scale = 0 THEN 0
    ELSE SAFE_MULTIPLY(scale,
      (SELECT SUM(SAFE_DIVIDE(m.amount.value, s.scale)) FROM transaction_money m
       WHERE m.event_date = s.event_date AND m.metric = s.metric AND m.amount.status = 'known'))
    END AS subtotal
FROM daily_scaled s;

CREATE TEMP TABLE daily_money AS
SELECT s.event_date, s.metric,
  s.known_count, s.unknown_count, s.invalid_count, s.conflict_count,
  CASE WHEN s.known_count > 0 AND (s.subtotal IS NULL OR IS_NAN(s.subtotal) OR IS_INF(s.subtotal)) THEN NULL
    ELSE s.subtotal END AS known_subtotal,
  CASE WHEN s.known_count > 0 AND (s.subtotal IS NULL OR IS_NAN(s.subtotal) OR IS_INF(s.subtotal)) THEN NULL
    WHEN d.window_has_unkeyed_evidence OR s.conflict_count > 0 OR s.unknown_count > 0 OR s.invalid_count > 0 THEN NULL
    WHEN d.qualified_transaction_count = 0 THEN 0 ELSE s.subtotal END AS value,
  ARRAY(SELECT reason FROM UNNEST([
    IF(s.known_count > 0 AND (s.subtotal IS NULL OR IS_NAN(s.subtotal) OR IS_INF(s.subtotal)), 'numeric_failure', NULL),
    IF(d.window_has_unkeyed_evidence, 'unkeyed_window_evidence', NULL),
    IF(s.conflict_count > 0, 'conflicting_payload', NULL),
    IF(s.invalid_count > 0, 'invalid_amount', NULL),
    IF(s.unknown_count > 0, 'unknown_amount', NULL)]) reason WHERE reason IS NOT NULL) AS reasons
FROM daily_subtotals s JOIN daily_counts d USING (event_date);
-- TEST COUNT MUTATION POINT

CREATE TEMP TABLE daily_output AS
SELECT d.*, IF(window_has_unkeyed_evidence, NULL, qualified_transaction_count) AS all_population_unique_purchase_count,
  m.money
FROM daily_counts d JOIN (
  SELECT event_date, ARRAY_AGG(STRUCT(metric, known_count, unknown_count, invalid_count, conflict_count,
    known_subtotal, value, reasons) ORDER BY metric) AS money
  FROM daily_money GROUP BY event_date
) m USING (event_date);

CREATE TEMP TABLE transaction_output AS
SELECT t.*, m.money FROM transactions t JOIN (
  SELECT source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id,
    ARRAY_AGG(STRUCT(metric, amount) ORDER BY metric) AS money
  FROM transaction_money GROUP BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id
) m USING (source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id);

SELECT TO_JSON_STRING(STRUCT(
  STRUCT('ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    'YYYYMMDD' AS start_suffix, 'YYYYMMDD' AS end_suffix,
    'qualified_transaction_observed_window_v1' AS policy,
    'source_system/source_scope/platform/stream_id/user_pseudo_id/exact_transaction_id' AS transaction_domain,
    'earliest observed event_timestamp/event_date/selected_evidence_json' AS date_assignment,
    'FLOAT64 scaled approximate USD sums; no native-money aggregation' AS money_basis,
    CAST(NULL AS STRING) AS reporting_timezone, FALSE AS ga4_ui_parity) AS declaration,
  ARRAY(SELECT AS STRUCT * FROM daily_output ORDER BY event_date) AS daily_summary,
  ARRAY(SELECT AS STRUCT * FROM transaction_output
    ORDER BY source_system, source_scope, platform, stream_id, user_pseudo_id, transaction_id) AS qualified_transactions,
  ARRAY(SELECT AS STRUCT * FROM item_lines ORDER BY source_system, source_scope, platform, stream_id,
    user_pseudo_id, transaction_id, item_offset) AS item_lines,
  ARRAY(SELECT AS STRUCT * FROM unkeyed ORDER BY event_date, event_timestamp_micros, evidence_json) AS unkeyed_evidence,
  STRUCT((SELECT COUNTIF(NOT qualified) > 0 FROM purchase_evidence) AS window_has_unkeyed_evidence,
    (SELECT COUNT(*) FROM purchase_evidence) AS observed_purchase_events,
    (SELECT COUNTIF(qualified) FROM purchase_evidence) AS qualified_purchase_events,
    (SELECT COUNTIF(NOT qualified) FROM purchase_evidence) AS unkeyed_purchase_events,
    (SELECT COUNT(*) FROM transactions) AS qualified_transaction_count,
    IF((SELECT COUNTIF(NOT qualified) FROM purchase_evidence)>0, NULL,
      (SELECT COUNT(*) FROM transactions)) AS all_population_unique_purchase_count,
    (SELECT COUNTIF(status='accepted') FROM transactions) AS accepted_transaction_count,
    (SELECT COUNTIF(status='conflict') FROM transactions) AS conflicting_transaction_count,
    COALESCE((SELECT SUM(payload_variant_count) FROM transactions),0) AS qualified_payload_variants,
    COALESCE((SELECT SUM(collapsed_duplicate_events) FROM transactions),0) AS collapsed_duplicate_events,
    (SELECT COUNT(*) FROM item_lines) AS item_line_count) AS diagnostics
)) AS result_json;

-- Native Standard SQL stage truth. Synthetic inputs; temporary tables only.
-- One explicitly scoped CRM snapshot per production invocation.
-- BEGIN REPLACEABLE INPUTS
CREATE TEMP TABLE invocation_input AS
SELECT 'reference' AS invocation_key, 'synthetic_crm' AS source_system,
       'synthetic_scope' AS source_scope, 'UTC' AS report_timezone,
       TIMESTAMP '2026-02-01T00:00:00Z' AS as_of, TRUE AS opportunities_complete;
CREATE TEMP TABLE lead_input AS
SELECT 'reference' AS invocation_key, 'synthetic_crm' AS source_system,
       'synthetic_scope' AS source_scope, 'Lead+Case' AS lead_key,
       TIMESTAMP '2026-01-01T00:00:00Z' AS created_at, 'accepted' AS status,
       TRUE AS is_converted, TIMESTAMP '2026-01-03T00:00:00Z' AS converted_at,
       TIMESTAMP '2026-01-02T00:00:00Z' AS qualified_at, FALSE AS is_attribution_primary,
       CAST(NULL AS STRING) AS channel, CAST(NULL AS STRING) AS taxonomy_version,
       CAST(NULL AS STRING) AS network_id, CAST(NULL AS STRING) AS campaign_key,
       CAST(NULL AS STRING) AS ad_source_system, CAST(NULL AS STRING) AS ad_source_scope,
       CAST(NULL AS STRING) AS ad_key;
CREATE TEMP TABLE stage_input AS
SELECT 'reference' AS invocation_key, stage_key, stage_order, stage_kind
FROM UNNEST([
  STRUCT('lead' AS stage_key, 0.0 AS stage_order, 'lead' AS stage_kind),
  STRUCT('qualified', 10.0, 'qualified'), STRUCT('converted', 30.0, 'converted'),
  STRUCT('won', 70.0, 'won'), STRUCT('engaged', 95.0, 'event')
]);
CREATE TEMP TABLE exclusion_input AS
SELECT 'reference' AS invocation_key, 'qualified' AS stage_key, 'rejected' AS status;
CREATE TEMP TABLE opportunity_input AS
SELECT 'reference' AS invocation_key, 'synthetic_crm' AS source_system,
       'synthetic_scope' AS source_scope, opportunity_key,
       'synthetic_crm' AS lead_source_system, 'synthetic_scope' AS lead_source_scope,
       'Lead+Case' AS lead_key, is_won, won_at, value, currency, value_status
FROM UNNEST([
  STRUCT('Win+A' AS opportunity_key, TRUE AS is_won,
         TIMESTAMP '2026-01-04T00:00:00Z' AS won_at, NUMERIC '100.00' AS value, 'USD' AS currency, 'known' AS value_status),
  STRUCT('Win+B', TRUE, TIMESTAMP '2026-01-05T00:00:00Z', NUMERIC '50.00', 'USD', 'known'),
  STRUCT('LaterLoss', FALSE, TIMESTAMP '2026-01-06T00:00:00Z', CAST(NULL AS NUMERIC), CAST(NULL AS STRING), 'unknown')
]);
CREATE TEMP TABLE event_input AS
SELECT 'reference' AS invocation_key, 'synthetic_crm' AS source_system,
       'synthetic_scope' AS source_scope, 'Event+A' AS event_key,
       'synthetic_crm' AS lead_source_system, 'synthetic_scope' AS lead_source_scope,
       'Lead+Case' AS lead_key, 'engaged' AS stage_key,
       TIMESTAMP '2026-01-03T12:00:00Z' AS occurred_at;
-- END REPLACEABLE INPUTS

-- BEGIN INVOCATION CARDINALITY CHECK
ASSERT (SELECT COUNT(*) = 1 FROM invocation_input)
AS 'exactly one invocation configuration is required';
-- END INVOCATION CARDINALITY CHECK
ASSERT NOT EXISTS (
  SELECT 1 FROM invocation_input
  WHERE invocation_key IS NULL OR TRIM(invocation_key) = ''
     OR source_system IS NULL OR TRIM(source_system) = '' OR source_system != TRIM(source_system)
     OR source_scope IS NULL OR TRIM(source_scope) = '' OR source_scope != TRIM(source_scope)
     OR report_timezone IS NULL OR NOT REGEXP_CONTAINS(report_timezone, r'^(UTC|[A-Za-z_]+/[A-Za-z0-9_+/-]+)$')
     OR as_of IS NULL OR opportunities_complete IS NULL
) AS 'invalid required invocation configuration';
ASSERT (SELECT COUNTIF(FORMAT_TIMESTAMP('%F', as_of, report_timezone) IS NOT NULL) = COUNT(*)
        FROM invocation_input) AS 'invalid report timezone';
ASSERT NOT EXISTS (
  SELECT invocation_key FROM invocation_input GROUP BY invocation_key HAVING COUNT(*) != 1
) AS 'duplicate invocation configuration';
ASSERT NOT EXISTS (
  SELECT 1 FROM (
    SELECT invocation_key FROM lead_input UNION ALL SELECT invocation_key FROM stage_input
    UNION ALL SELECT invocation_key FROM opportunity_input UNION ALL SELECT invocation_key FROM event_input
    UNION ALL SELECT invocation_key FROM exclusion_input
  ) x LEFT JOIN invocation_input c USING (invocation_key) WHERE c.invocation_key IS NULL
) AS 'input has no invocation configuration';
ASSERT NOT EXISTS (
  SELECT 1 FROM stage_input WHERE stage_key IS NULL OR TRIM(stage_key) = '' OR stage_key != TRIM(stage_key)
  OR stage_order IS NULL OR IS_NAN(stage_order) OR IS_INF(stage_order)
  OR stage_order != TRUNC(stage_order) OR SAFE_CAST(stage_order AS INT64) IS NULL
  OR stage_kind IS NULL OR stage_kind NOT IN ('lead', 'qualified', 'converted', 'won', 'event')
) AS 'invalid stage configuration';
CREATE TEMP TABLE stages AS SELECT DISTINCT invocation_key, stage_key,
  CAST(stage_order AS INT64) AS stage_order, stage_kind FROM stage_input;
ASSERT NOT EXISTS (
  SELECT invocation_key, stage_key FROM stages GROUP BY 1, 2 HAVING COUNT(*) > 1
) AS 'conflicting stage key';
ASSERT NOT EXISTS (
  SELECT invocation_key, stage_order FROM stages GROUP BY 1, 2 HAVING COUNT(*) > 1
) AS 'conflicting stage order';
ASSERT NOT EXISTS (
  SELECT 1 FROM invocation_input c WHERE NOT EXISTS (SELECT 1 FROM stages s WHERE s.invocation_key = c.invocation_key)
) AS 'at least one stage is required';
ASSERT NOT EXISTS (
  SELECT 1 FROM lead_input l JOIN invocation_input c USING (invocation_key)
  WHERE l.source_system IS NULL OR l.source_scope IS NULL OR l.lead_key IS NULL OR TRIM(l.lead_key) = ''
     OR l.lead_key != TRIM(l.lead_key) OR l.source_system != c.source_system OR l.source_scope != c.source_scope
     OR l.is_attribution_primary IS NULL
     OR (CAST(l.ad_source_system IS NOT NULL AS INT64) + CAST(l.ad_source_scope IS NOT NULL AS INT64)
         + CAST(l.ad_key IS NOT NULL AS INT64)) NOT IN (0, 3)
     OR (l.ad_key IS NOT NULL AND (TRIM(l.ad_key) = '' OR TRIM(l.ad_source_system) = '' OR TRIM(l.ad_source_scope) = ''
         OR l.ad_key != TRIM(l.ad_key) OR l.ad_source_system != TRIM(l.ad_source_system) OR l.ad_source_scope != TRIM(l.ad_source_scope)))
     OR (l.channel IS NULL) != (l.taxonomy_version IS NULL)
     OR (l.channel IS NOT NULL AND (l.taxonomy_version != '0.1.0' OR l.channel NOT IN
         ('Paid Search', 'Paid Social', 'Paid Other', 'Organic Search', 'Organic Social', 'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other')))
     -- BEGIN OPTIONAL KEY VALIDATION
     OR (l.network_id IS NOT NULL AND (TRIM(l.network_id) = '' OR l.network_id != TRIM(l.network_id)))
     OR (l.campaign_key IS NOT NULL AND (TRIM(l.campaign_key) = '' OR l.campaign_key != TRIM(l.campaign_key)))
     -- END OPTIONAL KEY VALIDATION
) AS 'invalid lead identity or attribution metadata';
CREATE TEMP TABLE leads_snapshot AS SELECT DISTINCT * FROM lead_input;
ASSERT NOT EXISTS (
  SELECT invocation_key, source_system, source_scope, lead_key FROM leads_snapshot
  GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1
) AS 'conflicting lead snapshot';
ASSERT NOT EXISTS (
  SELECT 1 FROM (
    SELECT invocation_key, source_system, source_scope, opportunity_key AS record_key,
           lead_source_system, lead_source_scope, lead_key FROM opportunity_input
    UNION ALL
    SELECT invocation_key, source_system, source_scope, event_key,
           lead_source_system, lead_source_scope, lead_key FROM event_input
  ) r JOIN invocation_input c USING (invocation_key)
  WHERE r.source_system IS NULL OR r.source_scope IS NULL OR r.record_key IS NULL OR TRIM(r.record_key) = ''
     OR r.record_key != TRIM(r.record_key) OR TRIM(r.source_system) = '' OR TRIM(r.source_scope) = ''
     OR r.source_system != TRIM(r.source_system) OR r.source_scope != TRIM(r.source_scope)
     OR r.lead_source_system IS NULL OR r.lead_source_scope IS NULL OR r.lead_key IS NULL
     OR r.lead_source_system != c.source_system OR r.lead_source_scope != c.source_scope
     OR NOT EXISTS (SELECT 1 FROM leads_snapshot l WHERE l.invocation_key = r.invocation_key
         AND l.source_system = r.lead_source_system AND l.source_scope = r.lead_source_scope AND l.lead_key = r.lead_key)
) AS 'invalid qualified lead reference';
ASSERT NOT EXISTS (
  SELECT 1 FROM opportunity_input
  WHERE value_status IS NULL OR value_status NOT IN ('known', 'unknown', 'mixed_currency')
     OR (currency IS NOT NULL AND NOT REGEXP_CONTAINS(currency, r'^[A-Z]{3}$'))
     OR (value_status = 'known' AND (value IS NULL OR currency IS NULL))
     OR (value_status IN ('unknown', 'mixed_currency') AND value IS NOT NULL)
     OR (value_status = 'mixed_currency' AND currency IS NOT NULL)
) AS 'invalid monetary value contract';
CREATE TEMP TABLE opportunities AS SELECT DISTINCT * FROM opportunity_input;
ASSERT NOT EXISTS (
  SELECT invocation_key, source_system, source_scope, opportunity_key FROM opportunities
  GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1
) AS 'conflicting opportunity payload';
CREATE TEMP TABLE events AS SELECT DISTINCT * FROM event_input;
ASSERT NOT EXISTS (
  SELECT invocation_key, source_system, source_scope, event_key FROM events
  GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1
) AS 'conflicting event payload';
ASSERT NOT EXISTS (
  SELECT 1 FROM events e LEFT JOIN stages s USING (invocation_key, stage_key)
  WHERE s.stage_key IS NULL OR s.stage_kind != 'event'
) AS 'event requires configured event stage';
ASSERT NOT EXISTS (
  SELECT 1 FROM exclusion_input e LEFT JOIN stages s USING (invocation_key, stage_key)
  WHERE s.stage_key IS NULL OR s.stage_kind != 'qualified' OR e.status IS NULL OR TRIM(e.status) = ''
) AS 'invalid qualification exclusion seed';
CREATE TEMP TABLE exclusions AS SELECT DISTINCT invocation_key, stage_key, LOWER(TRIM(status)) AS status FROM exclusion_input;
CREATE TEMP TABLE leads AS SELECT l.* FROM leads_snapshot l JOIN invocation_input c USING (invocation_key)
WHERE l.created_at IS NULL OR l.created_at <= c.as_of;

-- Aggregate every distinct opportunity before joining the lead-stage spine.
CREATE TEMP TABLE opportunity_truth AS
WITH marked AS (
  SELECT o.*, c.opportunities_complete,
         o.is_won IS TRUE AND (o.won_at IS NULL OR o.won_at <= c.as_of) AS eligible_win,
         o.is_won IS TRUE AND o.won_at > c.as_of AS future_win
  FROM opportunities o JOIN invocation_input c USING (invocation_key)
)
SELECT invocation_key, lead_source_system, lead_source_scope, lead_key,
       COUNTIF(eligible_win) AS win_count, COUNTIF(future_win) AS pending_win_count,
       COUNTIF(is_won IS NULL) AS unknown_win_count,
       MIN(IF(eligible_win, won_at, NULL)) AS first_won_at,
       COUNTIF(eligible_win AND value_status != 'known') AS unknown_value_count,
       COUNTIF(eligible_win AND value_status = 'mixed_currency') AS mixed_value_count,
       COUNT(DISTINCT IF(eligible_win AND value_status = 'known', currency, NULL)) AS known_currency_count,
       COUNT(DISTINCT IF(eligible_win, currency, NULL)) AS currency_count,
       COUNTIF(eligible_win AND currency IS NULL) AS missing_currency_count,
       MAX(IF(eligible_win, currency, NULL)) AS winning_currency,
       SUM(IF(eligible_win AND value_status = 'known', value, NULL)) AS known_winning_value,
       ARRAY_AGG(IF(eligible_win, STRUCT(source_system, source_scope, 'opportunity' AS record_kind,
                     opportunity_key AS record_key), NULL) IGNORE NULLS ORDER BY source_system, source_scope, opportunity_key) AS winning_keys
FROM marked GROUP BY 1, 2, 3, 4;

CREATE TEMP TABLE event_truth AS
SELECT e.invocation_key, e.lead_source_system, e.lead_source_scope, e.lead_key, e.stage_key,
       ARRAY_AGG(IF(e.occurred_at IS NULL OR e.occurred_at <= c.as_of,
                    STRUCT(e.occurred_at, e.event_key, e.source_system, e.source_scope), NULL)
                 IGNORE NULLS ORDER BY e.occurred_at IS NULL, e.occurred_at ASC, e.event_key, e.source_system, e.source_scope LIMIT 1)[SAFE_OFFSET(0)] AS first_event,
       COUNTIF(e.occurred_at > c.as_of) AS pending_event_count
FROM events e JOIN invocation_input c USING (invocation_key)
GROUP BY 1, 2, 3, 4, 5;

CREATE TEMP TABLE stage_ledger AS
WITH truth AS (
 SELECT l.*, s.stage_key, s.stage_order, s.stage_kind, c.report_timezone, c.opportunities_complete,
        o.* EXCEPT(invocation_key, lead_source_system, lead_source_scope, lead_key), e.first_event, e.pending_event_count,
        CASE s.stage_kind
          WHEN 'lead' THEN TRUE
          WHEN 'qualified' THEN CASE
            WHEN NULLIF(TRIM(l.status), '') IS NULL THEN NULL
            WHEN EXISTS (SELECT 1 FROM exclusions x WHERE x.invocation_key = l.invocation_key
                         AND x.stage_key = s.stage_key AND x.status = LOWER(TRIM(l.status))) THEN FALSE
            WHEN l.qualified_at > c.as_of THEN FALSE ELSE TRUE END
          WHEN 'converted' THEN IF(l.is_converted IS TRUE AND l.converted_at > c.as_of, FALSE, l.is_converted)
          WHEN 'won' THEN CASE WHEN o.win_count > 0 THEN TRUE
            WHEN NOT c.opportunities_complete OR o.unknown_win_count > 0 THEN NULL ELSE FALSE END
          WHEN 'event' THEN e.first_event IS NOT NULL
        END AS achieved,
        CASE s.stage_kind
          WHEN 'qualified' THEN l.qualified_at > c.as_of AND NULLIF(TRIM(l.status), '') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM exclusions x WHERE x.invocation_key = l.invocation_key AND x.stage_key = s.stage_key AND x.status = LOWER(TRIM(l.status)))
          WHEN 'converted' THEN l.is_converted IS TRUE AND l.converted_at > c.as_of
          WHEN 'won' THEN o.pending_win_count > 0
          WHEN 'event' THEN e.pending_event_count > 0 ELSE FALSE END AS pending,
        CASE s.stage_kind WHEN 'lead' THEN l.created_at WHEN 'qualified' THEN l.qualified_at
          WHEN 'converted' THEN l.converted_at WHEN 'won' THEN o.first_won_at
          WHEN 'event' THEN e.first_event.occurred_at END AS entered_at
 FROM leads l JOIN stages s USING (invocation_key) JOIN invocation_input c USING (invocation_key)
 LEFT JOIN opportunity_truth o ON o.invocation_key = l.invocation_key
  AND o.lead_source_system = l.source_system AND o.lead_source_scope = l.source_scope AND o.lead_key = l.lead_key
 LEFT JOIN event_truth e ON e.invocation_key = l.invocation_key AND e.lead_source_system = l.source_system
  AND e.lead_source_scope = l.source_scope AND e.lead_key = l.lead_key AND e.stage_key = s.stage_key
), valued AS (
 SELECT *,
   CASE WHEN stage_kind != 'won' OR NOT achieved OR achieved IS NULL OR NOT opportunities_complete THEN 'unknown'
     WHEN mixed_value_count > 0 OR known_currency_count > 1 THEN 'mixed_currency'
     WHEN unknown_value_count > 0 THEN 'unknown' ELSE 'known' END AS aggregate_value_status
 FROM truth
)
SELECT invocation_key, source_system, source_scope, lead_key, stage_key, stage_order, stage_kind,
       achieved, created_at AS cohort_at, IF(achieved, entered_at, NULL) AS stage_entered_at,
       DATE(created_at, report_timezone) AS cohort_date,
       IF(achieved, DATE(entered_at, report_timezone), NULL) AS activity_date,
       is_attribution_primary,
       IF(aggregate_value_status = 'known', known_winning_value, NULL) AS value,
       IF(stage_kind = 'won' AND achieved AND opportunities_complete AND aggregate_value_status != 'mixed_currency'
          AND currency_count = 1 AND missing_currency_count = 0, winning_currency, NULL) AS currency,
       aggregate_value_status AS value_status,
       CASE WHEN NOT achieved OR achieved IS NULL THEN ARRAY<STRUCT<source_system STRING, source_scope STRING, record_kind STRING, record_key STRING>>[]
         WHEN stage_kind = 'won' THEN winning_keys
         WHEN stage_kind = 'event' THEN [STRUCT(first_event.source_system AS source_system,
              first_event.source_scope AS source_scope, 'event' AS record_kind, first_event.event_key AS record_key)]
         ELSE [STRUCT(source_system, source_scope, 'lead' AS record_kind, lead_key AS record_key)] END AS evidence_keys,
       CASE WHEN achieved IS NULL THEN 'unknown'
         WHEN NOT achieved AND pending THEN 'pending_future_evidence'
         WHEN NOT achieved THEN 'not_achieved'
         WHEN entered_at IS NULL THEN 'achieved_undated' ELSE 'achieved' END AS stage_truth_status,
       STRUCT(channel, taxonomy_version, network_id, campaign_key, ad_source_system, ad_source_scope, ad_key) AS attribution
FROM valued;

CREATE TEMP TABLE stage_diagnostics AS
SELECT c.invocation_key,
 (SELECT COUNT(*) FROM leads_snapshot l WHERE l.invocation_key = c.invocation_key AND l.created_at > c.as_of) AS future_leads_excluded,
 (SELECT COUNT(*) FROM events e WHERE e.invocation_key = c.invocation_key AND e.occurred_at > c.as_of) AS future_events_excluded,
 (SELECT COUNT(*) FROM leads_snapshot l WHERE l.invocation_key = c.invocation_key AND l.qualified_at > c.as_of) AS future_qualified_timestamps,
 (SELECT COUNT(*) FROM leads_snapshot l WHERE l.invocation_key = c.invocation_key AND l.is_converted IS TRUE AND l.converted_at > c.as_of) AS future_converted_timestamps,
 (SELECT COUNT(*) FROM opportunities o WHERE o.invocation_key = c.invocation_key AND o.is_won IS TRUE AND o.won_at > c.as_of) AS future_wins_excluded,
 IF(c.opportunities_complete, 0, 1) AS incomplete_opportunity_source,
 (SELECT COUNT(*) FROM lead_input l WHERE l.invocation_key = c.invocation_key) - (SELECT COUNT(*) FROM leads_snapshot l WHERE l.invocation_key = c.invocation_key) AS duplicate_leads_collapsed,
 (SELECT COUNT(*) FROM stage_input s WHERE s.invocation_key = c.invocation_key) - (SELECT COUNT(*) FROM stages s WHERE s.invocation_key = c.invocation_key) AS duplicate_stages_collapsed,
 (SELECT COUNT(*) FROM opportunity_input o WHERE o.invocation_key = c.invocation_key) - (SELECT COUNT(*) FROM opportunities o WHERE o.invocation_key = c.invocation_key) AS duplicate_opportunities_collapsed,
 (SELECT COUNT(*) FROM event_input e WHERE e.invocation_key = c.invocation_key) - (SELECT COUNT(*) FROM events e WHERE e.invocation_key = c.invocation_key) AS duplicate_events_collapsed
FROM invocation_input c;

WITH ledger_payload AS (
 SELECT invocation_key,
        ARRAY_AGG((SELECT AS STRUCT l.* EXCEPT(invocation_key)) ORDER BY lead_key, stage_order) AS ledger
 FROM stage_ledger l GROUP BY invocation_key
)
SELECT d.invocation_key,
 TO_JSON_STRING(STRUCT(IFNULL(l.ledger, []) AS ledger,
                      (SELECT AS STRUCT d.* EXCEPT(invocation_key)) AS diagnostics)) AS result_json
FROM stage_diagnostics d LEFT JOIN ledger_payload l USING (invocation_key)
ORDER BY d.invocation_key;

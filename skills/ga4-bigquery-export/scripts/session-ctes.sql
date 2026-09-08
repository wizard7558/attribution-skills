-- Generated shared session reduction: edit scripts/session-ctes.sql, then regenerate.
WITH base AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS event_date,
    user_pseudo_id,
    param_int(event_params, 'ga_session_id') AS ga_session_id,
    param_int(event_params, 'ga_session_number') AS ga_session_number,
    event_name, event_timestamp,
    param_string(event_params, 'page_location') AS page_location,
    param_string(event_params, 'page_referrer') AS page_referrer,
    param_string(event_params, 'session_engaged') AS session_engaged,
    param_int(event_params, 'engagement_time_msec') AS engagement_time_msec,
    collected_traffic_source.gclid AS gclid,
    collected_traffic_source.dclid AS dclid,
    collected_traffic_source.srsltid AS srsltid,
    -- Choose one evidence struct; never combine fields from different campaigns.
    IF(COALESCE(session_traffic_source_last_click.cross_channel_campaign.source,
                session_traffic_source_last_click.cross_channel_campaign.medium,
                session_traffic_source_last_click.cross_channel_campaign.campaign_name,
                session_traffic_source_last_click.cross_channel_campaign.default_channel_group) IS NOT NULL,
      STRUCT(session_traffic_source_last_click.cross_channel_campaign.source AS source,
             session_traffic_source_last_click.cross_channel_campaign.medium AS medium,
             session_traffic_source_last_click.cross_channel_campaign.campaign_name AS campaign,
             session_traffic_source_last_click.cross_channel_campaign.default_channel_group AS native_channel),
      STRUCT(session_traffic_source_last_click.manual_campaign.source AS source,
             session_traffic_source_last_click.manual_campaign.medium AS medium,
             session_traffic_source_last_click.manual_campaign.campaign_name AS campaign,
             CAST(NULL AS STRING) AS native_channel)) AS source_evidence,
    ecommerce.transaction_id AS transaction_id,
    ecommerce.purchase_revenue_in_usd AS purchase_revenue_in_usd
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
),
keyed AS (
  SELECT CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING)) AS session_key,
    base.*,
    -- The JSON tie-break makes repeated timestamps deterministic across both templates.
    TO_JSON_STRING(base) AS evidence_order
  FROM base
  WHERE ga_session_id IS NOT NULL
),
reduced AS (
  SELECT
    session_key, MIN(user_pseudo_id) AS user_pseudo_id, MIN(ga_session_id) AS ga_session_id,
    ARRAY_AGG(event_date ORDER BY event_timestamp, evidence_order LIMIT 1)[OFFSET(0)] AS event_date,
    MAX(ga_session_number) AS ga_session_number,
    COALESCE(MAX(ga_session_number) = 1, FALSE) AS is_new_user,
    TIMESTAMP_MICROS(MIN(event_timestamp)) AS session_start_ts,
    TIMESTAMP_MICROS(MAX(event_timestamp)) AS session_end_ts,
    COUNTIF(event_name = 'page_view') AS pageviews, COUNT(*) AS events,
    (COALESCE(LOGICAL_OR(session_engaged = '1'), FALSE)
      OR COALESCE(SUM(engagement_time_msec), 0) >= 10000
      OR COUNTIF(event_name = 'page_view') >= 2
      OR COUNTIF(event_name IN UNNEST(key_event_names)) > 0) AS engaged,
    COALESCE(SUM(engagement_time_msec), 0) / 1000 AS engagement_time_sec,
    COUNTIF(event_name IN UNNEST(key_event_names)) AS key_events,
    COUNTIF(event_name = 'purchase' AND NULLIF(transaction_id, '') IS NULL) AS purchase_events_without_transaction_id,
    -- First event with a page URL, otherwise the first observed event. No late-click scan.
    ARRAY_AGG(STRUCT(page_location, page_referrer, gclid, dclid, srsltid)
      ORDER BY IF(page_location IS NULL, 1, 0), event_timestamp, evidence_order LIMIT 1)[OFFSET(0)] AS landing,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp DESC, evidence_order DESC LIMIT 1)[SAFE_OFFSET(0)] AS exit_page_location,
    ARRAY_AGG(IF(COALESCE(source_evidence.source, source_evidence.medium,
                         source_evidence.campaign, source_evidence.native_channel) IS NULL,
                 NULL, source_evidence) IGNORE NULLS
      ORDER BY event_timestamp, evidence_order LIMIT 1)[SAFE_OFFSET(0)] AS attribution
  FROM keyed
  GROUP BY session_key
),
landing_ids AS (
  SELECT reduced.*, extract_landing_click_ids(landing.page_location) AS url_click_ids
  FROM reduced
),
session_inputs AS (
  SELECT landing_ids.*,
    STRUCT(
      COALESCE(NULLIF(landing.gclid, ''), url_click_ids.gclid) AS gclid,
      COALESCE(NULLIF(landing.dclid, ''), url_click_ids.dclid) AS dclid,
      url_click_ids.gbraid AS gbraid,
      url_click_ids.wbraid AS wbraid,
      url_click_ids.msclkid AS msclkid,
      url_click_ids.fbclid AS fbclid,
      url_click_ids.ttclid AS ttclid,
      url_click_ids.rdt_cid AS rdt_cid,
      url_click_ids.li_fat_id AS li_fat_id,
      url_click_ids.twclid AS twclid,
      url_click_ids.epik AS epik,
      url_click_ids.sccid AS sccid,
      COALESCE(NULLIF(landing.srsltid, ''), url_click_ids.srsltid) AS srsltid
    ) AS click_ids
  FROM landing_ids
),
classified AS (
  SELECT
    session_key, user_pseudo_id, ga_session_id, ga_session_number, is_new_user,
    event_date, session_start_ts, session_end_ts, pageviews, events, engaged,
    engagement_time_sec, key_events, purchase_events_without_transaction_id,
    landing.page_location AS landing_page_location,
    REGEXP_EXTRACT(landing.page_location, r'https?://[^/]+(/[^?#]*)') AS landing_page_path,
    landing.page_referrer AS first_referrer,
    REGEXP_EXTRACT(exit_page_location, r'https?://[^/]+(/[^?#]*)') AS exit_page_path,
    attribution.source AS session_source, attribution.medium AS session_medium,
    attribution.campaign AS session_campaign, attribution.native_channel AS default_channel_group,
    click_ids,
    url_click_ids.gclid AS landing_gclid,
    url_click_ids.fbclid AS landing_fbclid,
    url_click_ids.ttclid AS landing_ttclid,
    'ga4' AS source_system, 'PROJECT.analytics_PROPERTY_ID' AS source_scope,
    user_pseudo_id AS visitor_key, 'session_last_click' AS attribution_basis,
    -- event_date is property-local; set the actual IANA timezone here if supplied.
    CAST(NULL AS STRING) AS reporting_timezone,
    'GA4 property event_date; first observed event in scan window' AS date_basis,
    '{{TAXONOMY_VERSION}}' AS taxonomy_version,
    classify_channel(TO_JSON_STRING(STRUCT(attribution.native_channel AS native_channel,
      attribution.source AS utm_source, attribution.medium AS utm_medium,
      attribution.campaign AS utm_campaign, landing.page_referrer AS referrer,
      landing.page_location AS landing_url, click_ids))) AS channel
  FROM session_inputs
)

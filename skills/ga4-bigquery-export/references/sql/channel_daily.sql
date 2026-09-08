-- Returns: date x default_channel_group x channel grain with sessions,
-- engaged_sessions, new_users, key_events (parameterized event list),
-- purchases, and purchase_revenue_usd.
-- default_channel_group is GA4's own label
-- (session_traffic_source_last_click.cross_channel_campaign.default_channel_group,
-- COALESCE'd to 'Unassigned'). channel is derived with the rule table in
-- references/channel_rules.md. Consumers re-aggregate to whichever grouping
-- they need; when the two columns disagree for a given row, that disagreement
-- is itself the audit signal for where the rule table over- or
-- under-classifies relative to GA4's own grouping. Edit the key_event_names
-- list to match the events agreed with the user.
-- Scan scale: heaviest query in this skill directory. One pass over
-- event_params, collected_traffic_source, session_traffic_source_last_click,
-- and ecommerce for every event in the window. Dry-run before running over
-- more than a week.

CREATE TEMP FUNCTION param_string(params ANY TYPE, target_key STRING) AS ((
  SELECT value.string_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));
CREATE TEMP FUNCTION param_int(params ANY TYPE, target_key STRING) AS ((
  SELECT value.int_value FROM UNNEST(params) WHERE key = target_key LIMIT 1
));

WITH events AS (
  SELECT
    event_date,
    user_pseudo_id,
    param_int(event_params, 'ga_session_id') AS ga_session_id,
    param_int(event_params, 'ga_session_number') AS ga_session_number,
    event_name,
    param_string(event_params, 'session_engaged') AS session_engaged,
    param_int(event_params, 'engagement_time_msec') AS engagement_time_msec,
    param_string(event_params, 'page_location') AS page_location,
    event_timestamp,
    collected_traffic_source.gclid AS gclid,
    collected_traffic_source.dclid AS dclid,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.source,
      session_traffic_source_last_click.manual_campaign.source
    ) AS stls_source,
    COALESCE(
      session_traffic_source_last_click.cross_channel_campaign.medium,
      session_traffic_source_last_click.manual_campaign.medium
    ) AS stls_medium,
    session_traffic_source_last_click.cross_channel_campaign.default_channel_group AS stls_channel_group,
    ecommerce.transaction_id AS transaction_id,
    ecommerce.purchase_revenue_in_usd AS purchase_revenue_in_usd
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND user_pseudo_id IS NOT NULL
),
keyed AS (
  SELECT
    CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING)) AS session_key,
    *
  FROM events
  WHERE ga_session_id IS NOT NULL
),
sessions AS (
  SELECT
    session_key,
    MIN(event_date) AS event_date,
    MAX(ga_session_number) = 1 AS is_new_user,
    (LOGICAL_OR(session_engaged = '1') OR SUM(engagement_time_msec) >= 10000
      OR COUNTIF(event_name = 'page_view') >= 2) AS engaged,
    COALESCE(ANY_VALUE(stls_source), '(not set)') AS source,
    COALESCE(ANY_VALUE(stls_medium), '(not set)') AS medium,
    COALESCE(ANY_VALUE(stls_channel_group), 'Unassigned') AS default_channel_group,
    ANY_VALUE(gclid) AS gclid,
    ANY_VALUE(dclid) AS dclid,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS landing_page_location,
    LOGICAL_OR(REGEXP_CONTAINS(COALESCE(page_location, ''), r'[?&](gclid|gbraid|wbraid|msclkid)=')) AS has_paid_search_click_url,
    LOGICAL_OR(REGEXP_CONTAINS(COALESCE(page_location, ''), r'[?&]dclid=')) AS has_dclid_url,
    LOGICAL_OR(REGEXP_CONTAINS(COALESCE(page_location, ''), r'[?&](fbclid|ttclid|li_fat_id|rdt_cid|twclid|epik|sccid)=')) AS has_paid_social_click_url
  FROM keyed
  GROUP BY session_key
),
-- Channel rule table: see references/channel_rules.md. dclid (Display) checks
-- first, then other click IDs, then GA4's own paid-medium regex (split into
-- Paid Search / Paid Social / Paid Other by source), then organic/email/sms/
-- affiliate/referral/social medium-and-source checks, then Direct. Label
-- anything unmatched Unassigned (GA4's own term), never NULL. source is
-- normalized (LOWER, leading "www." stripped) before every list match so
-- hostname-vs-bare-name drift doesn't cause a missed match.
classified AS (
  SELECT
    *,
    CASE
      WHEN dclid IS NOT NULL
        OR has_dclid_url
        THEN 'Display'
      WHEN gclid IS NOT NULL
        OR has_paid_search_click_url
        THEN 'Paid Search'
      WHEN has_paid_social_click_url
        THEN 'Paid Social'
      -- GA4's own paid-medium test, not a short fixed list (see pitfall 16 -
      -- this is what catches Meta/Reddit/Pinterest's `paid-social` medium).
      WHEN REGEXP_CONTAINS(LOWER(medium), r'^(.*cp.*|ppc|retargeting|paid.*)$')
        THEN CASE
          WHEN REGEXP_REPLACE(LOWER(source), r'^www\.', '') IN (
              'google', 'google.com', 'bing', 'bing.com', 'yahoo', 'duckduckgo',
              'baidu', 'yandex', 'ecosia', 'ask', 'aol'
            )
            THEN 'Paid Search'
          WHEN REGEXP_REPLACE(LOWER(source), r'^www\.', '') IN (
              'facebook', 'facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com',
              'instagram', 'instagram.com', 'l.instagram.com', 'meta', 'ig',
              'tiktok', 'tiktok.com', 'linkedin', 'linkedin.com',
              'pinterest', 'pinterest.com', 'reddit', 'reddit.com', 'old.reddit.com',
              'twitter', 'twitter.com', 't.co', 'x', 'x.com', 'snapchat', 'snapchat.com'
            )
            THEN 'Paid Social'
          ELSE 'Paid Other'
        END
      WHEN LOWER(medium) = 'organic' THEN 'Organic Search'
      WHEN LOWER(medium) = 'email' THEN 'Email'
      WHEN LOWER(medium) = 'sms' THEN 'SMS'
      WHEN LOWER(medium) LIKE '%affiliate%'
        OR REGEXP_REPLACE(LOWER(source), r'^www\.', '') IN (
          'cj', 'rakuten', 'impact', 'shareasale', 'awin', 'partnerize'
        )
        THEN 'Affiliates'
      WHEN LOWER(medium) = 'referral' THEN 'Referral'
      WHEN REGEXP_REPLACE(LOWER(source), r'^www\.', '') IN (
          'facebook', 'facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com',
          'instagram', 'instagram.com', 'l.instagram.com', 'meta', 'ig',
          'tiktok', 'tiktok.com', 'linkedin', 'linkedin.com',
          'pinterest', 'pinterest.com', 'reddit', 'reddit.com', 'old.reddit.com',
          'twitter', 'twitter.com', 't.co', 'x', 'x.com', 'snapchat', 'snapchat.com'
        )
        THEN 'Organic Social'
      WHEN source = '(direct)' AND medium = '(none)'
        THEN 'Direct'
      ELSE 'Unassigned'
    END AS channel
  FROM sessions
),
-- Parameterized key-event list: replace with the events agreed with the user.
key_events AS (
  SELECT session_key, COUNT(*) AS n
  FROM keyed
  WHERE event_name IN ('purchase', 'generate_lead', 'sign_up')
  GROUP BY session_key
),
purchases AS (
  SELECT session_key, transaction_id, ANY_VALUE(purchase_revenue_in_usd) AS purchase_revenue_in_usd
  FROM keyed
  WHERE event_name = 'purchase' AND transaction_id IS NOT NULL
  GROUP BY session_key, transaction_id
)
SELECT
  c.event_date,
  c.default_channel_group,
  c.channel,
  COUNT(DISTINCT c.session_key) AS sessions,
  COUNTIF(c.engaged) AS engaged_sessions,
  COUNTIF(c.is_new_user) AS new_users,
  COALESCE(SUM(ke.n), 0) AS key_events,
  COUNT(DISTINCT p.transaction_id) AS purchases,
  COALESCE(SUM(p.purchase_revenue_in_usd), 0) AS purchase_revenue_usd
FROM classified c
LEFT JOIN key_events ke USING (session_key)
LEFT JOIN purchases p USING (session_key)
GROUP BY c.event_date, c.default_channel_group, c.channel
ORDER BY c.event_date, sessions DESC;

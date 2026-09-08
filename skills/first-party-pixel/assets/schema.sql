-- First-party pixel: collector schema.
--
-- Target: PostgreSQL 14+. Everything lives in the `pixel` schema so it can be
-- installed alongside an existing application database without name
-- collisions. Every statement is idempotent (safe to re-run against an
-- already-provisioned database): CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS,
-- CREATE OR REPLACE for functions and views.
--
-- Load order matters: tables before the functions and views that reference
-- them. Apply the whole file in one `psql -f schema.sql` run.

CREATE SCHEMA IF NOT EXISTS pixel;

-- ===========================================================================
-- sites: one row per tracked property
-- ===========================================================================
CREATE TABLE IF NOT EXISTS pixel.sites (
  site_key         text PRIMARY KEY,
  domain           text NOT NULL,
  -- Exact origins the pixel is allowed to post from (e.g. 'https://example.com').
  -- An empty array means "accept any origin" (see collector CORS handling),
  -- most useful during initial setup, before the allowlist is populated.
  allowed_origins  text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- visitors: one anonymous browser identity per (site, visitor_uid)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS pixel.visitors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key          text NOT NULL REFERENCES pixel.sites (site_key) ON DELETE CASCADE,
  visitor_uid       text NOT NULL,
  first_seen_at     timestamptz,
  last_seen_at      timestamptz,
  user_agent        text,
  -- Salted hash of the visitor's IP, kept indefinitely for fraud/rate-limit
  -- checks. The raw IP itself is never stored here, see last_ip below and
  -- pixel.purge_raw_ip() for how the raw IP on events/last_ip is retired.
  ip_hash           text,
  last_ip           inet,
  -- Platform first-party cookie values observed for this visitor (fbp/fbc/
  -- ttp/rdt_uuid and similar), merged forward across events.
  platform_cookies  jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_pixel_visitors_site_uid UNIQUE (site_key, visitor_uid)
);

CREATE INDEX IF NOT EXISTS idx_pixel_visitors_site ON pixel.visitors (site_key);

-- ===========================================================================
-- events: raw firehose, monthly RANGE-partitioned on occurred_at
-- ===========================================================================
-- Partitioning keeps inserts cheap at volume and turns retention into a
-- metadata operation (detach + drop a monthly partition) instead of a bulk
-- DELETE. The primary key must include the partition key.
CREATE TABLE IF NOT EXISTS pixel.events (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  site_key      text NOT NULL,
  visitor_id    uuid,
  event_type    text NOT NULL CHECK (event_type IN ('pageview', 'track', 'identify', 'form_submit', 'consent')),
  event_name    text,
  url           text,
  referrer      text,
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  occurred_at   timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_pixel_events_site_occurred ON pixel.events (site_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pixel_events_visitor_occurred ON pixel.events (visitor_id, occurred_at);

-- A DEFAULT partition is a safety net so an insert never fails for lack of a
-- matching range. pixel.ensure_month_partitions() keeps it empty in steady
-- state by always having the current/adjacent months pre-created.
CREATE TABLE IF NOT EXISTS pixel.events_default
  PARTITION OF pixel.events DEFAULT;

-- Idempotently creates monthly partitions covering the previous month, the
-- current month, and months_ahead months into the future (default 2). Call
-- this on a schedule (see references/implementation.md) so a partition
-- always exists for "now" and the near future.
CREATE OR REPLACE FUNCTION pixel.ensure_month_partitions(months_ahead int DEFAULT 2)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  i           int;
  month_start date;
  month_end   date;
  part_name   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'events_default' AND n.nspname = 'pixel'
  ) THEN
    EXECUTE 'CREATE TABLE pixel.events_default PARTITION OF pixel.events DEFAULT';
  END IF;

  FOR i IN -1..months_ahead LOOP
    month_start := (date_trunc('month', now()) + (i || ' months')::interval)::date;
    month_end   := (date_trunc('month', now()) + ((i + 1) || ' months')::interval)::date;
    part_name   := 'events_' || to_char(month_start, 'YYYYMM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = part_name AND n.nspname = 'pixel'
    ) THEN
      EXECUTE format(
        'CREATE TABLE pixel.%I PARTITION OF pixel.events FOR VALUES FROM (%L) TO (%L)',
        part_name, month_start, month_end
      );
    END IF;
  END LOOP;
END;
$$;

-- ===========================================================================
-- contacts: known (identified) people, keyed by hashed email/phone
-- ===========================================================================
-- Canonicalization happens before hashing, in the collector: email is
-- trimmed + lowercased; phone is reduced to E.164 digits with a leading '+'
-- when the source value carried one. email_hash/phone_hash are sha256 hex of
-- those canonical strings. A contact can be created from either identifier
-- alone; the unique constraints on hash columns allow NULL (a contact
-- created from phone only has a NULL email_hash, and vice versa).
CREATE TABLE IF NOT EXISTS pixel.contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key         text NOT NULL REFERENCES pixel.sites (site_key) ON DELETE CASCADE,
  email_canonical  text,
  email_hash       text,
  phone_e164       text,
  phone_hash       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pixel_contacts_site_email UNIQUE (site_key, email_hash),
  CONSTRAINT uq_pixel_contacts_site_phone UNIQUE (site_key, phone_hash)
);

-- ===========================================================================
-- identity_links: bipartite, additive visitor <-> contact graph
-- ===========================================================================
-- Rows are never deleted. A visitor can resolve to more than one contact
-- (shared devices, re-identification with a different email) and a contact
-- can be reached from more than one visitor (multiple devices); merging is
-- always additive, never destructive.
CREATE TABLE IF NOT EXISTS pixel.identity_links (
  visitor_id  uuid NOT NULL REFERENCES pixel.visitors (id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES pixel.contacts (id) ON DELETE CASCADE,
  confidence  numeric(3, 2) NOT NULL DEFAULT 1.0,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_pixel_identity_links_contact ON pixel.identity_links (contact_id);

-- ===========================================================================
-- touchpoints: channel-derived marketing touches
-- ===========================================================================
CREATE TABLE IF NOT EXISTS pixel.touchpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key      text NOT NULL REFERENCES pixel.sites (site_key) ON DELETE CASCADE,
  visitor_id    uuid NOT NULL REFERENCES pixel.visitors (id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES pixel.contacts (id),
  -- Provenance only; events is partitioned on (id, occurred_at) so a plain FK
  -- to events.id is not possible. Not enforced.
  event_id      uuid,
  channel       text NOT NULL,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  gclid         text,
  gbraid        text,
  wbraid        text,
  dclid         text,
  fbclid        text,
  ttclid        text,
  rdt_cid       text,
  li_fat_id     text,
  msclkid       text,
  twclid        text,
  epik          text,
  sccid         text,
  referrer      text,
  landing_url   text,
  occurred_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pixel_touchpoints_visitor_occurred ON pixel.touchpoints (visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pixel_touchpoints_contact ON pixel.touchpoints (contact_id) WHERE contact_id IS NOT NULL;

-- ===========================================================================
-- conversion_events: conversions attributable to a visitor/contact
-- ===========================================================================
CREATE TABLE IF NOT EXISTS pixel.conversion_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key    text NOT NULL REFERENCES pixel.sites (site_key) ON DELETE CASCADE,
  visitor_id  uuid NOT NULL REFERENCES pixel.visitors (id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES pixel.contacts (id),
  event_id    uuid,
  event_name  text NOT NULL,
  occurred_at timestamptz NOT NULL,
  value       numeric,
  currency    text,
  page_url    text
);

CREATE INDEX IF NOT EXISTS idx_pixel_conversion_events_visitor ON pixel.conversion_events (visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pixel_conversion_events_site_occurred ON pixel.conversion_events (site_key, occurred_at);

-- ===========================================================================
-- consent_state: latest consent choice per visitor
-- ===========================================================================
CREATE TABLE IF NOT EXISTS pixel.consent_state (
  visitor_id  uuid PRIMARY KEY REFERENCES pixel.visitors (id) ON DELETE CASCADE,
  analytics   boolean,
  ads         boolean,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- purge_raw_ip: nightly retention job for raw IP addresses
-- ===========================================================================
-- Hashed IPs (visitors.ip_hash) are kept indefinitely for fraud/rate-limit
-- checks; the raw address is only needed briefly (geolocation, dedup at
-- ingest) and is NULLed out once it ages past retention_days.
CREATE OR REPLACE FUNCTION pixel.purge_raw_ip(retention_days int DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pixel.events
  SET ip = NULL
  WHERE ip IS NOT NULL
    AND occurred_at < now() - (retention_days || ' days')::interval;

  UPDATE pixel.visitors
  SET last_ip = NULL
  WHERE last_ip IS NOT NULL
    AND last_seen_at < now() - (retention_days || ' days')::interval;
END;
$$;

-- ===========================================================================
-- url_host: best-effort hostname extraction, lowercase, no leading 'www.'
-- ===========================================================================
-- Used by pixel.sessions to compare the landing page host against the
-- referrer host without requiring a URL-parsing extension. Returns NULL for
-- NULL/empty/unparseable input.
CREATE OR REPLACE FUNCTION pixel.url_host(url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(url, ''), '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''),
          '^www\.', ''
        ),
        '[/?#].*$', ''
      )
    ),
    ''
  )
$$;

-- ===========================================================================
-- sessions: 30-minute inactivity sessionization
-- ===========================================================================
-- Sessionizes pageview/track/form_submit events per visitor. A new session
-- starts on a visitor's first captured event, or after 30 minutes of
-- inactivity since their previous captured event.
CREATE OR REPLACE VIEW pixel.sessions AS
WITH base_events AS (
  SELECT
    e.id,
    e.site_key,
    e.visitor_id,
    e.event_type,
    e.url,
    e.referrer,
    e.occurred_at
  FROM pixel.events e
  WHERE e.event_type IN ('pageview', 'track', 'form_submit')
    AND e.visitor_id IS NOT NULL
),
ordered AS (
  SELECT
    b.*,
    LAG(b.occurred_at) OVER (PARTITION BY b.visitor_id ORDER BY b.occurred_at, b.id) AS prev_occurred_at
  FROM base_events b
),
flagged AS (
  SELECT
    o.*,
    CASE
      WHEN o.prev_occurred_at IS NULL THEN 1
      WHEN o.occurred_at - o.prev_occurred_at > interval '30 minutes' THEN 1
      ELSE 0
    END AS session_break
  FROM ordered o
),
numbered AS (
  SELECT
    f.*,
    SUM(f.session_break) OVER (
      PARTITION BY f.visitor_id ORDER BY f.occurred_at, f.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS session_number
  FROM flagged f
),
session_bounds AS (
  SELECT
    visitor_id,
    session_number,
    MIN(site_key) AS site_key,
    MIN(occurred_at) AS session_start_ts,
    MAX(occurred_at) AS session_end_ts,
    COUNT(*) FILTER (WHERE event_type = 'pageview') AS pageviews,
    COUNT(*) AS events
  FROM numbered
  GROUP BY visitor_id, session_number
),
landing AS (
  SELECT DISTINCT ON (n.visitor_id, n.session_number)
    n.visitor_id,
    n.session_number,
    n.url AS landing_page_location,
    n.referrer AS first_referrer
  FROM numbered n
  ORDER BY n.visitor_id, n.session_number, n.occurred_at, n.id
),
exit_page AS (
  SELECT DISTINCT ON (n.visitor_id, n.session_number)
    n.visitor_id,
    n.session_number,
    n.url AS exit_page_url
  FROM numbered n
  WHERE n.event_type = 'pageview'
  ORDER BY n.visitor_id, n.session_number, n.occurred_at DESC, n.id DESC
),
-- The first touchpoint recorded inside the session window, if any. Sessions
-- with no marketing signal at all (repeat direct visits) have no touchpoint
-- row, see the channel CASE expression below for the Direct/Unassigned
-- fallback that covers that case.
session_touchpoint AS (
  SELECT DISTINCT ON (sb.visitor_id, sb.session_number)
    sb.visitor_id,
    sb.session_number,
    t.channel,
    t.utm_source,
    t.utm_medium,
    t.utm_campaign,
    t.gclid,
    t.fbclid,
    t.ttclid
  FROM session_bounds sb
  JOIN pixel.touchpoints t
    ON t.visitor_id = sb.visitor_id
   AND t.occurred_at >= sb.session_start_ts
   AND t.occurred_at <= sb.session_end_ts
  ORDER BY sb.visitor_id, sb.session_number, t.occurred_at, t.id
),
conversions_in_session AS (
  SELECT
    sb.visitor_id,
    sb.session_number,
    COUNT(*) AS conversions
  FROM session_bounds sb
  JOIN pixel.conversion_events ce
    ON ce.visitor_id = sb.visitor_id
   AND ce.occurred_at >= sb.session_start_ts
   AND ce.occurred_at <= sb.session_end_ts
  GROUP BY sb.visitor_id, sb.session_number
)
SELECT
  sb.visitor_id::text || '.' || floor(extract(epoch FROM sb.session_start_ts))::text AS session_key,
  sb.visitor_id,
  sb.session_number,
  (sb.session_number = 1) AS is_new_visitor,
  sb.session_start_ts,
  sb.session_end_ts,
  sb.pageviews,
  sb.events,
  (
    extract(epoch FROM (sb.session_end_ts - sb.session_start_ts)) > 10
    OR sb.pageviews >= 2
    OR COALESCE(cv.conversions, 0) > 0
  ) AS engaged,
  extract(epoch FROM (sb.session_end_ts - sb.session_start_ts))::numeric AS engagement_time_sec,
  regexp_replace(coalesce(l.landing_page_location, ''), '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+', '') AS landing_page_path,
  l.landing_page_location,
  l.first_referrer,
  regexp_replace(coalesce(ep.exit_page_url, ''), '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+', '') AS exit_page_path,
  st.utm_source AS session_source,
  st.utm_medium AS session_medium,
  st.utm_campaign AS session_campaign,
  CASE
    WHEN st.channel IS NOT NULL THEN st.channel
    WHEN (l.first_referrer IS NULL OR l.first_referrer = ''
          OR pixel.url_host(l.first_referrer) = pixel.url_host(l.landing_page_location))
      THEN 'Direct'
    ELSE 'Unassigned'
  END AS channel,
  st.gclid AS landing_gclid,
  st.fbclid AS landing_fbclid,
  st.ttclid AS landing_ttclid
FROM session_bounds sb
LEFT JOIN landing l ON l.visitor_id = sb.visitor_id AND l.session_number = sb.session_number
LEFT JOIN exit_page ep ON ep.visitor_id = sb.visitor_id AND ep.session_number = sb.session_number
LEFT JOIN session_touchpoint st ON st.visitor_id = sb.visitor_id AND st.session_number = sb.session_number
LEFT JOIN conversions_in_session cv ON cv.visitor_id = sb.visitor_id AND cv.session_number = sb.session_number;

-- ===========================================================================
-- channel_daily: one row per (event_date, channel)
-- ===========================================================================
CREATE OR REPLACE VIEW pixel.channel_daily AS
SELECT
  (s.session_start_ts AT TIME ZONE 'UTC')::date AS event_date,
  s.channel,
  COUNT(*) AS sessions,
  COUNT(*) FILTER (WHERE s.engaged) AS engaged_sessions,
  COUNT(*) FILTER (WHERE s.is_new_visitor) AS new_visitors,
  COALESCE(SUM(conv.conversions), 0)::bigint AS conversions,
  COALESCE(SUM(conv.conversion_value), 0) AS conversion_value
FROM pixel.sessions s
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS conversions,
    SUM(COALESCE(ce.value, 0)) AS conversion_value
  FROM pixel.conversion_events ce
  WHERE ce.visitor_id = s.visitor_id
    AND ce.occurred_at >= s.session_start_ts
    AND ce.occurred_at <= s.session_end_ts
) conv ON true
GROUP BY 1, 2;

-- Native source observations for downstream identity-skill attribution dedupe.
-- Read-only PostgreSQL SELECT, usable standalone after assets/schema.sql.
-- Every row retains its real taxonomy version. Only export_status='eligible'
-- is accepted by dedupeTouches; route all other statuses for explicit review.
-- native_contact_id is collector evidence only, NEVER resolved subject ownership.
-- No sibling SQL, extensions, server UDFs, identity inference, or customer writes.
SELECT
  'first_party_pixel'::text AS source_system,
  t.site_key AS source_scope,
  t.id::text AS touch_key,
  t.visitor_id::text AS visitor_key,
  coalesce(t.occurred_at_iso, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS occurred_at,
  t.channel,
  t.taxonomy_version,
  t.utm_campaign,
  jsonb_build_object(
    'dclid', t.dclid, 'gclid', t.gclid, 'gbraid', t.gbraid, 'wbraid', t.wbraid,
    'msclkid', t.msclkid, 'fbclid', t.fbclid, 'ttclid', t.ttclid,
    'rdt_cid', t.rdt_cid, 'li_fat_id', t.li_fat_id, 'twclid', t.twclid,
    'epik', t.epik, 'sccid', t.sccid, 'srsltid', t.srsltid
  ) AS click_ids,
  t.contact_id::text AS native_contact_id,
  CASE
    WHEN t.taxonomy_version IS NULL THEN 'legacy_requires_reclassification'
    WHEN t.taxonomy_version <> '0.1.0' THEN 'unsupported_taxonomy_version'
    WHEN t.channel NOT IN (
      'Paid Search', 'Paid Social', 'Paid Other', 'Organic Search', 'Organic Social',
      'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other'
    ) THEN 'invalid_canonical_channel'
    ELSE 'eligible'
  END AS export_status
FROM pixel.touchpoints t
ORDER BY t.occurred_at, t.site_key, t.visitor_id, t.id;

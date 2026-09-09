-- Read-only immutable identify evidence; no inference from legacy identity links.
-- Graph consumers must explicitly filter capture_status='eligible' and supply
-- authorized bindings, as_of, and lookback. Hashes attest normalization v0.1.0.
-- Native microsecond order is presentation only; original nanoseconds survive.
SELECT
  'first_party_pixel'::text AS source_system,
  site_key AS source_scope,
  visitor_id::text AS visitor_key,
  event_id::text AS observation_key,
  occurred_at_iso AS occurred_at,
  source_event_type,
  email_hash,
  phone_hash,
  identity_input_format,
  identity_normalization_version,
  capture_status
FROM pixel.identity_observations o
ORDER BY o.occurred_at, o.site_key, o.visitor_id, o.event_id;

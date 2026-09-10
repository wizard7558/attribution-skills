-- Read-only current contact snapshot. No raw identity or historical as-of claim.
-- Per-kind attestation prevents unverified legacy hashes entering the graph.
-- capture_status means current contact export eligibility, not observation status.
SELECT
  'first_party_pixel'::text AS source_system,
  site_key AS source_scope,
  id::text AS contact_key,
  CASE WHEN email_hash_format='canonical_sha256_v1' THEN email_hash END AS email_hash,
  CASE WHEN phone_hash_format='canonical_sha256_v1' THEN phone_hash END AS phone_hash,
  email_hash_format,
  phone_hash_format,
  CASE WHEN email_hash IS NULL THEN 'missing' WHEN email_hash_format='canonical_sha256_v1' THEN 'attested' ELSE 'legacy_unverified' END AS email_hash_status,
  CASE WHEN phone_hash IS NULL THEN 'missing' WHEN phone_hash_format='canonical_sha256_v1' THEN 'attested' ELSE 'legacy_unverified' END AS phone_hash_status,
  CASE WHEN email_hash_format='canonical_sha256_v1' OR phone_hash_format='canonical_sha256_v1' THEN 'eligible' ELSE 'no_attested_identity' END AS capture_status,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS native_created_at
FROM pixel.contacts
ORDER BY site_key, id;

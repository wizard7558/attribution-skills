# Safe native contact resolution and hash provenance

The collector resolves only the current identify/form-submit event. It does not infer a
person from a visitor ID, IP, most recent link or current wall time. Every new pageview
and `track` conversion has native `contact_id = NULL`. A `form_submit` conversion can carry
only that event's unique/new contact result. Existing touch and conversion contact IDs
remain unchanged as historical provenance. No graph is invoked and no history is backfilled.

## Candidate union and concurrency

After [immutable observation capture](identity-capture-contract.md), valid canonical email
and phone hashes enter one transaction-scoped site lock:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('pixel.identity:' || $1, 0));
SELECT id, email_canonical, email_hash, phone_e164, phone_hash,
       email_hash_format, phone_hash_format
FROM pixel.contacts
WHERE site_key = $1 AND (email_hash = $2 OR phone_hash = $3)
ORDER BY id FOR UPDATE;
```

Parameters are the site and the already computed canonical hashes, with NULL for an invalid
or absent kind. Candidate IDs are deduplicated. Email and phone have equal priority:

- Zero candidates: insert one contact containing the supplied valid canonical values,
  hashes and corresponding `canonical_sha256_v1` provenance.
- One candidate: reuse it and apply only the permitted per-kind fills below.
- More than one: preserve ambiguity. Do not create, merge, fill missing identity values,
  assign native contact ownership, or insert a link. Matching supplied kinds may still
  receive provenance on each candidate; this preserves both candidates in later exports.

Only a new/unique result inserts an additive `identity_links` row. Missing or invalid
identities still produce a `no_valid_identity` observation but no contact or link.

All contact writers participating in this guarantee must acquire the same site lock before
reading or writing candidates. `FOR UPDATE` alone cannot lock a nonexistent candidate.
Concurrent collector requests for the same identifier serialize and see the committed
contact. Different sites never share candidates, even for the same hash. Advisory hash
collisions can serialize unrelated sites, but cannot merge them because queries remain
site scoped. A writer bypassing the lock can cause a uniqueness race: the request rolls
back, without automatic retry. A connection loss during COMMIT can leave the outcome
unknown; see the [transaction contract](transaction-contract.md).

## Per-kind immutable values and attestation

Canonicalization and SHA-256 use the shared normalization primitive version `0.1.0`, once
per supplied valid identity. Raw and hash fields are checked separately for each kind.
Never overwrite any non-NULL raw identity or hash:

| Existing fields on the unique candidate | Allowed current-event change |
| --- | --- |
| Hash NULL; raw NULL or exactly the supplied canonical value | Fill the hash, fill raw only if NULL, attest this kind. |
| Hash exactly matches supplied hash | Fill raw only if NULL; attest this kind even if an existing non-NULL raw value differs. |
| Hash NULL; non-NULL raw differs | Preserve both fields; no attestation for the supplied kind. |
| Non-NULL hash differs | Preserve raw, hash and provenance; no substitution. |

For an ambiguous union, only the matching-hash attestation is allowed; even NULL raw fields
stay NULL. A matching current digest re-proves its supplied canonical preimage without
asserting that other stored kinds were normalized correctly. No candidate-wide blanket
attestation occurs. An incompatible legacy raw value remains unchanged and is not emitted
in the export.

`email_hash_format` and `phone_hash_format` are nullable, without defaults or migration
backfills. Database CHECK constraints allow only NULL or `canonical_sha256_v1`; non-NULL
format requires a non-NULL exact lowercase 64-hex hash of the corresponding kind. Existing
unattested hashes, including legacy noncanonical spellings, remain unchanged. The format
attests the shared primitive version; hash bytes alone cannot verify the preimage or prove
who supplied it. Platform-specific CAPI hashes are not interchangeable with this format.

## Current contact export

[identity_contacts.sql](sql/identity_contacts.sql) is a read-only current snapshot ordered
by site and contact ID. It exports every contact, including those with no attested identity:

| Field | Meaning |
| --- | --- |
| `source_system` | Exactly `first_party_pixel`. |
| `source_scope`, `contact_key` | Site key and native contact UUID string. |
| `email_hash`, `phone_hash` | Stored hash only when that kind is attested; otherwise NULL. |
| `email_hash_format`, `phone_hash_format` | Stored per-kind provenance, including NULL. |
| `email_hash_status`, `phone_hash_status` | `missing` when stored hash is NULL; `attested` for current format; otherwise `legacy_unverified`. |
| `capture_status` | `eligible` if any kind is attested, else `no_attested_identity`. |
| `native_created_at` | Native contact creation time formatted as UTC with six fractional digits. |

Here `capture_status` means current contact export eligibility. It is distinct from an
immutable observation's capture status and says nothing about historical validity.
`native_created_at` is provenance, not the time a hash was supplied or attested. The current
snapshot cannot reconstruct historical contact state from creation time. No raw email,
phone, IP or free text is exported. Keep unknown rows and diagnostics for audit. A future
graph handoff must explicitly choose scopes, bindings and temporal policy; this export
does not automatically make those choices.

Ingestion adds identity links and never redirects them. Existing site/visitor/contact
retention cascades remain allowed. Observation payloads remain protected by the existing
UPDATE rejection trigger; no legacy observations are inferred from links or contacts.

## Verification

```sh
node skills/first-party-pixel/scripts/test-identity-resolution.mjs
node skills/first-party-pixel/scripts/test-touch-integration.mjs
node skills/first-party-pixel/scripts/test-transactions.mjs
node skills/first-party-pixel/scripts/identity-parity.mjs --repository
```

The resolution command creates and cleans up a disposable local PostgreSQL cluster through
`roundtrip.sh`, sends actual HTTP requests to the Node adapter, and runs guarded native
checks. The suite records complete before/after snapshots of all eight request tables,
full SQL results, synthetic requests, runtime versions and source hashes in
`~/Downloads/first-party-pixel-identity-resolution-native-evidence-*.json`.

Native checks cover unique/reversed email and phone matching; safe fills; incompatible raw
and hash preservation; current and mixed-legacy ambiguity; per-kind attestation without
ambiguity erasure; missing identity observations; shared visitors with multiple additive
links; unassigned later touches and track conversions; own-event form assignment; retained
historical IDs; same-identifier concurrent requests observed waiting on the site lock;
different sites; schema constraints and repeated migration. Eleven complete contact export
goldens use independent expected hashes/statuses, with native-generated IDs and creation
times explicitly recorded as provenance. Three executed native old-policy mutants reinstate
email-first selection, latest-link assignment and back-fill; each fails the safe invariants
and is rolled back without altering the running collector. The transaction suite covers
unique and ambiguous provenance rollback, alongside event, observation, link, touch,
conversion and consent writes.

Verification is local PostgreSQL/pg and the Node HTTP adapter. Other adapter runtimes have
shared source/helper coverage but are not claimed as hosted native executions. Previous
capture, dedupe and transaction reports remain immutable evidence of their executed source
versions; revised reports carry fresh source hashes. No historical model evaluation is
claimed to have assessed this resolver revision.

Recorded 2026-09-09 verification: 92 native resolution assertions, 11 full contact export
goldens and three executed old-policy mutants passed in each of two disposable clusters.
The final companion suites passed 18 HTTP checks, 62 native transaction assertions across
eight injections, 101 native capture assertions and 19 touch journeys/41 pageviews/555
assertions. Deterministic transaction/capture, both identity parity modes, unchanged graph
and primitive suites, artifact checks and suite-contract checks passed. Both owned collector
processes are absent, PostgreSQL directories removed and owned ports closed. Review hashes,
raw-report paths and the schema comment-only post-execution change are recorded in
`~/Downloads/first-party-pixel-identity-resolution-review-evidence-20260909.json`.

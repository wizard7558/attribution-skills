# Immutable identity capture and exact source timestamps

This contract defines immutable source evidence and exact timestamp storage. Current contact
candidate selection is defined separately in the [resolution contract](identity-resolution-contract.md):
a site-scoped email/phone union preserves ambiguity and never backfills native ownership.
A native contact ID is not authoritative subject ownership. No graph is invoked by the collector or export.

## Collector timestamp policy

`parseCollectorTimestamp(value)` in `assets/collector/timestamp.mjs` returns
`{ original, postgres }`, or throws a value-free TypeError. The input is a string with a
four-digit year **0001–9999**, real proleptic Gregorian calendar date, uppercase `T`, hours
00–23, minutes/seconds 00–59, optional **1–9 fractional digits**, and uppercase `Z` or a
numeric offset through **±14:00**. A bare decimal point, naive time, whitespace, leap second,
24:00, nonexistent date, or UTC instant outside years 0001–9999 is invalid. The fraction can
be absent. Validation returns HTTP 400 before opening a database transaction.

This is an explicit collector/PostgreSQL storage policy. The standalone identity graph
supports a broader year range, including year 0000; its contract has not changed.

`original` preserves every input byte, including fraction length and offset spelling.
`postgres` is UTC with exactly six fractional digits. Parse the whole second independently
of the fraction, then floor the fraction to microseconds. Never pass the original fractional
value through Date milliseconds or let PostgreSQL round a nine-digit input. Examples:

| Original | PostgreSQL projection |
| --- | --- |
| `2026-09-03T14:00:00.123456789+02:00` | `2026-09-03T12:00:00.123456Z` |
| `1969-12-31T23:59:59.999999999Z` | `1969-12-31T23:59:59.999999Z` |
| `2026-09-03T12:00:00Z` | `2026-09-03T12:00:00.000000Z` |

Every new event, touchpoint and conversion stores that same original in nullable
`occurred_at_iso TEXT` and the microsecond projection in its existing native `occurred_at`.
Schema upgrades leave old original-text columns NULL; they do not invent lost precision.
The touch export uses original text when present, otherwise the native UTC timestamp with
six fractional digits. Native reporting still uses PostgreSQL microseconds. Exact original
nanoseconds remain available to a later authorized graph consumer for inclusive time cutoffs.

## Immutable source observations

Every accepted `identify` or `form_submit` inserts exactly one row in
`pixel.identity_observations`, even when identity is missing or invalid:

| Column | Contract |
| --- | --- |
| `event_id` | Real generated event UUID, primary key; one row per source event. |
| `site_key`, `visitor_id` | Real site and visitor foreign keys, with retention delete cascades. |
| `source_event_type` | `identify` or `form_submit`. |
| `occurred_at`, `occurred_at_iso` | Native microsecond projection and required exact original text. |
| `email_hash`, `phone_hash` | Nullable exact lowercase 64-hex SHA-256 of shared canonical identity. |
| `identity_input_format` | Exactly `canonical_sha256_v1`. |
| `identity_normalization_version` | Exactly `0.1.0`. |
| `capture_status` | `eligible` iff at least one hash is present; otherwise `no_valid_identity`. |
| `recorded_at` | Database recording time, not a replacement for source event time. |

Canonicalize using the existing bundled shared normalization primitive, hash each valid
value once, and reuse those same computed hashes for capture and current contact handling.
The table contains no raw email, phone, IP, name, free text or native contact ownership claim.
The format attests the normalization version; a hash alone cannot verify its preimage.
Platform-specific CAPI hashes are not substitutes for this canonical format.

Database CHECK constraints enforce the event-type, format/version, hash and capture-status
contracts. An UPDATE trigger rejects all observation updates, including no-op updates.
The application inserts observations only; it never rewrites an earlier event when a
visitor identifies again. Tenant/visitor deletion cascades are intentionally allowed for
retention, and no DELETE trigger is installed. The existing partitioned raw events table
has no site/visitor foreign key; its partition/event retention policy remains separate, so
deleting a site does not claim to purge those historical raw events. Application/database administrators remain
responsible for authorization and retention. The partitioned event table has a composite
key, so `event_id` is application-linked provenance rather than a standalone event foreign key.

The insert participates in the same request transaction as all other collector writes.
Failure after capture rolls it back. An ambiguous candidate union is retained without a
contact assignment or link; the source observation still commits. A database error, including
an outside-writer constraint race, rolls back the request and observation. Repeated transport payloads still generate separate event UUIDs; event-key
uniqueness does not establish browser/API business-event deduplication.

## Read-only export boundary

[identity_observations.sql](sql/identity_observations.sql) exports actual rows with exact
`source_system=first_party_pixel`, site `source_scope`, visitor `visitor_key`, event
`observation_key`, original `occurred_at`, `source_event_type`, both hashes, format, version and
capture status. The query never derives historical observations from `identity_links.created_at`.
Missing historical identify evidence remains unknown, even when an old contact link exists.

The SQL presentation order is native microsecond time, site, visitor and event key. Two
original nanosecond instants can share that native time; presentation order is not an exact
nanosecond chronology. A graph consumer must explicitly select `capture_status='eligible'`,
choose the canonical hash format, authorize source/scope bindings, and supply `as_of` and
lookback. It must use original time for exact comparisons. Ineligible rows remain available
for audit. This step does not call or automatically bind a graph.

## Verification

```sh
node skills/first-party-pixel/scripts/test-identity-capture.mjs
node skills/first-party-pixel/scripts/test-transactions.mjs
node skills/first-party-pixel/scripts/identity-parity.mjs --repository
env -u DATABASE_URL bash skills/first-party-pixel/scripts/roundtrip.sh
node skills/first-party-pixel/scripts/test-touch-integration.mjs
```

The owned disposable roundtrip runs native capture and transaction tests in guarded connected
mode. Literal timestamp and complete export goldens cover microseconds, nanoseconds, equivalent
offsets, pre-epoch times, inclusive cutoffs and UTC bounds. Invalid timestamps leave all eight
tables unchanged. Real database checks cover missing/invalid identity, multiple observations,
raw identity absence, literal hash parity, rejected UPDATEs and duplicate event keys, database
hash/status constraints, allowed tenant retention, and repeated schema application retaining
legacy NULLs and all prior observations. Transaction snapshots cover observation writes and current resolver provenance writes,
including ambiguous candidate attestation; see the current transaction contract.

Native evidence is local PostgreSQL/pg with the real core and Node HTTP adapter. No hosted
Vercel, Cloudflare or Supabase/Deno execution is claimed. All adapters retain relative imports
and must include `timestamp.mjs` beside the shared core. Timestamped full query/request/row/hash
reports are saved to `~/Downloads/first-party-pixel-identity-capture-native-evidence-*.json`, with
separate transaction evidence preserving prior executions.

Historical capture-revision verification on 2026-09-09, before the safe resolver change: 19 literal timestamp goldens and 29 rejected
pre-transaction timestamps passed 80 deterministic assertions. Native capture passed 101
assertions across 10 source fixture events plus a retention request and eight complete
observation export goldens. The transaction suite passed all seven post-write injections
and 57 native assertions; its 60 deterministic assertions also passed. The existing HTTP
suite retained all 18 checks, and touch integration passed 16 journey goldens, 35 pageviews
and 469 assertions. Repository identity parity retained all 191 assertions. Owned test
servers and clusters were cleaned up. An earlier new retention test incorrectly expected
raw partitioned events to cascade; its failed evidence is retained and the final test now
asserts the existing separate raw-event retention policy explicitly.

The current contact snapshot export has its own `capture_status` (`eligible` or
`no_attested_identity`), describing present export eligibility only. It does not replace the
immutable observation status or establish historical validity; see [identity_contacts.sql](sql/identity_contacts.sql).

# Clickstream identity and touch primitives

This contract defines the local primitives used by the clickstream identity stitching skill. It is deliberately independent of ad platform matching rules.

## Identity values

`canonicalizeEmail(value)` trims and lowercases a string, then requires one `@`, a nonempty local part, a nonempty dotted domain, and no whitespace. It does not remove Gmail dots or plus tags. `canonicalizePhone(value)` requires an explicit leading `+` country code, removes common formatting and a trailing extension, and accepts 8–15 digits with a nonzero first digit. It never guesses a country code from a national number. Invalid values return `null`.

`hashIdentity(kind, value)` accepts only `email` and `phone` and returns lowercase hexadecimal SHA-256 of the canonical value. It is the same hash for the same valid identifier across scopes; scope fields belong in separate columns and are never concatenated into the email or phone hash. These digests are pseudonymous identifiers, not anonymous data. They must not be treated as outbound Google, Meta, LinkedIn, or other platform-normalized values.

The graph can consume these already-computed digests with explicit
`identity_input_format: 'canonical_sha256_v1'`; its default remains raw email/phone input.
See the [graph format contract](graph-contract.md#explicit-identity-input-format) for strict
representation separation, syntax validation, and the caller's normalization-version attestation.
The graph does not rehash canonical digests or verify their preimages.

## Portable authority and generated collector bundle

`scripts/identity-normalization.mjs` is the dependency-free ESM authority for email/phone canonicalization, `CLICK_ID_NAMES`, and `touchSignature(touch)`. Its explicit `IDENTITY_NORMALIZATION_VERSION` is `0.1.0`, independent of channel taxonomy versioning. It runs with language intrinsics alone: no Node, Web Crypto, browser, or filesystem dependency. `identity-primitives.mjs` reexports its existing canonicalizer/click-name API, uses `touchSignature` internally without changing dedupe decisions, and retains Node crypto only for `hashIdentity`.

`touchSignature` returns the existing JSON signature `[channel, normalized campaign, [[click name, opaque value], ...]]`. It does not validate a complete touch; `dedupeTouches` performs that validation. Campaign/click normalization and the five-decoding-pass boundary are unchanged. Unknown click names are ignored and supported names have a fixed canonical ordering, independent of object insertion order.

The repository generator copies the authority byte-for-byte into `first-party-pixel/assets/collector/identity-normalization.mjs`:

```sh
node scripts/build-identity-artifacts.mjs --repository
node scripts/build-identity-artifacts.mjs --repository --check
node scripts/test-identity-artifacts.mjs
```

Run these from this skill directory. `--check` reports missing/stale copies and exits nonzero without writing any source or destination. Only explicit generation writes the collector bundle. In a standalone installed skill, omit `--repository`; both default and `--check` validate that the local authority is readable and require no sibling skills because there are no local generated copies. Repository mode explicitly requires the sibling pixel skill. Do not hand-edit its generated bundle.

The collector uses Web Crypto over the same canonical UTF-8 string; the primitive hash uses Node crypto. `node ../first-party-pixel/scripts/identity-parity.mjs --repository` checks actual collector helper outputs, emitted database hash parameters, and byte parity with this authority. A standalone pixel copy can run its own `node scripts/identity-parity.mjs` without sibling imports.

## Legacy collector compatibility boundary

Portable normalization `0.1.0` preserves this identity skill's existing fixtures. It tightens the earlier pixel collector's permissive rules: malformed email and national phone numbers now produce no new identity hash, and supported phone extensions are excluded before hashing. Gmail dots and plus tags remain significant. This is an ingestion semantic change, not a database migration.

No existing hash, contact, identity link, touchpoint, or database record is rewritten by the extraction or artifact generator. Existing tables do not automatically store the canonicalizer version; record the deployment cutover and version in operational provenance. A newly valid canonical hash can differ from an old extension-bearing or nationally formatted value; do not infer that differing hashes are the same person or silently replace legacy values.

Any historical correction requires a separate controlled reprocessing of verified original input, retained with the appropriate consent/access basis. Preserve the original record and normalization provenance, compute the new canonical candidate separately, compare scoped results, and review conflicts before an explicit migration or additional evidence record. Do not reverse or guess an identifier from a hash, invent a country code, treat a legacy normalized value as verified original input, or merge contacts merely to hide a changed lookup result. Collector touch dedupe, persistence, and shared-device ownership semantics are separate integration work and are not changed by this normalization extraction.

## Touch contract

Each touch carries required `source_system`, `source_scope`, `visitor_key`, `touch_key`, `occurred_at`, `channel`, and `taxonomy_version: "0.1.0"`. Channels are the canonical eleven labels: Paid Search, Paid Social, Paid Other, Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate, and Other. `occurred_at` is a real proleptic Gregorian ISO timestamp with a four-digit year 0000–9999, uppercase `T`, seconds, an absent or 1–9 digit fraction, and uppercase `Z` or an explicit numeric offset through ±14:00. Year 0000 is a leap year; century years such as 0100 are not. The parser does not use Date.UTC’s year-0–99 remapping. `utm_campaign` is optional text. `click_ids` may contain the thirteen recognized IDs (`dclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`, `ttclid`, `rdt_cid`, `li_fat_id`, `twclid`, `epik`, `sccid`, `srsltid`). Raw fields are retained on accepted clones.

The full dedupe key is `(source_system, source_scope, visitor_key, touch_key)`. An identical repeated key is idempotently suppressed. A repeated key with conflicting data is rejected. Touches are evaluated by exact integer epoch nanoseconds and returned in deterministic chronological/full-key order. The existing localeCompare order of the complete JSON-qualified key breaks only exact-instant ties; original timestamp strings and all raw fields remain unchanged. A new touch even one nanosecond older than the latest existing touch in its source scope is rejected because incremental state cannot safely repair late arrivals; callers must run a full replay. Such an insertion can change which touch was accepted before later observations, so appending to accepted history cannot safely reconstruct the suppression state. An identical already-known key may still replay idempotently.

For each source-scoped visitor, only the immediately preceding accepted touch can suppress a consecutive repeat. The repeat signature is `(channel, decode campaign up to five passes, replace + with spaces, trim/lowercase, click-ID names in fixed canonical `CLICK_ID_NAMES` order and opaque values)`. Click-ID values are decoded up to five passes, then trimmed; they retain case and literal plus signs, and null/undefined placeholders are discarded. A matching signature is suppressed only when the exact elapsed nanoseconds are strictly less than 1,800,000,000,000 (30 minutes); exactly 30 minutes is accepted. For example, 00:00:00.000000001 to 00:30:00.000000000 spans 30 minutes minus one nanosecond and is suppressed. Millisecond rounding is never used for sorting, the window, or incremental late-arrival checks. A suppressed event does not extend the window. An intervening channel, campaign, or click-ID produces a new accepted touch, so an A–B–A journey is retained. Direct is accepted only when it is the first accepted touch for a source-scoped visitor; any accepted prior touch, including seeded history, suppresses a later Direct.

No identity is inferred from IP address, raw site data, or a visitor key crossing `source_scope`. The implemented [identity graph](graph-contract.md) provides explicit, consented bridges from these source-scoped records to known contacts; replay complete ordered touch histories when late events arrive. The [webhook resolver](webhook-contract.md) consumes established graph evidence and returns persistable receipts. Durable storage and atomic receipt/effect persistence remain caller-owned; these primitives alone perform neither graph construction nor persistence.

The collector's PostgreSQL timestamp projection is microsecond precision, but its touch export
retains the exact original ISO string when available. Pass that original string to
`dedupeTouches`; do not round it through Date milliseconds or substitute the native projection.
The collector has a separate UTC-year-0001–9999 storage policy, while this primitive accepts
four-digit year 0000 inputs and offset instants across year boundaries. Native source sessions
retain their own microsecond reporting rules; attribution suppression is a separate calculation.

Temporal regression verification uses full independent primitive goldens and executed old
window/sort/late/calendar mutants. The real collector-to-SQL integration includes below,
exact and above 30-minute nanosecond boundaries and writes full native rows, requests, source
hashes and expected/actual dedupe outputs to timestamped Downloads evidence. The existing
graph engine and normalization/hash authority are unchanged by this precision correction.

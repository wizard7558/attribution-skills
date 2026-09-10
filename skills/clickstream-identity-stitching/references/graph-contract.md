# Source-scoped identity graph contract

`buildIdentityGraph(input)` is an explicit evidence graph. Contacts are keyed by `(source_system, source_scope, contact_key)`. Identifies are keyed by `(source_system, source_scope, visitor_key, observation_key)` and touches by `(source_system, source_scope, visitor_key, touch_key)`. Required keys are nonempty strings with no surrounding whitespace. A binding must explicitly authorize a visitor system/scope to match a contact system/scope; equal names never create an implicit bridge. Every component of both qualified scopes matters.

Inputs must be JSON-compatible plain data: finite numbers, strings, booleans, null, dense arrays, and plain objects (including objects with a null prototype). Undefined values, nonplain objects, sparse arrays, cycles, symbols, accessors, nonenumerable properties, and extra array properties are rejected, including in arbitrary metadata. Arrays of contacts, identifies, touches, and bindings default to empty when omitted. `as_of` must be an ISO timestamp with an explicit timezone and `lookback_days` must be positive and finite. Identifies require at least one valid identity in the selected input format; contacts may have neither. Supplied non-null malformed identities are rejected. Touches require a supported channel and taxonomy version `0.1.0`.

In raw mode each valid identity is canonicalized and hashed with the shared pseudonymous identity primitive. In canonical hash mode the caller-supplied digest enters the same candidate matching engine unchanged. Matching unions email and phone candidates within authorized contact scopes. One qualified candidate creates one evidence edge per observation. Zero candidates remain unresolved. More than one candidate, including an email match to one contact and a phone match to another, remains ambiguous and creates no edge. Contacts are never invented from an unknown identifier, destructively merged, or overwritten. Raw identifiers, IP addresses, and arbitrary input properties never appear in output; caller-supplied qualified keys must themselves be opaque identifiers rather than PII.

## Explicit identity input format

The top-level `identity_input_format` selects one format for every contact and identify row in
that graph call. Omission means `raw`. Explicit `raw` and `canonical_sha256_v1` are the only
accepted values; null, unknown strings, whitespace variants, and other types are rejected.
The format never changes qualified scope authorization, candidate union, ambiguity, duplicate
handling, temporal precision, or the output schema.

| Format | Identity columns on contacts and identifies | Other representation |
| --- | --- | --- |
| `raw` (default) | Existing `email` and `phone`; canonicalize and hash with the shared primitive | Any supplied non-null `email_hash` or `phone_hash` is rejected, even when a valid raw identity exists |
| `canonical_sha256_v1` | `email_hash` and `phone_hash`, each absent, null, or exactly 64 lowercase hexadecimal characters | Any supplied non-null `email` or `phone` is rejected, even when a valid hash exists |

In hash mode, no trimming, case conversion, canonicalization, decoding, or second hash is
performed. An identify needs at least one valid non-null digest; a contact may have neither.
Null opposite-format columns are allowed because they do not assert a competing identity.
There is no raw/hash fallback and no inference of format from a value's appearance. A malformed
hash or mixed representation is rejected even on an unauthorized or future row, before exclusion.

`canonical_sha256_v1` is the caller's attestation that digests were produced as lowercase SHA-256
of canonical UTF-8 email/phone values using this skill's shared identity normalization semantics
(version `0.1.0`, documented in [identity-contract.md](identity-contract.md)). The `v1` labels
this input-format contract, not an ad-platform encoding. Gmail dots and plus tags remain
significant, and canonical phones retain the explicit `+` country prefix. The graph can validate
hash syntax but cannot verify its preimage or prove which normalization/version produced it.
Platform-specific Google, Meta, TikTok, LinkedIn, Reddit, or other CAPI hashes must never be
substituted for these shared graph identities, even when they are also 64-character SHA-256 hex.

A pixel export that already carries the shared canonical digests can therefore supply
`canonical_sha256_v1` contacts and identifies without providing raw email or phone. Touches and
bindings keep their existing shape. Equivalent raw and canonical-hash inputs produce
byte-identical graph output, including evidence hashes, qualified contacts, shared-device
ambiguity, exclusions and timestamp strings. The graph emits no input-format field and does not
migrate, rewrite, or infer relationships for previously stored digests.

Repeated identical scoped contacts, observations, and touches are idempotent; conflicting rows with the same scoped key are rejected. Identity spelling that canonicalizes to the same email or phone is equivalent for contact/observation comparison. Repeated identical bindings have no additional effect. Distinct observations retain separate immutable edges, even when they identify the same contact. Inputs are not mutated, and the full output is deterministic under row and object-key insertion permutations.

An edge is eligible for touch projection only when its visitor system, scope, and key match exactly and all three inclusive conditions hold:

```text
edge.occurred_at <= as_of
touch.occurred_at <= as_of
touch.occurred_at >= edge.occurred_at - lookback_days
```

Timestamp comparisons retain exact integer nanoseconds. Accepted strings use four-digit years
0000–9999, a real proleptic Gregorian date, `T`, 24-hour time, zero to nine fractional digits
(one to nine digits when the decimal point is present), and `Z` or a signed `HH:mm` offset.
Offsets cannot exceed 14:00; 24:00, leap seconds, date rollover, and offset-free timestamps are
invalid. Year 0000 is a leap year; years 0001 and 0100 are not. Early years do not inherit
JavaScript Date.UTC's 1900 offset for years 0–99. Output retains the original timestamp strings,
including fractional spelling and offset; only comparisons use the derived nanoseconds.

The as-of cutoff is inclusive at full precision: a touch or identify one nanosecond after it
is excluded and counted. Equivalent offset timestamps denote the same instant, including
instants before 1970. Future observations cannot create graph edges or shared-device context.

`lookback_days` is a positive finite JavaScript Number. Its standard `Number.toString()` decimal
spelling, including exponent notation, is interpreted as an exact rational duration of
86,400 seconds per day. If that duration is `numerator / denominator` nanoseconds, eligibility
uses `(edgeNs - touchNs) * denominator <= numerator`. The duration is never rounded to integer
nanoseconds or milliseconds and never multiplied through an overflowing floating-point day
value. Positive subnanosecond limits, the smallest positive finite Number, and huge finite
lookbacks remain valid. A same-instant touch satisfies any positive lookback; an earlier edge
continues to support a later touch through the exact as-of boundary.

The lookback limits how far before an identify observation a touch may be backfilled. An earlier edge continues to support later touches through `as_of`. With an edge on January 10, a two-day lookback, and `as_of` on January 12 (all at midnight UTC), January 7 is unresolved; January 8, 9, 10, 11, and 12 are eligible. Identifies and touches after `as_of` are excluded and counted in diagnostics. Future edges cannot create shared-device ambiguity.

Shared-device classification is global to a qualified visitor across **all matched edges through `as_of`**, regardless of each edge's eligibility for a particular touch. A visitor with more than one qualified contact produces an ambiguous touch with reason `shared_device` whenever that touch has at least one eligible edge. Its `contacts` contains all of the visitor's qualified contacts as ambiguity context, **not valid credit candidates**; `edge_evidence_keys` contains only the touch-eligible edges. If no edge is eligible, the touch is unresolved with empty contacts and evidence keys and no reason, even if diagnostics classify the visitor as shared. A visitor with exactly one contact and an eligible edge produces a matched touch. Ambiguous identity observations create no edges and therefore do not add global visitor contacts.

For example, a January 9 touch with a two-day lookback can use a January 10 edge to contact A but cannot use a January 12 edge to contact B. With `as_of` January 12, it is nevertheless ambiguous with contacts A and B and only A's eligible edge key. A January 7 touch for that same visitor remains unresolved.

GA4 `user_id`, Segment `anonymousId`/`userId`, Snowplow `domain_userid`/`network_userid`, and PostHog distinct IDs can be adapter inputs only when the adapter supplies explicit source and scope fields and a contact identity observation. None may be bridged with IP address or a bare ID.

Run `node skills/clickstream-identity-stitching/scripts/test-graph.mjs` from the repository root, or `node scripts/test-graph.mjs` from this skill directory. The runner consumes full output goldens for every successful fixture, rejects unknown fixture kinds and fields, verifies whole-input immutability, and permutes all successful inputs. It also executes JavaScript-only invalid inputs, checks nontrivial permutations for every input array and object insertion order, and proves deliberately mutated nested goldens fail the same assertion used by the fixture runner. The printed fixture, assertion, permutation, and mutation counts reflect work actually executed.

The temporal additions use independently specified complete-output goldens; expected graph
objects are not produced by the implementation. They cover one-nanosecond future identifies and
touches, inclusive as-of and lookback boundaries, plus/minus one-nanosecond lookback cases,
scientific and subnanosecond durations, offset equivalence, pre-epoch instants, huge finite
limits, and year-zero leap-day validation. All original golden objects remain unchanged.
The suite executes an isolated module mutant that restores Date.parse millisecond truncation;
five new complete-output golden checks must reject that historical behavior. Temporary mutant
files are removed. Runtime output remains plain JSON; no BigInt or raw identity is emitted.

Hash-mode verification adds literal single-contact, cross-device, mixed email/phone ambiguity,
shared-device, unauthorized-scope, no-identity contact, duplicate/conflict, and nanosecond-cutoff
fixtures. Input digests for these literal cases were independently derived with Python hashlib
from declared canonical strings; accepted full raw graph outputs remain their expected objects.
The suite also transforms every successful raw fixture through the actual shared `hashIdentity`
primitive and requires complete and serialized output parity. An isolated copied module runs
three hash goldens without a sibling skill, and an executed rehash mutant must fail the literal
hash evidence golden. All original 71 JSON fixtures remain semantically unchanged.

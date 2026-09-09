# Explicit pixel identity projection

`projectIdentity(input, { identitySkillRoot })` is an asynchronous, read-only adapter around
the installed identity skill's actual `dedupeTouches` and `buildIdentityGraph` engines.
It turns explicitly authorized graph matches into qualified MTA subject fields. It never
uses `native_contact_id` as a subject fallback, creates an implicit source bridge, rehashes
identities, classifies legacy channels, or writes database records.

**Contacts are a current snapshot.** `as_of` limits source events and graph edges; it cannot
reconstruct historical contact hashes, attestation state or deleted contacts. Creation time
is provenance, not a historical identity validity interval. Keep the exact input snapshot
and its evidence reference. A historical attribution claim requires an independently
appropriate contact snapshot and caller policy; this wrapper cannot manufacture one.

## Explicit dependency and CLI

```js
import { projectIdentity } from './scripts/project-identity.mjs';
const result = await projectIdentity(snapshot, {
  identitySkillRoot: '/absolute/path/to/installed/clickstream-identity-stitching'
});
```

```sh
node scripts/project-identity.mjs \
  --input /absolute/path/to/snapshot.json \
  --identity-skill-root /absolute/path/to/installed/clickstream-identity-stitching
```

The caller must supply the dependency root; a supplied relative path is resolved against the
process working directory. The wrapper imports `scripts/identity-primitives.mjs` and
`scripts/identity-graph.mjs` using file URLs. Missing files or function exports fail clearly.
There is no inferred sibling path, vendored engine, network install or alternate matching
implementation. Use a trusted installed skill directory; importing it executes its modules.
Dependency checksums belong in run evidence, not the deterministic projection output. The
CLI reads one JSON file and writes JSON to stdout; errors produce a nonzero exit without
printing JSON source values. It does not write a report or mutate the input file.

## Input contract

All data must be plain JSON: finite values, plain objects (null prototypes allowed), dense
arrays, enumerable data properties, and no cycles, symbols, accessors or extra array fields.
Unknown fields are rejected. Each invocation synchronously copies validated plain JSON into
an independent internal value before its first await and captures the explicit dependency
root string. Later caller mutations to config, bindings, source rows, nested click values,
attestation or external catalogs cannot alter that invocation. Caller objects are neither
frozen nor mutated, and accepted null-prototype inputs retain the same behavior.
Raw `email`/`phone` fields and arbitrary metadata are not accepted,
including alongside hashes. Qualified keys and evidence references must be exact nonempty
strings without surrounding whitespace. Keys and evidence references must themselves be
opaque references, not raw PII; the wrapper cannot determine a key's preimage.

Required top-level fields:

| Field | Meaning |
| --- | --- |
| `snapshot_evidence_ref` | Caller-owned reference to this exact source snapshot. |
| `config` | Exact configuration below. |
| `touches` | Complete rows from [identity_touches.sql](sql/identity_touches.sql). |
| `observations` | Complete rows from [identity_observations.sql](sql/identity_observations.sql). |
| `contacts` | Complete rows from [identity_contacts.sql](sql/identity_contacts.sql), including unknown contacts. |

`config` requires exactly `invocation_key`, `as_of`, positive finite `lookback_days`,
`identity_scope_bindings`, `identity_input_format='canonical_sha256_v1'`, and
`identity_normalization_version='0.1.0'`. Bindings contain exactly `source_system`,
`source_scope`, `contact_source_system`, `contact_source_scope`. All four values matter.
Even pixel-to-pixel matching requires a supplied binding. An empty binding array is valid
and authorizes no matches. Equal bare keys do not bridge scopes.

Optional `external_contacts` uses the same contact shape and attestation rules, but permits
explicit arbitrary qualified source systems/scopes/keys and nullable `native_created_at`.
If nonempty it requires nonempty `external_contact_evidence_ref`. The reference is optional
and may be NULL for an empty/absent external catalog. A caller may bind only an external CRM
catalog while retaining the native contacts for diagnostics. Binding both catalogs unions
all authorized candidates; duplicated identity across catalogs may produce ambiguity.

Native touch, observation and contact rows require `source_system='first_party_pixel'`.
Every declared export field must be present. No renaming or implicit scope assignment occurs.
Contact creation time is checked as an exact nonempty string (or external NULL) and never
used for temporal eligibility. Every record's keys, status and attestation consistency and
all duplicate conflicts are validated before source-status filtering.

### Contact rows

The exact eleven fields are `source_system`, `source_scope`, `contact_key`, `email_hash`,
`phone_hash`, `email_hash_format`, `phone_hash_format`, `email_hash_status`, `phone_hash_status`,
`capture_status`, `native_created_at`.

For each kind, `attested` requires an exact lowercase 64-hex hash and format
`canonical_sha256_v1`. `missing` or `legacy_unverified` requires both exposed hash and format
NULL: the SQL deliberately excluded any unverified stored digest. Unknown status strings
and contradictory combinations are rejected. `capture_status` is `eligible` iff at least
one kind is attested, otherwise `no_attested_identity`. It describes current contact export
eligibility, not observation status or historical validity. Unknown contacts still enter
the graph with NULL hashes and remain in diagnostics. Hash format attests shared
normalization version `0.1.0`; hash bytes cannot verify their preimage. Platform-specific
CAPI digests must never be substituted.

### Observation rows

The exact eleven fields are `source_system`, `source_scope`, `visitor_key`, `observation_key`,
`occurred_at`, `source_event_type`, `email_hash`, `phone_hash`, `identity_input_format`,
`identity_normalization_version`, `capture_status`. Event type is `identify` or `form_submit`.
Format/version must match the config. Each hash is NULL or exact lowercase 64-hex.
`eligible` requires at least one hash; `no_valid_identity` requires both NULL and is excluded.

### Touch rows

The exact eleven fields are `source_system`, `source_scope`, `touch_key`, `visitor_key`,
`occurred_at`, `channel`, `taxonomy_version`, `utm_campaign`, `click_ids`, `native_contact_id`,
`export_status`. Campaign and native contact are nullable; channel is a string; taxonomy
version is a string or NULL. `click_ids` has exactly thirteen nullable string fields:
`dclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`, `ttclid`, `rdt_cid`, `li_fat_id`,
`twclid`, `epik`, `sccid`, `srsltid`. Opaque values and encodings remain unchanged.

The declared status must agree with this source-export precedence:

1. NULL version → `legacy_requires_reclassification`.
2. Version other than `0.1.0` → `unsupported_taxonomy_version`.
3. Version `0.1.0` with a channel outside Paid Search, Paid Social, Paid Other, Organic Search,
   Organic Social, Email, SMS, Direct, Referral, Affiliate, Other → `invalid_canonical_channel`.
4. Otherwise → `eligible`.

All source times must be exact nonempty strings. **Excluded rows receive no calendar or
temporal eligibility judgment.** Their source export/capture rejection is sufficient;
no second timestamp parser or synthetic validation graph is used. Eligible touch timestamps
are validated by actual dedupe, and eligible observation timestamps and `as_of` by actual
graph. Those engines preserve exact nanosecond comparisons and rational lookback rules.

## Replay, duplicates and graph handoff

Conflicting duplicate qualified records are rejected before filtering, including excluded
rows and native/external contacts sharing a qualified contact key. Identical contacts and
observations collapse once. Identical eligible touch duplicates reach the actual dedupe
engine, retaining its `duplicate_idempotent` suppression. Duplicate identity bindings remain
explicit and have no added effect. Identical excluded records produce one exclusion.

The wrapper performs a full replay of eligible touches through `dedupeTouches`, preserving
its strict less-than-30-minute nonextending window, first-Direct rule, scoped key tie order
and suppression reasons. It then calls `buildIdentityGraph` with sanitized canonical-hash
contacts (including unknowns), eligible identify observations, deduped touches, exactly the
caller bindings, `as_of`, `lookback_days`, and canonical input format. The actual returned
graph object is retained unchanged. No graph logic is reproduced in the adapter.

Map graph touch links by the full `(source_system, source_scope, visitor_key, touch_key)`.
Only `matched` with exactly one qualified contact supplies a subject. `ambiguous` and
`unresolved` receive three NULL subject fields. An ambiguous identify can leave a touch
unresolved because that observation creates no edge; the full graph preserves the candidate
ambiguity. Shared-device touch ambiguity is preserved unchanged. Never reinterpret either
case as a unique match.

Future exclusion derives solely from validated graph membership: a deduped touch absent
from `graph.touch_links`, or an eligible observation absent from `graph.observations`, is
`future_after_as_of`. The adapter performs no clock read or additional time comparison.
Suppressed future duplicates remain dedupe suppression records, rather than receiving a
second exclusion. Exact as-of and lookback boundaries remain the graph's responsibility.

## Output contract and MTA boundary

Output has exactly `contract_version='0.1.0'`, `invocation_key`, `snapshot_evidence_ref`,
`external_contact_evidence_ref` (NULL or caller reference), `graph`, `touches`,
`suppressed_touches`, `excluded_touches`, `excluded_observations`, `contact_diagnostics`.

Each projected touch preserves the eleven source fields above, then adds `invocation_key`,
`identity_status`, `subject_source_system`, `subject_source_scope`, `subject_key`. The three
subject fields form one qualified identity and must travel together into an explicitly
compatible MTA invocation. A native contact field remains audit evidence only. This step
constructs the subject projection; it does not call an MTA engine, allocate credit or claim
an end-to-end database/MTA integration.

This is a subject-compatible projection, not a completed BigQuery MTA ingestion adapter.
Original timestamps retain up to nine fractional digits; the current MTA ledger uses native
microsecond `TIMESTAMP`. Not every preserved source spelling/precision is directly ingestible
there. This wrapper never silently rounds or truncates it. A separate ingestion integration
must define and verify that precision boundary while preserving original source evidence.

`suppressed_touches` contains the actual dedupe descriptors and reasons. Excluded touch
rows contain qualified source/scope/visitor/touch key plus `reason`; excluded observations
use observation key instead. Source rejections retain their exact status as the reason.
`contact_diagnostics` contains one row per unique contact with source/scope/contact key and
`email_hash_status`, `phone_hash_status`, including all unknown and unattested kinds.

Wrapper arrays sort by JSON-encoded qualified key using deterministic code-unit order.
Repeated identical suppressed descriptors retain their multiplicity. The graph retains its
own engine ordering unchanged. Object field order is fixed for serialized output. Inputs
are never mutated; source rows, contacts, links and native ownership remain untouched.

## Verification and evidence

```sh
node skills/first-party-pixel/scripts/test-identity-projection.mjs
node skills/clickstream-identity-stitching/scripts/test-primitives.mjs
node skills/clickstream-identity-stitching/scripts/test-graph.mjs
node skills/clickstream-identity-stitching/scripts/test-identity-artifacts.mjs
node scripts/test-suite-contracts.mjs
```

Twenty-two independent literal full-output goldens cover unique and cross-device matches,
shared devices, email/phone and cross-catalog ambiguity, per-kind legacy provenance,
missing identity, absent/unauthorized bindings, CRM-only binding, native-contact temptation,
futures one nanosecond beyond as-of, inclusive lookback, exact 30-minute dedupe and Direct,
idempotent qualified duplicates, identical bare keys across visitors/scopes, source rejection
and empty snapshots. Expected candidate,
edge and subject selections were specified independently without executing the wrapper or
engines. Synthetic input digests were derived independently with Python hashlib.

The test freezes all successful inputs, checks full output and byte determinism under row
and object-key permutations, rejects malformed/contradictory/conflicting records before
filtering, and proves accessors are not executed. An instrumented copied dependency delegates
to the unchanged actual engines and records the exact sanitized arguments, including unknown
contacts and explicit bindings. Six executed wrapper mutants test native fallback, automatic
binding, dropped ambiguity, dropped unknown contacts, exposed legacy-hash acceptance and
retained caller row references across await. Eight immediate caller-mutation cases cover
hashes/attestation, config bindings/as-of, touches, observations, external catalogs and the
dependency root. The historical reference-sharing behavior incorrectly matches a legacy
contact after caller mutation; the original unresolved full golden rejects that behavior.
Copied pixel and independently located identity directories exercise the real engines and
CLI, including relative explicit paths, missing root/exports and value-free malformed JSON
errors. Temporary copies are removed. No database, hosted deployment or model calls occur.

Timestamped compact reports with source/dependency/fixture hashes, actual counts and engine
arguments are saved under `~/Downloads/first-party-pixel-identity-projection-evidence-*.json`.
Earlier failed development attempts remain evidence of their executed revision. Native
HTTP/PostgreSQL snapshot through projection and MTA is a separate integration boundary;
these offline tests do not claim to have executed that full chain.

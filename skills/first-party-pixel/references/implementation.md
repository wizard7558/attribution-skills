# Implementation reference

This document covers the collector's payload contract, its processing order,
channel derivation, identity model, sessionization, and how to run and
interpret the verification scripts. It assumes you have `assets/schema.sql`,
`assets/pixel.js`, `assets/collector/**`, and `scripts/**` open alongside it.

## Shared taxonomy and output contract

`assets/collector/core.js` imports the generated sibling `channel-taxonomy.mjs`; it does not
contain a second classifier. `deriveChannel(input)` remains the public compatibility wrapper and
returns `classifyChannel(input)`. New touchpoints carry `taxonomy_version`, while `srsltid` is
stored as raw evidence and never used as paid evidence. Pixel attribution is `first_touch`.

The sessions view keeps its historical columns first and appends `native_channel`,
`taxonomy_version`, `attribution_basis`, `source_system`, `source_scope`, `visitor_key`,
`is_new_user`, and full `click_ids` JSON. Legacy `Display`, `Affiliates`, and `Unassigned`
touchpoints map to `Paid Other`, `Affiliate`, and `Other`; raw labels remain in
`native_channel` and receive version `legacy`. A no-touch session can infer Direct only from a
valid captured landing URL with no source, medium, click ID, or external referrer; otherwise it
is `Other` with `legacy/unclassified`.

`channel_daily` is grouped by `source_scope` (site), UTC `event_date`, and channel. Its required
metrics are sessions, engaged_sessions, new_users, and key_events (collector conversions).
`conversion_value` is pixel-native and remains NULL when any conversion value/currency is
unknown or currencies are mixed; `conversion_value_status` is `known`, `no_conversions`,
`unknown`, or `mixed_currency`. Currency is normalized to trimmed uppercase and never mixed.

## Payload contract

Every event the pixel sends is a JSON POST with this exact shape, whether
it's a `pageview`, `track`, `identify`, `form_submit`, or `consent`:

```json
{
  "site_key": "site_abc123",
  "visitor_uid": "b6f2...-uuid",
  "event_type": "pageview",
  "event_name": null,
  "url": "https://example.com/pricing?utm_source=google&utm_medium=cpc&gclid=TEST123",
  "referrer": "https://www.google.com/",
  "occurred_at": "2026-09-01T12:00:00.000Z",
  "properties": {},
  "utm": { "source": "google", "medium": "cpc", "campaign": null, "content": null, "term": null },
  "click_ids": {
    "gclid": "TEST123", "gbraid": null, "wbraid": null, "dclid": null,
    "fbclid": null, "ttclid": null, "rdt_cid": null, "li_fat_id": null,
    "msclkid": null, "twclid": null, "epik": null, "sccid": null, "srsltid": null
  },
  "platform_cookies": { "_fbp": null, "_fbc": null, "_rdt_uuid": null, "_ttp": null },
  "identity": null,
  "consent": null
}
```

`click_ids` and `platform_cookies` always carry all of their keys (`null`
when absent) so the shape never varies between requests. `identity` is
`null` unless the event is `identify` or `form_submit` and at least one of
`email`/`phone` was captured. `consent` is `null` unless the event is
`consent`. `email`/`phone` never appear in `url`: the pixel strips those
two query parameters before sending.

Transport is `navigator.sendBeacon` first, `fetch(..., { keepalive: true })`
as the fallback, with `Content-Type: text/plain` so the request is a CORS
"simple request" and never triggers a preflight as long as the pixel and
collector are on different origins with no credentials involved.

## Exact source time and immutable identify capture

`occurred_at` must be a real Gregorian ISO timestamp with four-digit year 0001–9999,
uppercase `T`, seconds, an optional 1–9 digit fraction, and `Z` or a numeric offset no
larger than ±14:00. The UTC instant must also lie within years 0001–9999. Calendar rollovers,
naive times, leap seconds, 24:00 and out-of-policy instants return 400 before a transaction.
This is the collector storage policy; it does not narrow the identity graph's broader input.

The portable `assets/collector/timestamp.mjs` preserves original text in `occurred_at_iso`
on events, touchpoints and conversions. The native timestamptz is a UTC microsecond
projection floored from the fractional digits, including before 1970. It never rounds via
JavaScript Date milliseconds. Existing rows retain NULL original text. Keep the new module
beside `core.js` in every adapter deployment/copy.

`pixel.identity_observations` records the actual identify/form-submit event time, canonical
hashes and normalization version. It stores no raw identity values and rejects UPDATEs;
site/visitor retention deletion remains allowed. No observations are backfilled from legacy
identity-link timestamps. [The capture contract](identity-capture-contract.md) defines the
full table/export, timestamp policy and verification boundary. The
[resolution contract](identity-resolution-contract.md) defines the current site-scoped candidate
union, per-kind hash provenance and safe native assignment. No graph is called; native contact
IDs remain provenance rather than resolved subject ownership.

## Atomic database boundary

Every adapter uses the sibling `assets/collector/transaction-db.mjs`. The Node, Vercel Node
and Cloudflare Hyperdrive adapters use `createPgDatabase(pool)`; Supabase uses
`createPostgresDatabase(sql)` with `prepare: false` retained at client creation. Copy this
helper with the collector directory. The database must support interactive transactions:
a stateless HTTP query driver is not a substitute. See the exact
[transaction contract](transaction-contract.md) for lifecycle, rollback and verification.

`handleCollect` validates the payload before opening a transaction. Site/origin checks,
bot filtering, visitor/event writes, contact/link resolution and hash attestation, consent,
touchpoints and conversions then use only the callback's transaction connection. The request
returns after commit; an exception rolls back its database changes. A database without
`transaction(async tx => result)` support is rejected. Atomicity itself does not change identity, timestamp, conversion,
consent, payload or HTTP status rules; the source-time/capture revision is described above.

## `handleCollect` processing order

`assets/collector/core.js` exports `handleCollect(payload, ctx, db)`, run by
every adapter in that order. `assets/collector/package.json` marks the
directory as ES modules; keep it next to `core.js` when you copy the
collector into your project, or add `"type": "module"` to your own
package.json.

1. **Validate** payload shape and sizes. Malformed payloads get `400`
   without touching the database.
2. **Begin transaction and origin check.** Look up `pixel.sites` by `site_key`. An unknown
   `site_key`, or an `Origin` header not in a non-empty `allowed_origins`,
   gets `403`. An empty `allowed_origins` array accepts any origin (useful
   while a new site is still being configured).
3. **Bot filter.** A `User-Agent` matching the bot pattern gets a silent
   `204`: no visitor, event, or touchpoint is written.
4. **Upsert visitor**, keyed on `(site_key, visitor_uid)`.
5. **Sanitize raw tracking evidence** to the five recognized UTM fields and
   thirteen recognized click-ID fields, retaining strings exactly and replacing
   other values with null. Hash the request IP separately when supplied.
6. **Insert the event** into `pixel.events`, including the sanitized `utm` and
   `click_ids` JSON. IP is stored raw (retention is a separate purge job).
7. **Immutable identity observation**: every `identify`/`form_submit` stores one event-keyed
   hash-only observation, including `no_valid_identity` when neither identifier is valid.
   **Contact resolution**: serialize candidate selection by site, union email and phone
   matches, attest only matching supplied kinds, and create/reuse a contact only for zero/one
   candidates. Ambiguous unions retain all candidates and create no link or native assignment.
8. **Consent**: on a `consent` event, upsert `pixel.consent_state`.
9. **Touchpoint derivation**: see below.
10. **Conversion detection**: every `form_submit` is a conversion; a
    `track` event counts when `properties.is_conversion === true` or its
    `event_name` is one of `purchase`, `generate_lead`, `sign_up`,
    `form_submit`. `value`/`currency` come from `properties` when present
    and numeric/string respectively.
11. Return `204` with no body on success.

## Channel derivation

Runtime classification delegates to the shared `channel-taxonomy.mjs` module, whose 11-label contract and precedence
are authoritative. `deriveChannel` remains a stable wrapper; it does not implement separate
rules. `srsltid` is captured and stored but never establishes paid traffic.

The shared module returns exactly one of the 11 canonical labels: Paid Search, Paid Social,
Paid Other, Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate, or Other.
It retains raw signals, maps legacy labels only in the session view, and never treats `srsltid`
as paid evidence. Read the shared taxonomy skill's source mappings for the complete precedence
and native-label mapping.

## Native touchpoints and downstream attribution dedupe

Every accepted `pageview` creates exactly one `pixel.touchpoints` row. The
collector calls the shared classifier once with raw sanitized UTM/click fields,
URL, and referrer, then writes the resulting channel and taxonomy version. An additive shared
`extractRawTrackingEvidence` helper selects raw payload/URL evidence for the
touchpoint without changing classifier logic or taxonomy version. There
is no channel/time suppression, source-signal gate, or session-landing gate at
collection. Internal and later-session Direct pageviews remain native evidence.
Other event types retain their existing event/conversion behavior.

`pixel.events.utm` stores exactly `source`, `medium`, `campaign`, `content`, and
`term`; `pixel.events.click_ids` stores exactly the thirteen recognized names.
Recognized string values, including whitespace, percent encodings, case, plus
signs, and empty strings, are retained without pre-decoding. Missing or non-string
values become JSON null. Arbitrary keys, arrays/objects as field values, and nested
tracking data are not copied into these tracking columns or coerced into SQL
text. Touchpoint columns store **selected raw evidence**: each nonempty payload
UTM string wins, otherwise the valid landing URL supplies it; each valid payload
click string wins, otherwise the URL supplies it. Selection uses the canonical
classifier's existing URL host/query/validation helpers, including encoded keys,
first repeated parameter wins, fragment exclusion, and URL `+` as space. Selected
values retain original percent encodings/case and payload literal plus signs;
validation does not replace them with decoded values. The classifier still sees
the original sanitized payload plus URL exactly once, never the helper's output.
Thus URL-only campaigns/click IDs survive export and attribution dedupe while
`pixel.events` distinguishes what the payload actually supplied. Existing
`properties`, URL, and IP contracts are separate and unchanged; this tracking
projection is not a general PII scrubber.

The new event columns are nullable with no fabricated default. Idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` upgrades pre-existing event partitions;
old rows remain SQL NULL when source evidence was never captured. No existing
hash, event, or native touchpoint is rewritten, deleted, or reclassified. Legacy
history may lack source fields or pageviews previously suppressed by the old
collector; the upgrade does not invent that evidence.

Repeated payloads without a verified stable business-event key create distinct
native events and touchpoints, including concurrent arrivals. Recording two
observations is not a promise of transport idempotency. The raw rows preserve
same-channel distinct campaigns, opaque click changes, A → B → A journeys, and
late arrivals so downstream attribution can replay complete source history.

Source session reporting continues to read the native observations. For example,
a Paid Search landing, internal Direct pageview, and later-session Direct landing
now produce three native touchpoints, while still reporting the same two sessions:
Paid Search with two pageviews, then Direct with one. Do not apply the attribution
skill's single-Direct rule to collection or remove native later-session landings.

### Identity-touch export

[sql/identity_touches.sql](sql/identity_touches.sql) is a standalone read-only
PostgreSQL SELECT over `pixel.touchpoints`, with no sibling dependency. It exports
`source_system = first_party_pixel`, site as `source_scope`, native UUID strings as
`touch_key`/`visitor_key`, exact original ISO `occurred_at` (native UTC with six fractional
digits only for legacy rows lacking original text), channel/version, raw campaign, and
all thirteen click fields. `native_contact_id` is preserved only as collector
association evidence; it does not produce a `subject_*` ownership triple. Shared
devices require an explicit identity-graph decision in a separate integration.

Only rows with actual `taxonomy_version = 0.1.0`, a canonical channel, and
`export_status = eligible` may enter the identity dedupe function. NULL-version
rows remain unchanged with `legacy_requires_reclassification`; unsupported versions
and invalid canonical labels have separate diagnostics. Retain these rows for
explicit reclassification from trustworthy original evidence. Never relabel them
`0.1.0` merely to satisfy an input validator.

Install the `clickstream-identity-stitching` skill to apply its single attribution
dedupe authority to exported rows. For example, in a repository integration:

```js
import { dedupeTouches } from '../clickstream-identity-stitching/scripts/identity-primitives.mjs';

// exportedRows is the actual result of references/sql/identity_touches.sql.
const diagnostics = exportedRows.filter((row) => row.export_status !== 'eligible');
const touches = exportedRows
  .filter((row) => row.export_status === 'eligible')
  .map(({ export_status, native_contact_id, ...touch }) => touch);
const attribution = dedupeTouches(touches);
```

Keep the diagnostic and native contact evidence separately for audit. The identity
function uses consecutive accepted signatures, a strict below-30-minute repeat
window that suppressed rows do not extend, and first-entry-only Direct attribution.
Those are attribution decisions over qualified source visitors; the native
`pixel.sessions` and `pixel.channel_daily` population, event counts, and first-touch
session basis remain separate. Do not substitute deduped attribution-touch counts
for source sessions, sum cross-source people without an explicit bridge, or claim
causal lift from either output.

Use a full chronological replay when source history changes or receives late
arrivals. `dedupeTouches` sorts full input deterministically and rejects a new row
older than seeded latest history; a partial incremental call cannot repair prior
suppression decisions. Retain stable source-native touch keys and preserve the
old observation rather than manufacturing a global key from campaign/time.

Every new pageview touchpoint and `track` conversion has `contact_id = NULL`, including
requests after an identify event. Only a `form_submit` with its own unique current-event
contact result may assign its conversion. There is no latest-link lookup or touch back-fill.
Existing native contact IDs are preserved as historical provenance. Subject projection is a
separate graph integration requiring explicit scope and time policy.

The [native MTA handoff](mta-integration-contract.md) prepares exact ledger inputs from the
actual identity projection, rejects unrepresentable timestamp/decimal precision, and keeps
unknown subject and monetary evidence. Its opt-in synthetic integration verifies the
collector-to-native-ledger chain without changing source records or MTA SQL.

The opt-in [consistent snapshot reader](identity-snapshot-contract.md) reads all three
identity exports under one explicitly scoped repeatable-read, read-only transaction and
returns native provenance plus explicit site presence. It can feed the projection below
without changing source records.

The read-only [identity projection contract](identity-projection-contract.md) defines an
explicit installed-engine handoff from source exports to qualified subject fields. Its
`project-identity.mjs` wrapper requires caller bindings and snapshot evidence, retains
unknown/ambiguous results and does not call MTA or write native records.

## Identity model

Identity resolution is deliberately narrow: **email and phone only, never
IP**. Contact candidates are selected by the union of supplied email and phone
hashes within one site; neither kind takes priority. The [resolution contract](identity-resolution-contract.md)
defines safe field fills, ambiguity and per-kind attestation:

- New identity values use the bundled portable normalization authority
  `assets/collector/identity-normalization.mjs`, version `0.1.0`. Email is
  trimmed/lowercased and must have one `@`, a nonempty dotted domain, and no
  whitespace; Gmail dots and plus tags are preserved. Phone requires an explicit
  international `+`, removes supported formatting/trailing extensions, and
  requires 8–15 digits with a nonzero first digit. There is no country inference.
  Valid canonical strings are hashed with Web Crypto SHA-256 over UTF-8, matching
  the shared identity primitive's Node hash. Either valid identifier can create a
  contact; invalid values produce no new identity hash, and if both are invalid
  the event is retained without a new contact or identity link.
- `pixel.identity_links` rows are never deleted or updated to point
  elsewhere. A visitor can link to more than one contact (shared devices,
  re-identifying under a different email on the same device); a contact can
  be reached from more than one visitor (the same person on their phone and
  laptop). The collector adds links only for unique current-event results; it never
  merges contacts or projects ownership onto a visitor's history. Retention deletion remains allowed.
- Raw email/phone values never reach `pixel.contacts` unhashed except in
  `email_canonical`/`phone_e164`, which exist for support/debugging lookups;
  the resolver reads these fields to prevent incompatible legacy fills. Removing them
  requires a separately reviewed schema and resolver change. The current contact export
  contains only attested hashes and diagnostics, never these raw identity fields.
- IP addresses are never part of identity resolution. `visitors.ip_hash` is
  a salted hash used only for fraud/rate-limit heuristics, never joined to
  `pixel.contacts`.

### Portable normalization and legacy compatibility

The collector imports `canonicalizeEmail` and `canonicalizePhone` from its bundled
module and preserves the existing `__internal` helper exports. The bundle is a
byte-exact generated copy of the identity skill's dependency-free authority; do
not edit it independently. In the repository, regenerate/check it with:

```sh
node skills/clickstream-identity-stitching/scripts/build-identity-artifacts.mjs --repository
node skills/clickstream-identity-stitching/scripts/build-identity-artifacts.mjs --repository --check
node skills/first-party-pixel/scripts/identity-parity.mjs --repository
```

A standalone pixel installation runs `node scripts/identity-parity.mjs` from its
own directory without sibling skills. This executes the actual collector helpers,
Web Crypto hashes, and identify-handler database parameters against explicit
canonical goldens. The collector scratch roundtrip includes the bundle beside
`core.js`, so all runtime adapters resolve the same portable module. The bundled
`touchSignature` helper is available for shared normalization; the collector retains
every native pageview and delegates attribution dedupe to the identity skill via
the source export above, rather than implementing a second SQL suppression rule.

The previous collector accepted any nonempty lowercased email and national phone
numbers, and included extension digits in phone hashes. Switching new ingestion
to normalization `0.1.0` is a semantic cutover. Existing contacts, hashes, links and
recorded history are preserved; no legacy hash rewrite or blanket attestation occurs.
Nullable `email_hash_format` and `phone_hash_format` record `canonical_sha256_v1` only
for newly computed, safely filled or currently re-proven matching kinds. Other legacy kinds
remain NULL. Record release and deployment time separately as operational provenance.
New strict hashes may not find legacy values normalized differently, and that
mismatch is not evidence that two contacts should be merged.

Historical repair requires separately verified original input and controlled
reprocessing, with original values/provenance retained and new canonical
candidates compared under the same qualified scope before any explicit migration.
Never infer a country code, reverse a hash, silently rewrite an old hash, or assume
a legacy canonical value is the verified original input. Shared-device ownership still requires its own integration and review. Native
source capture and the identity-skill export are separate from historical identity
normalization repair.

## Sessionization

`pixel.sessions` groups a visitor's `pageview`/`track`/`form_submit` events
(not `identify`/`consent`) into sessions using a 30-minute inactivity
window: a new session starts on a visitor's first captured event, or after
30 minutes with no captured event. Each session's `channel` comes from the
first touchpoint whose `occurred_at` falls inside that session's time
window; see "Native touchpoints and downstream attribution dedupe" above
for how every pageview, including a later-session Direct landing, is retained. A legacy session with no touchpoint uses the
valid signal-free landing fallback described above.

`pixel.channel_daily` aggregates `pixel.sessions` to `(source_scope, event_date,
channel)` grain, with `event_date` as the UTC calendar date of
`session_start_ts`.

### Column-name parity with `ga4-bigquery-export`

The current SQL outputs share field names where their concepts overlap. Match
these actual output columns while preserving each source's measurement semantics:

| Concept | This skill (`pixel.sessions` / `pixel.channel_daily`) | `ga4-bigquery-export` (`sessions.sql` / `channel_daily.sql`) |
|---|---|---|
| Qualified identity | `source_system`, `source_scope`, `session_key`, `visitor_key` | `source_system`, `source_scope`, `session_key`, `visitor_key` |
| Session timing/engagement | `session_start_ts`, `session_end_ts`, `engaged`, `engagement_time_sec` | `session_start_ts`, `session_end_ts`, `engaged`, `engagement_time_sec` |
| Landing/exit page | `landing_page_path`, `landing_page_location`, `exit_page_path` | `landing_page_path`, `landing_page_location`, `exit_page_path` |
| Referrer | `first_referrer` | `first_referrer` |
| Session source/medium/campaign | `session_source`, `session_medium`, `session_campaign` | `session_source`, `session_medium`, `session_campaign` |
| Canonical channel | `channel`, `taxonomy_version` (`0.1.0` for current evidence; explicit legacy/mixed markers otherwise) | `channel`, `taxonomy_version = 0.1.0` |
| Native channel audit | Session `native_channel` | Session `default_channel_group`; daily `native_channel_groups` |
| Attribution basis | `attribution_basis = first_touch` | `attribution_basis = session_last_click` |
| Daily keys/metrics | `source_system`, `source_scope`, `event_date`, `channel`; `sessions`, `engaged_sessions`, `new_users`, `key_events` | The same keys/metrics, with `taxonomy_version`, `attribution_basis`, `reporting_timezone`, and `date_basis` also declared in the grouping |
| Daily conversion/value fields | `conversions`, `key_events`, `conversion_value`, `currency`, `conversion_value_status` | `key_events`, `purchases`, `purchase_revenue_usd`, `currency`, `revenue_status`, `purchase_events_without_transaction_id` |

Both canonical `channel` outputs use the same eleven-label taxonomy and current
version `0.1.0`. GA4 labels such as Paid Shopping, Cross-network, Organic Video, and
AI Assistant remain separate source-native audit evidence; they do not expand the
canonical output vocabulary. Legacy pixel records remain visibly versioned and
are not silently promoted to the current taxonomy.

Shared names and taxonomy do not make the populations or measurement bases
interchangeable. Pixel sessions use native first-touch evidence and UTC dates;
GA4 uses session last-click evidence and the property's `event_date`, with its
reporting timezone declared separately. Engagement, new-user, key-event, and value
semantics remain source-native. Preserve source scope and declared daily grain,
align timezones/date bases explicitly before comparisons, and require an identity
bridge before cross-source person joins. Do not sum both sources as a deduplicated
population or treat pixel conversion values as equivalent to GA4 purchase revenue.

## Running the verification scripts

`taxonomy-parity.mjs` is a repository-only parity check against the shared synthetic fixture
file. The disposable `roundtrip.sh` smoke test is standalone: it copies the generated collector
module and exercises the collector/Postgres chain without invoking the sibling fixture check.

`scripts/roundtrip.sh` is self-contained and has no Git or sibling-skill dependency in its
default mode. It copies the generated collector module from the skill directory. Run
`scripts/roundtrip.sh --migration` separately when the checkout contains commit `2c240a3`; that
mode applies the historical schema first and verifies the upgrade path.
The default copied-skill smoke retains 18 HTTP assertions, plus guarded transaction and
identity-capture and contact-resolution assertions when it owns the disposable cluster; repository `--migration` mode
reports those 18 plus 3 historical-schema assertions, including NULL raw tracking
evidence on pre-upgrade events.

```sh
# Optional: point at an existing Postgres instead of a throwaway cluster.
# export DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Optional: reuse an existing `pg` install instead of letting the script
# npm-install one into a scratch directory under $TMPDIR.
# export NODE_PATH=/path/to/a/dir/containing/node_modules/pg

bash scripts/roundtrip.sh
# Repository-only historical migration proof:
bash scripts/roundtrip.sh --migration
```

It applies `assets/schema.sql`, runs `pixel.ensure_month_partitions()`,
seeds a test site with an empty origin allowlist, starts the node collector
adapter, runs `scripts/simulate.mjs` (five events: a Paid Search landing
session with a form submit, then a Direct session three hours later with a
purchase, plus six isolated source/currency events), and checks eighteen assertions covering visitor/event/touchpoint/
contact/identity-link/conversion counts, unassigned native touches, and both views. All three main-journey pageviews remain native touchpoints while the
two session and daily-value expectations stay unchanged. It
prints `PASS`/`FAIL` per assertion and exits non-zero on any failure. It
always stops the collector process and, if it started one, the Postgres
cluster, even on failure.

### Persisted touch export integration

From the repository root, run:

```sh
node skills/first-party-pixel/scripts/test-touch-integration.mjs
# Optional historical schema migration proof, always disposable here:
env -u DATABASE_URL bash skills/first-party-pixel/scripts/roundtrip.sh --migration
```

The integration wrapper explicitly removes inherited `DATABASE_URL` and lets the
existing roundtrip lifecycle create and clean up a throwaway local PostgreSQL
cluster and Node collector. It requires the sibling identity skill; its internal
`--connected` mode is guarded for that owned localhost test environment. No hosted
or production database is used by this test command. A standalone pixel copy can
still run the SQL SELECT and its ordinary `scripts/roundtrip.sh` independently.

Nineteen persisted journey goldens submit 41 pageviews, execute the actual SQL export,
and call the real identity `dedupeTouches` function. They cover campaigns, case/plus
click IDs, normalized repeats, A → B → A, exact thirty-minute boundaries, nonextending
suppression, native returning Direct, first Direct then paid, site-qualified browser
IDs, out-of-order full replay, concurrent duplicate payloads, raw tracking
sanitization, URL-only campaigns/clicks, and preservation of deep encodings and
URL plus semantics. Source session/daily goldens remain native. The test also reapplies the
schema twice and compares complete historical event/export snapshots so missing
source evidence stays NULL and legacy labels/versions remain unchanged.

## What was executed vs. syntax/type-checked

- **Executed end-to-end**, repeatedly, via `scripts/roundtrip.sh`: `assets/
  schema.sql` (including `ensure_month_partitions`, the `sessions` and
  `channel_daily` views), `assets/collector/core.js`, and the **node**
  adapter (`assets/collector/node/server.js`).
- **Executed in a jsdom-simulated browser**: `assets/pixel.js` (pageview +
  `track` calls, click-id/utm capture, `sendBeacon` payload shape).
- **Unit-tested directly**: `deriveChannel` against 156 shared taxonomy fixtures,
  plus 23 identity canonical/hash cases against the actual collector helpers and
  database-write parameters. The shared taxonomy has eleven channel labels.
- **Syntax/type-checked only, not executed**: the vercel adapter
  (`assets/collector/vercel/api/collect.js`, `node --check`), the
  cloudflare adapter (`assets/collector/cloudflare/worker.js`, `node
  --check`), and the Supabase edge function (`assets/collector/supabase/
  index.ts`, `deno check`). None of these three were deployed or hit with a
  live request: each depends on a hosted binding (Vercel's request/response
  helpers, a Cloudflare Hyperdrive binding, or a running Supabase project)
  this environment doesn't have. Their logic is identical to the node
  adapter (same `handleCollect` import, same CORS/response shape); only the
  request/response plumbing differs per runtime.

## Scale notes

- **Partition monthly.** `pixel.ensure_month_partitions()` keeps the
  previous, current, and near-future months pre-created; schedule it (cron,
  a scheduled function, whatever the deployment already has) at least
  monthly so the `DEFAULT` partition never fills up with live traffic. A
  full `DEFAULT` partition degrades every unfiltered query over `events` and
  makes retention (dropping old partitions) impossible for that data.
- **Index touchpoints for the access pattern you actually have.** This
  schema ships `(visitor_id, occurred_at)` and a partial index on
  `contact_id`; add `(site_key, occurred_at)` or a channel-scoped index if a
  deployment's dashboards filter by those instead.
- **Purge raw IP nightly.** `pixel.purge_raw_ip(retention_days)` NULLs
  `events.ip` and `visitors.last_ip` past the retention window; the hashed
  `visitors.ip_hash` is unaffected and safe to keep indefinitely. Run this
  on a schedule, not on every request.
- **Beyond roughly 10M events/month**, plan to export `pixel.events` (and
  the derived tables) to a warehouse rather than serving analytics queries
  directly off this operational database: partitioned Postgres handles the
  ingest firehose well, but `pixel.sessions` is a window-function view over
  raw events with no materialization, and it will get slower as the table
  grows. Materializing `pixel.sessions`/`pixel.channel_daily` on a schedule,
  or exporting partitions to columnar storage, are both reasonable next
  steps at that scale; which one depends on the deployment's existing
  warehouse story more than anything specific to this schema.

Native ledger-to-money reporting verification is documented in [metrics-handoff-contract.md](metrics-handoff-contract.md).

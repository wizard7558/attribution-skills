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

## `handleCollect` processing order

`assets/collector/core.js` exports `handleCollect(payload, ctx, db)`, run by
every adapter in that order. `assets/collector/package.json` marks the
directory as ES modules; keep it next to `core.js` when you copy the
collector into your project, or add `"type": "module"` to your own
package.json.

1. **Validate** payload shape and sizes. Malformed payloads get `400`
   without touching the database.
2. **Origin check.** Look up `pixel.sites` by `site_key`. An unknown
   `site_key`, or an `Origin` header not in a non-empty `allowed_origins`,
   gets `403`. An empty `allowed_origins` array accepts any origin (useful
   while a new site is still being configured).
3. **Bot filter.** A `User-Agent` matching the bot pattern gets a silent
   `204`: no visitor, event, or touchpoint is written.
4. **Upsert visitor**, keyed on `(site_key, visitor_uid)`.
5. **Hash identity values** when the event carries them (see Identity model
   below).
6. **Insert the event** into `pixel.events`, ip stored raw (retention is a
   separate purge job, not enforced at write time).
7. **Identity resolution**: on `identify`/`form_submit` with an `identity`
   payload, upsert `pixel.contacts` and link it in `pixel.identity_links`,
   then back-fill `contact_id` onto any of this visitor's touchpoints that
   don't have one yet.
8. **Consent**: on a `consent` event, upsert `pixel.consent_state`.
9. **Touchpoint derivation**: see below.
10. **Conversion detection**: every `form_submit` is a conversion; a
    `track` event counts when `properties.is_conversion === true` or its
    `event_name` is one of `purchase`, `generate_lead`, `sign_up`,
    `form_submit`. `value`/`currency` come from `properties` when present
    and numeric/string respectively.
11. Return `204` with no body on success.

## Channel derivation

The numbered legacy description below is historical context only. Runtime classification now
delegates to the shared `channel-taxonomy.mjs` module, whose 11-label contract and precedence
are authoritative. `deriveChannel` remains a stable wrapper; it does not implement separate
rules. `srsltid` is captured and stored but never establishes paid traffic.

The shared module returns exactly one of the 11 canonical labels: Paid Search, Paid Social,
Paid Other, Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate, or Other.
It retains raw signals, maps legacy labels only in the session view, and never treats `srsltid`
as paid evidence. Read the shared taxonomy skill's source mappings for the complete precedence
and native-label mapping.

## Touchpoint derivation and dedup

A `pageview` event creates a `pixel.touchpoints` row when it carries a
source signal (any utm parameter, any click id, or an external referrer
whose host differs from the page's host) **or** when it starts a new
session for that visitor: defined as no prior `pageview`/`track`/
`form_submit` event for that visitor in the preceding 30 minutes, the same
inactivity window `pixel.sessions` itself sessionizes on.

That second condition is broader than "the visitor's very first event ever":
a returning visitor's first pageview after a 30-minute gap also gets a
touchpoint, even when it carries no signal. Legacy sessions without a
touchpoint infer Direct only from a valid signal-free landing URL; otherwise
they emit Other with `legacy/unclassified`.

Once a touchpoint is going to be created, it's deduped: if an existing
touchpoint for the same visitor and the same derived channel already exists
within the preceding 30 minutes, no new row is inserted. A visitor who
lands with `utm_source=google&utm_medium=cpc`, then clicks two more internal
pages within that window, gets one Paid Search touchpoint, not three.

Touchpoints created before identity resolution start with `contact_id =
NULL`. Once the visitor resolves to a contact (via `identify` or
`form_submit`), two things happen: every touchpoint already recorded for
that visitor with a `NULL` `contact_id` is back-filled, and every
touchpoint or conversion created by a *later* event on that visitor is
stamped with the resolved `contact_id` immediately (each `handleCollect`
call is a fresh invocation with no in-memory state, so this requires an
explicit lookup against `pixel.identity_links` at the top of the handler,
not just the retroactive back-fill).

## Identity model

Identity resolution is deliberately narrow: **email and phone only, never
IP**. `pixel.contacts` and `pixel.identity_links` form a bipartite,
append-only graph:

- A contact is created from a canonicalized, hashed email (`trim` +
  `lowercase`, then sha256 hex) and/or phone (digits, with a leading `+`
  preserved when the source value had one, then sha256 hex). Either
  identifier alone is enough to create a contact row.
- `pixel.identity_links` rows are never deleted or updated to point
  elsewhere. A visitor can link to more than one contact (shared devices,
  re-identifying under a different email on the same device); a contact can
  be reached from more than one visitor (the same person on their phone and
  laptop). Merging two visitors' history under one contact is additive:
  insert a new link row, never destructive.
- Raw email/phone values never reach `pixel.contacts` unhashed except in
  `email_canonical`/`phone_e164`, which exist for support/debugging lookups;
  if that's more PII retention than a deployment wants, drop those two
  columns and keep only the hash columns: nothing else in the schema reads
  them.
- IP addresses are never part of identity resolution. `visitors.ip_hash` is
  a salted hash used only for fraud/rate-limit heuristics, never joined to
  `pixel.contacts`.

## Sessionization

`pixel.sessions` groups a visitor's `pageview`/`track`/`form_submit` events
(not `identify`/`consent`) into sessions using a 30-minute inactivity
window: a new session starts on a visitor's first captured event, or after
30 minutes with no captured event. Each session's `channel` comes from the
first touchpoint whose `occurred_at` falls inside that session's time
window; see "Touchpoint derivation and dedup" above for why that's normally
present even for Direct sessions. A legacy session with no touchpoint uses the
valid signal-free landing fallback described above.

`pixel.channel_daily` aggregates `pixel.sessions` to `(source_scope, event_date,
channel)` grain, with `event_date` as the UTC calendar date of
`session_start_ts`.

### Column-name parity with `ga4-bigquery-export`

`pixel.sessions` and `pixel.channel_daily` intentionally reuse the sibling
`ga4-bigquery-export` skill's column vocabulary where the concepts overlap,
so a query or dashboard written against one source ports to the other with
a rename, not a rebuild:

| Concept | This skill (`pixel.sessions` / `pixel.channel_daily`) | `ga4-bigquery-export` (`sessions.sql` / `channel_daily.sql`) |
|---|---|---|
| Session identifier | `session_key` | `session_key` |
| Session start/engagement | `session_start_ts`, `engaged`, `engagement_time_sec` | `MIN(event_timestamp)`, `engaged`, engagement seconds |
| Landing/exit page | `landing_page_path`, `landing_page_location`, `exit_page_path` | `landing_page_path` (see `landing_pages.sql`) |
| Referrer | `first_referrer` | referrer fields off `session_traffic_source_last_click` |
| Session-grain source/medium | `session_source`, `session_medium`, `session_campaign` | `source`, `medium` (see `sessions.sql`) |
| Channel label | `channel` (11-value shared vocabulary) | `default_channel_group` / rebuilt channel (see `channel_rules.md`) |
| Daily grain | `source_scope`, `event_date`, `sessions`, `engaged_sessions`, `new_users` | `event_date`, `sessions`, `engaged_sessions`, `new_users` |
| Conversion grain | `conversions`, `conversion_value` | `key_events`, `purchase_revenue_in_usd` |

The channel label sets are close but not identical (GA4 also emits `Paid
Shopping`, `Cross-network`, `Organic Shopping`, `Organic Video`, and `AI
Assistant`, which this schema has no click-based or first-party signal to
distinguish), treat the mapping as "same shape of table, comparable but not
byte-identical channel taxonomy," and reconcile the difference explicitly
rather than assuming a 1:1 join.

## Running the verification scripts

`taxonomy-parity.mjs` is a repository-only parity check against the shared synthetic fixture
file. The disposable `roundtrip.sh` smoke test is standalone: it copies the generated collector
module and exercises the collector/Postgres chain without invoking the sibling fixture check.

`scripts/roundtrip.sh` is self-contained and has no Git or sibling-skill dependency in its
default mode. It copies the generated collector module from the skill directory. Run
`scripts/roundtrip.sh --migration` separately when the checkout contains commit `2c240a3`; that
mode applies the historical schema first and verifies the upgrade path.
The default copied-skill smoke currently reports 18 assertions; repository `--migration` mode
reports those 18 plus 2 historical-schema assertions.

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
purchase), and checks nine assertions covering visitor/event/touchpoint/
contact/identity-link/conversion counts, the back-fill, and both views. It
prints `PASS`/`FAIL` per assertion and exits non-zero on any failure. It
always stops the collector process and, if it started one, the Postgres
cluster, even on failure.

## What was executed vs. syntax/type-checked

- **Executed end-to-end**, repeatedly, via `scripts/roundtrip.sh`: `assets/
  schema.sql` (including `ensure_month_partitions`, the `sessions` and
  `channel_daily` views), `assets/collector/core.js`, and the **node**
  adapter (`assets/collector/node/server.js`).
- **Executed in a jsdom-simulated browser**: `assets/pixel.js` (pageview +
  `track` calls, click-id/utm capture, `sendBeacon` payload shape).
- **Unit-tested directly**: `deriveChannel` (19 cases covering all 12
  channel labels).
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

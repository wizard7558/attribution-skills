---
name: first-party-pixel
description: Help a website owner stand up a first-party tracking pixel, a collector endpoint, and a Postgres database that store clickstream, identity, and conversion data the owner controls directly. Runs an intake step before building anything, asking which platforms the user already has accounts on so the build lands inside their existing project, organization, and billing, then writes every choice to pixel.config.json. Use this skill when a user wants to own their web analytics data, asks for a first-party pixel or tracking script, wants to collect clickstream into Postgres, wants to replace or complement GA4, needs to capture UTMs and click IDs without a third-party cookie, wants identity stitching from form submissions, or wants consent-aware tracking tied to a CMP or Global Privacy Control.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1"
---

# First-party pixel

## When to use this skill

Use this skill when the user wants a tracking pixel and collector they own: a script tag on
their site, an endpoint that receives the events, and a Postgres database that stores the raw
clickstream, an identity graph, and conversion events, on infrastructure the user controls.

Do not use this skill for:
- **App or mobile SDK tracking.** This skill builds a browser script for a website. It does
  not cover iOS, Android, or React Native event SDKs.
- **Ad-platform pixels needed for optimization** (Meta Pixel, Google Ads tag, TikTok Pixel).
  Those exist to feed each platform's own optimization and retargeting, and this skill's
  pixel runs alongside them, not instead of them. Building this pixel does not remove the
  need for platform pixels if the user is running paid media.
- **A user who already has PostHog, Segment, or Snowplow and only lacks attribution fields**
  (channel, UTMs, click IDs). Read `references/existing-tools.md` first - the fix is usually
  smaller than a new pixel and collector.

If the user says "own my analytics data," "first-party pixel," "tracking script," "collect
clickstream into Postgres," "replace GA4," "capture UTMs and click IDs," "identity stitching,"
or "consent-aware tracking," this skill applies.

## Step 0: Ask before you build

Do not provision anything, write any code, or create any account before the user answers the
intake questions below. Ask all of them in one message: use a structured question tool if the
agent has one, otherwise a single numbered list in chat. Accept free-text answers - a user
typing "we're on Vercel and Neon" answers three questions at once. Apply the stated default to
any question left unanswered. After the user responds, write `pixel.config.json` in the
project root and echo the full file back to the user for confirmation before proceeding to
Step 1.

The first question is always which platforms the user already has an account or project on.
The answer changes the default for every later question: an existing account always wins over
creating a new one, and every resource this skill provisions lands inside the user's existing
organization, project or team, region, and billing rather than a fresh one. For example, a
user who already has Vercel and Neon gets a Vercel collector and a Neon database by default,
not a new Supabase project.

| # | Question | Options | Default | Why it matters |
|---|---|---|---|---|
| 1 | Which of these do you already have an account or project on? | supabase, neon, vercel, cloudflare, gcp, aws, railway, render, fly, tag-manager, posthog, segment, ga4-export, none | none | Sets the default for every question below; existing account wins |
| 2 | What's the site's domain and platform? | domain (free text); platform: nextjs, webflow, shopify, wordpress, squarespace, wix, html, tag-manager | ask, no default | Determines install method (Step 4) |
| 3 | Which database should store events? | supabase, neon, existing, local | from Q1, else supabase | Determines schema deploy target (Step 1) |
| 4 | Which runtime should host the collector? | supabase-edge, vercel, cloudflare, node | from Q1, else supabase-edge | Determines which adapter to deploy (Step 2) |
| 5 | Where should the pixel live? | first-party-subdomain, collector-url, tag-manager | first-party-subdomain if the user controls DNS, else collector-url | First-party subdomain avoids third-party cookie treatment in more browsers |
| 6 | Which forms capture identity, and on what events? | forms: hubspot, jotform, typeform, calendly, native; identify_on: form_submit, login | native; form_submit | Determines identity wiring (Step 6) |
| 7 | What consent mode and CMP? | mode: required, anonymous-until-consent, none; cmp: cookiebot, onetrust, klaro, custom, none | by region, see `references/consent-and-privacy.md` | Gates cookie writes and event sends (Step 5) |
| 8 | IP retention days and salt env var? | integer days; env var name | 7 days; `PIXEL_IP_SALT` | Sets the purge job and hashing (compliance) |
| 9 | Downstream warehouse? | none, bigquery, snowflake | none | Determines whether to wire a nightly export (Outputs) |

The full question bank, every option's tradeoffs, conditional follow-ups, the copy-ready
intake message, and two fully filled `pixel.config.json` examples are in
`references/intake.md`. Read it before running Step 0 on a real user.

## Compatibility

Not every database provider works with every collector runtime the same way. Check
`references/compatibility.md` before Step 1 if the user's Q1 and Q3/Q4 answers combine a
database provider with a runtime that needs a connection-method note or a fallback.

| Database ↓ / Runtime → | supabase-edge | vercel | cloudflare | node |
|---|---|---|---|---|
| supabase | Supported | Supported with note (pooler) | Supported with note (pooler) | Supported |
| neon | Not recommended | Supported | Supported with note (Hyperdrive) | Supported |
| existing | Supported with note | Supported with note | Supported with note | Supported |
| local | Not recommended | Not recommended | Not recommended | Supported |

Full matrix with connection methods and fallbacks, plus pixel-hosting × DNS-access and
site-platform × install-method matrices: `references/compatibility.md`.

## Build workflow

Work through these in order. Each step names the reference to read and the check that must
pass before moving on.

**1. Provision or reuse the database, apply the schema.**
Read `references/providers/<database.provider>.md` for the exact CLI flow to detect an
existing project or create one inside the user's existing org. Apply `assets/schema.sql`
against the `pixel` schema.
Check: `SELECT schemaname FROM pg_tables WHERE schemaname = 'pixel';` returns rows for
`sites`, `visitors`, `events`, `touchpoints`, `contacts`, `identity_links`,
`conversion_events`, `consent_state`.

**2. Deploy the collector.**
Read `references/providers/<collector.runtime>.md` for the deploy command for that runtime
and the adapter file it uses (`assets/collector/node/server.js`,
`assets/collector/vercel/api/collect.js`, `assets/collector/supabase/index.ts`, or
`assets/collector/cloudflare/worker.js`, all built on `assets/collector/core.js`). Set
secrets `DATABASE_URL`, `PIXEL_IP_SALT` (or the env name from Q8), and the allowed-origins
list (the site's domain).
Check: `curl -i <collector.url>/collect` returns a response (405 or 200 depending on the
adapter's method handling), not a connection or auth error.

**3. Point the subdomain at the collector.**
Only if `pixel.hosting = first-party-subdomain`. Read the DNS section of
`references/providers/<collector.runtime>.md`.
Check: `dig <pixel.subdomain>` resolves, and `curl -i https://<pixel.subdomain>/collect`
reaches the collector.

**4. Install the pixel snippet.**
Read `references/install/<site.platform>.md` for where the snippet goes and any
platform-specific handling (SPA route changes, sandbox restrictions).
Check: the script tag is present in the rendered page source with the correct
`data-site-key`, `data-endpoint`, and `data-consent-mode`.

**5. Wire consent mode and the CMP.**
Read `references/consent-and-privacy.md` for the hook points of the chosen CMP.
Check: in `required` mode, no `_fpv` cookie is set and no event reaches the
collector before the CMP fires its accept callback.

**6. Wire identity: forms and identify calls.**
For each form tool in `identity.forms`, wire its submit event (webhook or client callback) to
call `window.fpx('identify', { email, ... })`. For `login`, call the same on session start
after auth.
Check: submitting a test form on the live site produces a row in `contacts` and a matching
row in `identity_links` linking the form's identifier to the visitor id.

**7. Run the round-trip verification.**
Run `scripts/roundtrip.sh` (or `scripts/simulate.mjs` for a scripted multi-event run). Load a
tagged URL (`?utm_source=...`), submit the test form from Step 6, then confirm rows in
`visitors`, `events`, `touchpoints`, `contacts`, and `identity_links`, and confirm the
`sessions` and `channel_daily` views return the new session and its channel.
Check: all five tables have the new rows, and `SELECT * FROM pixel.channel_daily WHERE
event_date = CURRENT_DATE` includes the test session's channel.

Implementation details for every adapter and the schema: `references/implementation.md`.

## Compliance rules (non-negotiable)

These hold regardless of which options the user picked in Step 0:

- In `required` consent mode, no cookie is written and no event leaves the browser before the
  CMP records acceptance.
- IP addresses are hashed with `privacy.hash_salt_env` before storage, and the raw IP is
  purged after `privacy.ip_retention_days` days. Never store a raw IP indefinitely.
- Never put an email address or phone number in a URL, query string, or GET request.
- Honor Global Privacy Control (`Sec-GPC: 1`): treat it as a withdrawal of consent for
  `anonymous-until-consent` and `required` modes.
- Document this collection in the user's privacy policy. See
  `references/consent-and-privacy.md` for what to include.

This is engineering guidance, not legal advice. Point the user to counsel for a jurisdiction
determination, especially outside the regions this skill has defaults for.

## Operating limits

A small managed Postgres instance handles this workload comfortably to roughly 10 million
events a month. Past that, rely on the schema's monthly partitions for pruning and add a
nightly export to a warehouse rather than scaling Postgres compute indefinitely. If
`downstream.warehouse` is set, wire the export using the sessionization and channel-grouping
patterns in the `ga4-bigquery-export` skill so the output shapes match; if it is `none`, skip
this and revisit if event volume grows.

## Outputs

The schema exposes two views for downstream use, matching the column names and channel labels
(Display, Paid Search, Paid Social, Paid Other, Organic Search, Email, SMS, Affiliates,
Referral, Organic Social, Direct, Unassigned) of the `ga4-bigquery-export` skill's outputs, so
downstream attribution work is source-agnostic:

- **`sessions`** - one row per session: visitor, timing, landing/exit pages, source, medium,
  channel, click ids.
- **`channel_daily`** - one row per date × channel: sessions, engaged sessions, new visitors,
  conversions.

Downstream attribution skills (multi-touch modeling, spend-join, MMM inputs) should read these
two views rather than querying `pixel.events` directly.

## References

- `references/intake.md` - full intake question bank, conditional follow-ups, the copy-ready
  intake message, and two filled `pixel.config.json` examples.
- `references/compatibility.md` - database × runtime, pixel-hosting × DNS-access, and
  site-platform × install-method matrices with connection methods and fallbacks.
- `references/providers/supabase.md`, `references/providers/neon.md`,
  `references/providers/vercel.md`, `references/providers/cloudflare.md`,
  `references/providers/existing-postgres.md`, `references/providers/local.md` - per-provider
  account detection, resource creation inside an existing org, connection strings, adapter
  deploy, custom domain steps, and free-tier limits.
- `references/install/tag-manager.md`, `references/install/webflow.md`,
  `references/install/shopify.md`, `references/install/wordpress.md`,
  `references/install/nextjs.md`, `references/install/squarespace-wix.md`,
  `references/install/html.md` - snippet placement per site platform.
- `references/consent-and-privacy.md` - consent modes, CMP hook points, Global Privacy
  Control, retention, and privacy-policy language.
- `references/existing-tools.md` - what to do when the user already runs PostHog, Segment,
  Snowplow, or a GA4 BigQuery export.
- `references/eval.md` - 3 evaluation prompts with pass/fail checklists.
- `references/implementation.md` - owned by the collector/pixel implementation, covers
  `assets/schema.sql`, `assets/pixel.js`, `assets/collector/*`, and `scripts/*` internals.
- `assets/schema.sql` - Postgres 14+ schema `pixel`: tables, monthly-partitioned events,
  views, and maintenance functions.
- `assets/pixel.js` - the browser pixel script.
- `assets/collector/core.js` and the per-runtime adapters under `assets/collector/`.
- `scripts/roundtrip.sh` - local end-to-end test.
- `scripts/simulate.mjs` - scripted multi-event simulation.

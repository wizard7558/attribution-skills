# Intake question bank

Ask every question in this file in a single message before provisioning anything (see "How to
ask" below). For each question: the id, the exact text to ask, the options with a one-line
tradeoff each, the default, the follow-ups it triggers, and the `pixel.config.json` field(s)
it sets.

## 1. Existing accounts

**Ask:** "Which of these do you already have an account or project on? Pick any that apply, or
say none: Supabase, Neon, Vercel, Cloudflare, Google Cloud, AWS, Railway, Render, Fly, Google
Tag Manager, PostHog, Segment, a GA4 BigQuery export, or a Postgres database you already run."

| Option | Tradeoff |
|---|---|
| `supabase` | Managed Postgres plus an edge-function runtime in one project; good default if the user has nothing yet |
| `neon` | Managed serverless Postgres with branching; pairs well with Vercel or Cloudflare |
| `vercel` | Best collector fit for Next.js sites; needs a database provider from elsewhere unless the user also has Supabase or Neon |
| `cloudflare` | Best collector fit for lowest cold-start latency at the edge; needs Hyperdrive or the Neon serverless driver to reach Postgres |
| `gcp` | Only relevant if `downstream.warehouse = bigquery`; not a database or collector target for this skill |
| `aws` | Only relevant if the user wants a self-managed RDS Postgres as `database.provider = existing` |
| `railway`, `render`, `fly` | All work as `collector.runtime = node` deploy targets; treat as "existing" hosting, not a first-class runtime in `assets/collector/` |
| `tag-manager` | If the user manages tags through GTM, pixel hosting can be `tag-manager` instead of a subdomain |
| `posthog`, `segment` | Signals the user already has an event pipeline; read `references/existing-tools.md` before continuing the intake |
| `ga4-export` | Signals the user already has session-level GA4 data in BigQuery; this pixel can add identity and forms rather than duplicate sessions |
| "a Postgres I already run" | Sets `database.provider = existing` |

**Default:** none selected (fresh build, defaults to Supabase for database and collector).

**Sets:** `existing_accounts` (array). This question's answer changes the default of every
question below - re-derive each later default from this array before falling back to the
skill-wide default.

**Follow-up:** if `posthog`, `segment`, or a Snowplow mention appears, stop and read
`references/existing-tools.md` before asking question 3 onward. Confirm with the user which of
that file's three options (run alongside, forward events, add fields only) they want before
proceeding, since it can remove the need for some later questions.

## 2. Site domain and platform

**Ask:** "What's the site's domain, and what platform is it built on: Next.js, Webflow,
Shopify, WordPress, Squarespace, Wix, plain HTML, or do you manage tags through Google Tag
Manager?"

**Default:** no default; ask until answered, since domain and platform gate the install step.

**Sets:** `site.domain`, `site.platform`.

**Follow-up:** platform answer selects which file under `references/install/` applies in
Step 4.

## 3. Database provider

**Ask:** "Where should the event data live: a new Supabase project, a new Neon project, a
Postgres database you already run, or a local Postgres for testing only?"

| Option | Tradeoff |
|---|---|
| `supabase` | One project holds both the database and (optionally) the collector; simplest single-vendor path |
| `neon` | Serverless scale-to-zero Postgres; branching is useful for a staging collector; needs a separate collector runtime |
| `existing` | No new account, reuses the user's current Postgres; connection method depends on where it's hosted |
| `local` | Development only - never point a production collector at a local database |

**Default:** if `supabase` is in `existing_accounts`, default `supabase`; else if `neon` is in
`existing_accounts`, default `neon`; else if the user named any other existing Postgres,
default `existing`; else default `supabase`.

**Sets:** `database.provider`, `database.connection_env` (default `DATABASE_URL`),
`database.schema` (default `pixel`), `database.region` (from Q1's matching account's region if
known, else ask).

**Follow-up:** read `references/providers/<database.provider>.md` for provisioning steps.

## 4. Collector runtime

**Ask:** "Which runtime should run the collector that receives pixel events: a Supabase edge
function, a Vercel function, a Cloudflare Worker, or a plain Node server?"

| Option | Tradeoff |
|---|---|
| `supabase-edge` | Zero extra hosting if the database is already Supabase; Deno runtime |
| `vercel` | Best fit if the site itself deploys on Vercel; Node or edge runtime depending on config |
| `cloudflare` | Lowest latency globally; requires Hyperdrive or the Neon serverless driver for Postgres access |
| `node` | Runs anywhere with a long-lived process (Railway, Render, Fly, a VM); simplest to reason about, but the user must manage uptime |

**Default:** if `vercel` is in `existing_accounts`, default `vercel`; else if `cloudflare` is
in `existing_accounts`, default `cloudflare`; else if `database.provider = supabase`, default
`supabase-edge`; else default `node`.

**Sets:** `collector.runtime`, `collector.url` (filled in after deploy in Step 2).

**Follow-up:** check `references/compatibility.md` for the chosen database × runtime cell
before deploying; some combinations need a specific connection method or a fallback.

## 5. Pixel hosting and DNS access

**Ask:** "Should the pixel load from a subdomain of your own site (recommended, needs DNS
access), directly from the collector's URL, or through Google Tag Manager?"

| Option | Tradeoff |
|---|---|
| `first-party-subdomain` | Best cookie survivability across browsers; requires the user to add a DNS record |
| `collector-url` | No DNS change needed; the pixel and collector share an origin different from the site's apex, which some browsers still treat as less first-party |
| `tag-manager` | Fits users who already manage all tags through GTM; consent gating happens in GTM's trigger, not only in the pixel |

**Default:** `first-party-subdomain` if the user confirms they can add a DNS record for the
site's domain; otherwise `collector-url`.

**Sets:** `pixel.hosting`, `pixel.subdomain` (only if `first-party-subdomain`), `pixel.site_key`
(generated by the skill, not asked).

**Follow-up:** if `first-party-subdomain`, ask which DNS provider manages the domain (Cloudflare,
another registrar) - this determines the exact steps in Step 3.

## 6. Identity: forms and identify points

**Ask:** "Which forms on your site should identify a visitor - HubSpot, JotForm, Typeform,
Calendly, or a native HTML form? And should identity attach on form submit, on login, or both?"

**Default:** `forms: ["native"]`, `identify_on: ["form_submit"]`.

**Sets:** `identity.forms`, `identity.identify_on`.

**Follow-up:** for each tool named, Step 6 of the build workflow wires that tool's submit
event to `window.fpx('identify', ...)`.

## 7. Consent regime and CMP

**Ask:** "What regions do your visitors come from, and do you use a consent management
platform - Cookiebot, OneTrust, Klaro, a custom one, or none?"

| Region signal | Default `consent.mode` |
|---|---|
| EU, UK, or Switzerland traffic | `required` |
| California traffic, no EU/UK/Switzerland | `anonymous-until-consent` |
| US-only, no California-specific requirement named | `none` (but `anonymous-until-consent` recommended) |

**Default CMP:** `none` unless named.

**Sets:** `consent.mode`, `consent.cmp`, `consent.regions`.

**Follow-up:** read `references/consent-and-privacy.md` for the exact hook points of the named
CMP before Step 5 of the build workflow.

## 8. Retention and data region

**Ask:** "How many days should raw IP addresses be kept before they're purged? And which
region should the database run in - same as your app, or something else?"

**Default:** `privacy.ip_retention_days = 7`, `privacy.hash_salt_env = PIXEL_IP_SALT`,
`privacy.store_raw_identifiers = true`, `database.region` = same region as the account named
in Q1 (Vercel, Supabase, Neon, or Cloudflare project region), or `us-east-1` if none named.

**Sets:** `privacy.ip_retention_days`, `privacy.hash_salt_env`, `privacy.store_raw_identifiers`,
`database.region`.

## 9. Downstream warehouse

**Ask:** "Do you already export GA4 to BigQuery, or want events exported to a warehouse -
BigQuery, Snowflake, or none for now?"

**Default:** `downstream.warehouse = none`. If `ga4-export` is in `existing_accounts`, set
`downstream.ga4_export = true` regardless of the warehouse answer.

**Sets:** `downstream.ga4_export`, `downstream.warehouse`, `downstream.output_shapes` (default
`["sessions", "channel_daily"]`).

## How to ask

**Copy-ready single message for plain-chat agents:**

> Before I build anything, a few questions - answer as many or as few as you want, and I'll
> use sensible defaults for the rest:
>
> 1. Which of these do you already have an account or project on? Supabase, Neon, Vercel,
>    Cloudflare, Google Cloud, AWS, Railway, Render, Fly, Google Tag Manager, PostHog, Segment,
>    a GA4 BigQuery export, or a Postgres you already run - or none.
> 2. What's the site's domain, and what's it built on (Next.js, Webflow, Shopify, WordPress,
>    Squarespace, Wix, plain HTML, or GTM)?
> 3. Where should event data live - a new Supabase project, a new Neon project, your existing
>    Postgres, or local for testing?
> 4. Which runtime should run the collector - Supabase edge function, Vercel function,
>    Cloudflare Worker, or a Node server?
> 5. Should the pixel load from a subdomain of your site, directly from the collector's URL, or
>    through GTM? (A subdomain needs DNS access.)
> 6. Which forms should identify a visitor, and when - form submit, login, or both?
> 7. What regions are your visitors in, and do you use a consent platform (Cookiebot, OneTrust,
>    Klaro, custom, none)?
> 8. How many days should raw IPs be kept before purge? Default is 7.
> 9. Export events to a warehouse (BigQuery, Snowflake) or keep them in Postgres only?

**Note for agents with a structured question tool:** ask questions 1-9 as one structured batch
rather than the numbered message, using the option lists in this file as the choices for each
field. Still write and echo back `pixel.config.json` after the batch resolves.

## Example: Webflow site, existing Vercel and Neon

```json
{
  "site": { "domain": "example.com", "platform": "webflow" },
  "existing_accounts": ["vercel", "neon"],
  "database": { "provider": "neon", "connection_env": "DATABASE_URL", "schema": "pixel", "region": "us-east-1" },
  "collector": { "runtime": "vercel", "url": "https://t.example.com/collect" },
  "pixel": { "hosting": "first-party-subdomain", "subdomain": "t.example.com", "site_key": "GENERATED" },
  "identity": { "forms": ["native"], "identify_on": ["form_submit"] },
  "consent": { "mode": "none", "cmp": "none", "regions": [] },
  "privacy": { "ip_retention_days": 7, "hash_salt_env": "PIXEL_IP_SALT", "store_raw_identifiers": true },
  "downstream": { "ga4_export": false, "warehouse": "none", "output_shapes": ["sessions", "channel_daily"] }
}
```

## Example: Shopify store, no existing accounts

```json
{
  "site": { "domain": "example.com", "platform": "shopify" },
  "existing_accounts": [],
  "database": { "provider": "supabase", "connection_env": "DATABASE_URL", "schema": "pixel", "region": "us-east-1" },
  "collector": { "runtime": "supabase-edge", "url": "https://t.example.com/collect" },
  "pixel": { "hosting": "first-party-subdomain", "subdomain": "t.example.com", "site_key": "GENERATED" },
  "identity": { "forms": ["native"], "identify_on": ["form_submit"] },
  "consent": { "mode": "anonymous-until-consent", "cmp": "none", "regions": ["us"] },
  "privacy": { "ip_retention_days": 7, "hash_salt_env": "PIXEL_IP_SALT", "store_raw_identifiers": true },
  "downstream": { "ga4_export": false, "warehouse": "none", "output_shapes": ["sessions", "channel_daily"] }
}
```

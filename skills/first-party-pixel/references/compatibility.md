# Compatibility matrices

Check these before Step 1 and Step 4 of the build workflow. "Supported with note" means the
combination works but needs a specific connection method or setting called out below, not the
default one. "Not recommended" always names a fallback - never leave the user without a
path.

## Database provider × collector runtime

| Database ↓ / Runtime → | supabase-edge | vercel | cloudflare | node |
|---|---|---|---|---|
| **supabase** | Supported | Supported with note | Supported with note | Supported |
| **neon** | Not recommended | Supported | Supported with note | Supported |
| **existing** | Supported with note | Supported with note | Supported with note | Supported |
| **local** | Not recommended | Not recommended | Not recommended | Supported |

**supabase × supabase-edge** - Connect with the Supabase pooler (Supavisor) in transaction
mode, port 6543: `postgres://postgres.<project-ref>:[PASSWORD]@aws-<region>.pooler.supabase.com:6543/postgres`.
Edge functions are short-lived and open many transient connections, so transaction mode is
required, not the direct connection. See `references/providers/supabase.md`.

**supabase × vercel** - Supported with note: use the same transaction-mode pooler connection
string as above, not the direct `db.<project-ref>.supabase.co:5432` connection. Vercel
functions are also short-lived.

**supabase × cloudflare** - Supported with note: same transaction-mode pooler string. Workers
can reach the pooler directly over TCP with the `node:net`-compatible Postgres driver, or route
through Hyperdrive for connection pooling and lower latency; Hyperdrive is optional here since
Supavisor already pools.

**neon × supabase-edge** - Not recommended: mixing a Supabase database instance's edge
runtime with a Neon database adds a cross-vendor network hop with no pooling benefit over
using Neon's own instant Postgres branching from a Vercel or Node runtime instead. Fallback: pick
`collector.runtime = vercel` or `node` instead.

**neon × vercel** - Supported: use Neon's pooled connection string
(`neonctl connection-string --pooled`) or the `@neondatabase/serverless` driver over HTTP/WebSocket,
which avoids TCP connection limits entirely on Vercel's serverless functions. See
`references/providers/neon.md`.

**neon × cloudflare** - Supported with note: Cloudflare Workers cannot open raw TCP sockets to
Postgres without either Hyperdrive (`wrangler hyperdrive create`, pointed at Neon's pooled
connection string) or the `@neondatabase/serverless` driver, which speaks Postgres over
HTTP/WebSocket and needs no Hyperdrive binding. Prefer the serverless driver for a Neon +
Cloudflare pair; use Hyperdrive if the collector also needs to reach a non-Neon Postgres.

**neon × node** - Supported: a long-lived Node process can use Neon's direct (non-pooled)
connection string for a single persistent connection, or the pooled string if the process
spawns many short queries.

**existing × any runtime** - Supported with note: the connection method depends entirely on
where the existing Postgres runs. If it accepts direct TCP connections from the public
internet (a VM, RDS with a public endpoint), any runtime with a TCP-capable Postgres driver
works, but a serverless runtime (`supabase-edge`, `vercel`, `cloudflare`) should sit behind a
connection pooler (PgBouncer or the provider's own pooler) to avoid exhausting the database's
max-connections limit under bursty pixel traffic. If it is not reachable from the public
internet, `collector.runtime = node` running inside the same network is the only supported
path; fall back to that if the database is VPC-only. See
`references/providers/existing-postgres.md`.

**local × any serverless runtime** - Not recommended: a local Postgres is not reachable from a
hosted serverless function. Fallback: `collector.runtime = node` running on the same machine,
for development and the round-trip verification (Step 7) only. Never point a deployed
collector at a local database.

## Pixel hosting × DNS access

| Hosting ↓ | User has DNS access | User does not have DNS access |
|---|---|---|
| `first-party-subdomain` | Supported: add a CNAME for the chosen subdomain (for example `t`) pointed at the collector's hostname | Not recommended: fall back to `collector-url` |
| `collector-url` | Supported (no DNS change needed) | Supported (no DNS change needed) |
| `tag-manager` | Supported, DNS optional - GTM can load the pixel from either a subdomain or the collector URL | Supported |

Cloudflare-managed domains: add the CNAME through the Cloudflare dashboard or `wrangler` and
keep it DNS-only (unproxied) if the collector runtime is not itself behind Cloudflare, since
Cloudflare's proxy in front of a non-Cloudflare origin can break certificate provisioning for
that origin. Vercel-managed domains: use `vercel domains` or the dashboard's Domains tab to add
the subdomain and point it at the Vercel deployment; Vercel issues the certificate
automatically. Other DNS providers: add a CNAME record for the subdomain pointed at the
collector's hostname and let the collector runtime's own certificate provisioning (Vercel,
Cloudflare, or Supabase custom domains) issue the certificate.

## Site platform × install method

| Platform | Method | Note |
|---|---|---|
| `nextjs` | Script tag via the framework's script-loading pattern | Needs explicit route-change tracking; see `references/install/nextjs.md` |
| `webflow` | Site-wide custom code (footer) | Applies to every page automatically; see `references/install/webflow.md` |
| `shopify` | Custom pixel sandbox or `theme.liquid` | Custom pixel sandbox is preferred; see `references/install/shopify.md` for the tradeoff |
| `wordpress` | Theme footer include or a snippet plugin | See `references/install/wordpress.md` |
| `squarespace` / `wix` | Site-wide code injection panel | See `references/install/squarespace-wix.md` |
| `html` | Direct `<script>` tag before `</body>` | See `references/install/html.md` |
| `tag-manager` | Custom HTML tag with a consent trigger | See `references/install/tag-manager.md` |

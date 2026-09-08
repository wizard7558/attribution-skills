# Provider: Cloudflare

Covers `collector.runtime = cloudflare`.

## a. Detect an existing account and list projects

```bash
wrangler whoami
```

Shows the authenticated account and the account ID; there is no separate "list projects"
subcommand for Workers the way Supabase or Vercel have one; a Cloudflare account holds all its
Workers under that single account ID, selectable with `--account-id` if the user belongs to
more than one. Verified against:
https://developers.cloudflare.com/workers/wrangler/commands/general/ (the `whoami` section).

## b. Create inside an existing account vs. create new

There is no separate creation step distinct from deploy: the first `wrangler deploy` for a new
`wrangler.toml`/`wrangler.jsonc` name creates the Worker under the authenticated account
identified in (a). Set `account_id` in the Wrangler config (or pass `--account-id`) to the
account that owns the user's other Workers rather than letting Wrangler prompt for a default.

## c. Connection string the collector needs

Cloudflare Workers cannot open raw TCP sockets to Postgres directly. Two supported paths:

- **Hyperdrive** - wraps a standard Postgres connection string (from Supabase, Neon, or any
  TCP-reachable Postgres) in a binding the Worker reads without managing pooling itself:

  ```bash
  npx wrangler hyperdrive create <config-name> --connection-string="postgres://user:password@HOSTNAME:PORT/database_name"
  ```

  Verified against: https://developers.cloudflare.com/hyperdrive/get-started/.

- **Neon serverless driver** (`@neondatabase/serverless`) - only for a Neon database; speaks
  Postgres over HTTP/WebSocket and needs no Hyperdrive binding. Prefer this for a Neon +
  Cloudflare pair; use Hyperdrive for a Supabase or other TCP-reachable Postgres.

## d. Deploy the adapter and set secrets

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put PIXEL_IP_SALT
npx wrangler deploy
```

`wrangler secret put <KEY>` prompts for the value on stdin (or pipe it in, for example
`echo "..." | wrangler secret put PIXEL_IP_SALT`) and creates or updates the secret for the
Worker in `assets/collector/cloudflare/worker.js`. `wrangler deploy` publishes the Worker.
Verified against:
https://developers.cloudflare.com/workers/wrangler/commands/workers/ (the `secret put` and
`deploy` sections).

## e. Custom domain / first-party subdomain

Add a route or a custom domain for the Worker through the dashboard (Workers & Pages > the
Worker > Settings > Domains & Routes) or `wrangler.toml`'s `routes` config, pointing
`pixel.subdomain` at the Worker. If the domain's DNS is on Cloudflare, keep the subdomain's DNS
record proxied (orange-clouded) so the Worker route applies; if DNS is elsewhere, use a CNAME
to the Worker's `workers.dev` hostname or configure a custom hostname per Cloudflare for SaaS,
depending on the account's plan.

## f. Free-tier limits that matter for a pixel

- Workers Free: 100,000 requests per day per account, resetting at midnight UTC. Exceeding it
  returns Error 1027 for the rest of the day.
  Verified against: https://developers.cloudflare.com/workers/platform/limits/.
- A site with sustained traffic above roughly 100,000 pixel/identify calls a day needs the paid
  Workers plan (no daily request limit) before this ceiling becomes a problem.

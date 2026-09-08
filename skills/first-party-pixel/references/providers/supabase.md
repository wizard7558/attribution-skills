# Provider: Supabase

Covers `database.provider = supabase` and `collector.runtime = supabase-edge`.

## a. Detect an existing account and list projects

Check the user is logged in and list what they already have before creating anything new:

```bash
supabase login          # only if not already authenticated
supabase orgs list
supabase projects list
```

`supabase projects list` shows every project the account can see, across all organizations.
`supabase orgs list` shows the organizations available, so a new project can be created inside
the same org as the user's other work rather than a default personal org.
Verified against: https://supabase.com/docs/reference/cli/supabase-projects-list,
https://supabase.com/docs/reference/cli/supabase-orgs-list.

## b. Create inside an existing org vs. create new

If `existing_accounts` includes `supabase`, ask which existing project to use (or link the
skill to a new project inside the same organization the user's other projects live in) rather
than defaulting to a new org. Link the local working directory to the chosen project:

```bash
supabase link --project-ref <project-ref>
```

Verified against: https://supabase.com/docs/reference/cli/supabase-link. If no project exists
yet, create one through the dashboard or `supabase projects create` inside the org identified
in step (a); the CLI docs referenced above list the subcommand but full flag-level creation
behavior should be confirmed against `supabase projects create --help` at run time, since the
non-interactive flags (region, plan, db password) are more likely to change between CLI
versions than `list` output is.

## c. Connection string the collector needs

Apply `assets/schema.sql` using a direct connection (`db.<project-ref>.supabase.co:5432`) for
the one-time DDL. For the collector's runtime connection, use the pooled connection, not the
direct one:

- **Session mode** (`aws-<region>.pooler.supabase.com:5432`) - only if the collector runtime
  holds persistent connections on an IPv4-only network.
- **Transaction mode** (`aws-<region>.pooler.supabase.com:6543`) - the correct choice for
  `supabase-edge`, `vercel`, or `cloudflare`, all of which open many short-lived connections.
  Transaction mode does not support prepared statements; disable them in the Postgres client
  library used by `assets/collector/core.js`.

Verified against: https://supabase.com/docs/guides/database/connecting-to-postgres.

## d. Deploy the adapter and set secrets

For `collector.runtime = supabase-edge`, deploy `assets/collector/supabase/index.ts` as an
edge function and set its secrets:

```bash
supabase functions deploy collect
supabase secrets set DATABASE_URL="postgres://..." PIXEL_IP_SALT="..."
```

Verified against: https://supabase.com/docs/reference/cli/supabase-functions-deploy,
https://supabase.com/docs/reference/cli/supabase-secrets-set.

## e. Custom domain / first-party subdomain

Supabase edge functions are reachable at `https://<project-ref>.supabase.co/functions/v1/collect`
by default. To serve the collector from `pixel.subdomain` (for example `t.example.com`), put a
reverse proxy or a custom-domain-capable layer (Cloudflare Worker route, or the site's own
Vercel/Next.js rewrite) in front of the edge function, since Supabase edge functions do not
take a custom domain directly. If `first-party-subdomain` is chosen with a Supabase collector,
prefer routing the subdomain through Vercel or Cloudflare rewrites rather than expecting
Supabase itself to serve the custom hostname.

## f. Free-tier limits that matter for a pixel

- Free-plan compute is the Nano instance: up to 0.5 GB RAM, 500 MB disk, 60 max direct
  database connections, 200 max connection-pooler clients.
  Verified against: https://supabase.com/docs/guides/platform/compute-and-disk.
- These limits bound how much raw event history a free project can hold before the monthly
  partitions need pruning or exporting; see the Operating limits section of `SKILL.md`.

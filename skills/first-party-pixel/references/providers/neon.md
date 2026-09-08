# Provider: Neon

Covers `database.provider = neon`.

The current Neon CLI binary is `neon`; `neonctl` is a supported alias for the same binary, so
either name works in the commands below. Verified against:
https://neon.com/docs/reference/neon-cli.

## a. Detect an existing account and list projects

```bash
neonctl auth             # only if not already authenticated
neonctl projects list
```

Lists every project the authenticated account can see, or every project shared with the
account. If the account belongs to more than one organization, pass `--org-id` to scope the
list to a specific one. Verified against:
https://neon.com/docs/reference/cli-projects.

## b. Create inside an existing org vs. create new

If `existing_accounts` includes `neon`, ask which existing project to reuse rather than
creating a new one, or create the new project with `--org-id` set to the same organization as
the user's other Neon projects:

```bash
neonctl projects create --name pixel-<site-domain> --org-id <org-id>
```

Neon projects created via the CLI default to the latest major Postgres version; pass
`--pg-version 14` or later explicitly if the target environment requires a specific version
(the schema targets Postgres 14+, so any current default satisfies it).

## c. Connection string the collector needs

```bash
neonctl connection-string [branch] --pooled
```

Returns a pooled connection string that includes the role password. Use `--pooled` for any
serverless or edge collector runtime (`vercel`, `cloudflare`, `supabase-edge`); omit it for a
long-lived `node` process that can hold a direct connection. Add `--role-name` and
`--database-name` only if the branch has more than one role or database. Verified against:
https://neon.com/docs/reference/cli-connection-string.

For `collector.runtime = cloudflare` or `vercel`, prefer the `@neondatabase/serverless` driver
over a raw TCP pooled connection where the adapter supports it - it speaks Postgres over
HTTP/WebSocket, which avoids per-invocation TCP handshake cost entirely on both runtimes.

## d. Deploy the adapter and set secrets

Neon has no compute runtime of its own; deploy the collector adapter for whichever
`collector.runtime` was chosen (`references/providers/vercel.md` or
`references/providers/cloudflare.md`) and set `DATABASE_URL` to the connection string from (c)
plus `PIXEL_IP_SALT` using that runtime's own secret-setting command.

## e. Custom domain / first-party subdomain

Neon does not serve HTTP traffic itself; the first-party subdomain points at the collector
runtime (Vercel, Cloudflare, or the Node host), not at Neon. Follow the custom-domain steps in
that runtime's provider file.

## f. Free-tier limits that matter for a pixel

- Free plan: 0.5 GB storage per project, 100 CU-hours per project per month (enough to run a
  0.25 CU compute for roughly 400 hours a month), compute up to 2 CU, and autosuspend after 5
  minutes of inactivity that cannot be disabled on the free plan.
  Verified against: https://neon.com/docs/introduction/plans.
- Autosuspend means the first request after idle time pays a cold-start cost while compute
  resumes; for a pixel collector with steady traffic this is rarely hit, but a low-traffic site
  should expect an occasional slow first request.

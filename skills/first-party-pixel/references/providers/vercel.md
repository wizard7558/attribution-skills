# Provider: Vercel

Covers `collector.runtime = vercel`.

## a. Detect an existing account and list projects/teams

```bash
vercel whoami
vercel teams list
```

`vercel whoami` confirms the authenticated user. `vercel teams list` lists every team the
account belongs to (alias: `vercel teams ls`); pick the team that owns the user's other
projects rather than defaulting to the personal account. Verified against:
https://vercel.com/docs/cli/whoami, https://vercel.com/docs/cli/teams.

## b. Create inside an existing project vs. create new

Link the local working directory to an existing Vercel project, or create a new one inside the
team identified in (a):

```bash
vercel link --yes --project <project-name> --scope <team-slug>
```

`--yes` skips the interactive prompts and answers them with the given project and the current
directory; `--scope` (or `--team`) targets the team so the project lands in the user's existing
organization rather than a new one. Verified against: https://vercel.com/docs/cli/link.

## c. Connection string the collector needs

Vercel does not host Postgres itself. The collector reads `DATABASE_URL` from whichever
database provider was chosen (see `references/providers/supabase.md` or
`references/providers/neon.md` for the exact pooled connection string to use, since Vercel
functions are short-lived and need a pooled or HTTP-based connection, not a direct one).

## d. Deploy the adapter and set secrets

Deploy `assets/collector/vercel/api/collect.js` as part of the linked project's normal deploy:

```bash
vercel env add DATABASE_URL production
vercel env add PIXEL_IP_SALT production
vercel deploy --prod
```

`vercel env add <name> <environment>` prompts for the value (or reads it from stdin); do not
pass the value as a second positional argument. Verified against:
https://vercel.com/docs/cli/env.

## e. Custom domain / first-party subdomain

Add the subdomain to the project through the dashboard's Domains tab, or `vercel domains add
<subdomain>` followed by `vercel domains inspect` to confirm the DNS record needed; Vercel
issues the TLS certificate automatically once the CNAME resolves.

## f. Free-tier limits that matter for a pixel

- Hobby plan: 1,000,000 function invocations included per month.
  Verified against: https://vercel.com/docs/functions/usage-and-pricing.
- A pixel firing on every pageview and identify call can reach this ceiling on a
  moderate-traffic site faster than the database's own free-tier limits; treat invocation
  count, not only database storage, as a capacity signal on Hobby.

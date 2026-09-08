# Provider: local

Covers `database.provider = local` - a Postgres running on the same machine as the agent, for
development and the round-trip verification in Step 7 only. Never point a deployed collector
at a local database.

## a. Detect what exists

Check for a running local Postgres before starting one:

```bash
pg_isready
```

If nothing is running, start one with whatever the user already has installed (Postgres.app,
Homebrew's `postgresql` service, or a `docker run postgres:14` container). This skill does not
prescribe which; use what is already on the machine.

## b. Create inside the existing instance vs. create new

Create a dedicated local database rather than reusing an existing one, to avoid colliding with
any other project's tables:

```bash
createdb pixel_dev
```

## c. Connection string the collector needs

```
postgresql://localhost:5432/pixel_dev
```

Adjust the port and add credentials if the local instance requires them (Postgres.app and a
default Homebrew install typically do not for the local user).

## d. Deploy the adapter and set secrets

Run `assets/collector/node/server.js` directly with `DATABASE_URL` set to the connection
string in (c) and `PIXEL_IP_SALT` set to any placeholder value for local testing. This is the
only runtime pairing recommended for `local` (see `references/compatibility.md`); do not deploy
a hosted serverless collector against a local database.

## e. Custom domain / first-party subdomain

Not applicable. Use `http://localhost:<port>/collect` directly, or a tunnel (ngrok or
Cloudflare Tunnel) only if a real browser on another device needs to reach the local collector
during testing.

## f. Free-tier limits that matter for a pixel

Not applicable - bounded only by the local machine's disk and memory. This provider exists for
`scripts/roundtrip.sh` and `scripts/simulate.mjs`, not for production traffic.

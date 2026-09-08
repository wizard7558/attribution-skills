# Provider: existing Postgres

Covers `database.provider = existing` - a Postgres the user already runs, on any host (a VM,
RDS, Cloud SQL, DigitalOcean managed Postgres, or any other provider not covered by its own
file in this directory).

## a. Detect what exists

There is no single CLI across every possible host. Ask directly: the connection string (or its
host, port, database name, and credential source), whether it is reachable from the public
internet or only from inside a private network (VPC, VPN), and its Postgres major version.
Confirm version 14 or later before applying `assets/schema.sql`, since the schema uses features
(declarative partitioning, generated columns if used) that require it.

## b. Create inside the existing instance vs. create new

Do not create a new database server. Create a new database or schema inside the existing
server: `assets/schema.sql` targets a `pixel` schema by convention (`database.schema` in
`pixel.config.json`), which can live inside an existing application database or a dedicated
database on the same server - ask which the user prefers. A dedicated database isolates pixel
storage and connection load from the application's own tables; a shared database is simpler to
operate if the user already has backup and monitoring set up for one database only.

## c. Connection string the collector needs

Use whatever connection string the user already has for that Postgres instance, in the pooled
or direct form appropriate to the collector runtime:

- **Public internet, serverless runtime** (`supabase-edge`, `vercel`, `cloudflare`) - route
  through a connection pooler in front of the database (PgBouncer, or the cloud provider's own
  pooler if it has one) rather than connecting directly, to avoid exhausting the server's
  max-connections limit under bursty pixel traffic.
- **Public internet, `node` runtime** - a direct connection is fine for a single long-lived
  process.
- **Private network only (VPC-only, no public endpoint)** - only `collector.runtime = node`
  running inside that same network can reach it; a hosted serverless function outside the
  network cannot. This is the fallback noted in `references/compatibility.md` for "existing ×
  any runtime."

## d. Deploy the adapter and set secrets

Deploy the adapter for whichever `collector.runtime` was chosen; follow that runtime's own
provider file (`references/providers/vercel.md`, `references/providers/cloudflare.md`, or for
`node`, any process manager or platform the user already uses) for the deploy command, and set
`DATABASE_URL` and `PIXEL_IP_SALT` using that runtime's secret-management mechanism.

## e. Custom domain / first-party subdomain

Same as the chosen collector runtime's own custom-domain steps; the existing Postgres has no
role in serving the subdomain.

## f. Free-tier limits that matter for a pixel

Not applicable in the general case - limits depend entirely on the existing instance's size and
plan. Ask the user for the instance's max-connections setting and available storage before
Step 1, since those bound how the collector should connect (direct vs. pooled) and how soon the
schema's monthly partitions will need pruning or export.

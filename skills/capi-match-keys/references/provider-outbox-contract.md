# Provider payload to native conversion outbox

Version `0.1.0`, validated 2026-09-08 (2026-09-09 UTC).

[provider-outbox.mjs](../scripts/provider-outbox.mjs) exports:

```js
await enqueueProviderConversion(tx, platform, input);
// { payload, disposition: 'inserted' | 'replayed', snapshot }
```

`platform` must be exactly `google`, `linkedin`, `meta`, `tiktok`, or `reddit`.
`input` is the exact `{preparation_input, identity, configuration}` accepted by the corresponding
[provider payload builder](payload-contract.md). The bridge calls that actual builder once per
invocation. It accepts no prebuilt payload. The actual preparation, selected qualified click,
hash helper, money handling, timestamp precision and platform validation remain authoritative.
`tx` must expose `query(sql, parameters)` and must be a caller-owned pinned PostgreSQL connection.
The bridge does not begin, commit, roll back, connect, create roles, or send HTTP requests.

A blocked payload throws `Error('capi_payload_blocked')`, with `code: 'capi_payload_blocked'` and
a copied `reasons` array, before any database query. Invalid configuration/input keeps the
builder's `TypeError`. Database errors propagate without broad logging, raw-error wrapping,
or automatic retries. Do not turn a blocked result into a successful business transaction.

A ready payload makes exactly this parameterized call:

```sql
SELECT * FROM capi_outbox.enqueue_conversion($1,$2,$3,$4,$5,$6,$7)
```

The seven values are, in order: `payload.destination.platform`, `.account_key`, `.destination_key`,
`.event_type`, `payload.preparation.business_conversion_id`, `.event_id`, and
`payload.request.request_body` unchanged. The result must contain exactly one row with disposition
`inserted` or `replayed` and an object snapshot, or the bridge throws
`Error('capi_outbox_invalid_result')`. Returned disposition and snapshot are from the actual SQL
row; the bridge does not reconstruct persisted state. The full locally built payload is also
returned for inspection. The SQL's exact-byte replay/conflict rules remain unchanged.

## Caller transaction and retry responsibilities

Apply the accepted [PostgreSQL schema](sql/conversion_outbox.sql) and grants through your own
migration process. The bridge imports only modules within this skill and uses no database-driver
dependency itself. For example, with a caller-configured `pg` pool:

```js
import { enqueueProviderConversion } from './scripts/provider-outbox.mjs';
const tx = await pool.connect();
try {
  await tx.query('BEGIN');
  await tx.query('UPDATE business_events SET recorded = true WHERE id = $1', [businessId]);
  const result = await enqueueProviderConversion(tx, platform, input);
  await tx.query('COMMIT');
  return result;
} catch (error) {
  await tx.query('ROLLBACK');
  throw error;
} finally {
  tx.release();
}
```

The business table/update above is an application example, not part of the reference schema.
Use the same pinned connection for the business write and enqueue, and propagate blocked errors
to rollback. A pool-wide `query` that can route statements to different connections does not
provide this boundary. A failure after enqueue and before commit must roll back business state,
outbox event and audit together.

Build once for a fresh enqueue. A worker claims through the native functions and **commits the
claim transaction before sending**. It sends `Buffer.from(snapshot.request_body, 'utf8')` from
the stored claim/read snapshot. Retries must never rebuild from mutable conversion data,
configuration or a current clock, and must never parse/re-serialize the stored body. Use the
native worker/attempt-token fencing and completion function exactly as described in the
[outbox contract](outbox-contract.md). `retry` requires an explicit future database eligibility
time; response classification is the worker's provider-specific responsibility.

The accepted SQL persists the body, destination domain and IDs. It does **not** persist the full
request envelope: URL, API version, public headers, authorization metadata and credentials are
not stored. Configure routing URL, public headers and authorization policy immutably for each
destination, outside this body-only outbox. A routing/version change needs explicit application
handling; it is not safe to reconstruct routing from arbitrary new inputs on retry. Never store
provider secrets in the request body or evidence. The bridge makes no claim that a local commit
or successful HTTP response proves provider ingestion, matching, deduplication or attribution.

## Native verification

From the standalone skill root:

```sh
bash scripts/test-conversion-outbox.sh
```

Requires Node 22+, npm, and PostgreSQL 17+ `initdb`, `pg_ctl`, and `psql` tools (Homebrew PostgreSQL
17 is detected first). The harness creates a new owned local UTF-8 cluster, ignores external
connection defaults, binds only `127.0.0.1`, and installs pinned `pg@8.16.3` with lifecycle scripts
disabled into disposable scratch. It preserves the original 15 native groups / 235 assertions,
then runs [test-provider-outbox.mjs](../scripts/test-provider-outbox.mjs) against that owned
cluster. No provider endpoints are contacted; dependency installation uses the package registry.

The added four groups / 289 assertions cover:

- Real build-to-enqueue for one existing independent ready golden per provider; full payload,
  persisted body, destination, both IDs, and native UTF-8 fingerprint equal independent expected
  wire bytes and Node SHA-256. Full row/audit replay and changed business/provider/body conflicts.
- Blocked payload and injected post-enqueue failure within actual business-write transactions,
  proving business/outbox/audit rollback. Invalid configuration and blocked input issue no SQL.
- Actual committed native claims, followed by five payloads each sent twice as stored Buffer
  bytes to a loopback-only server. Controlled 503 then 200 responses use explicit test-only
  retry/success classification and actual native completion. Retry eligibility uses the database
  clock, is bounded by one second, and is awaited before the second claim.
- Separate-connection `pg_stat_activity` probes during HTTP receipt show the worker idle with
  no transaction; the committed claim is visible independently. Retries retain byte-identical
  bodies and IDs, increase attempt tokens, and finish with exact native attempt/audit sequences.
  A copied standalone helper loads all five builders without sibling skills.

Each run saves a timestamped `~/Downloads/capi-conversion-outbox-evidence-*.json`. The
`provider_integration` section contains source/query/input hashes, exact synthetic inputs and
wire bytes, raw native rows, native fingerprints, ten loopback HTTP receipts, claim-commit probes,
final snapshots and history. Synthetic raw inputs include synthetic identity strings; never adapt
this evidence collection to production identity data. Failure evidence is preserved. Cleanup
records verify database shutdown, scratch removal, database port closure, HTTP server shutdown,
standalone copy removal and connection closure. This is measured local transport correctness,
not a live delivery or provider acceptance test.

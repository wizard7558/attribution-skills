# Collector transaction contract

The shared collector database interface has two methods:

```js
query(text, params) // Promise<{ rows }>, for work outside a collector request
transaction(async tx => result) // tx.query(text, params); resolves after commit
```

`handleCollect` validates the payload first, returning its existing 400 response without a
transaction for malformed input. Valid payloads require interactive transaction support;
a query-only database throws `TypeError`. The core opens one transaction and uses only
`tx.query` for site lookup, origin/bot decisions, visitor and event writes, identity/contact
links and hash attestation, consent, touchpoints, and conversion writes. Unknown sites and
rejected origins retain 403; bots retain 204. These read-only paths finish the transaction
without writing. Successful accepted requests retain 204 and finish only after commit.
Exceptions propagate to each adapter's existing generic 500 response.

## pg lifecycle

`createPgDatabase(pool)` acquires one client with `pool.connect()`. The exact successful
sequence is `BEGIN`, awaited callback queries, `COMMIT`, and `client.release(false)`. No
transactional query uses `pool.query`; concurrent transactions acquire distinct clients.
The callback's value is returned after commit.

A callback or COMMIT failure attempts ROLLBACK on that same client, then releases it. The
original failure is preserved even if rollback or release also fails. If rollback fails,
`client.release(true)` destroys the client. A failed BEGIN skips the callback, discards the
uncertain connection with `release(true)`, and preserves that failure. Failed acquisition
has no client to release. A normal rolled-back connection can be reused. Driver-managed
transactions do not imply business-event idempotency or automatic retries. A connection
loss during COMMIT can leave its outcome unknown to the caller; this wrapper does not
claim to resolve that uncertainty or retry the request.

## postgres.js lifecycle

`createPostgresDatabase(sql)` delegates to `sql.begin`, which owns the interactive transaction
and its rollback lifecycle. Only the transaction-local client's `unsafe(text, params)` runs
callback queries; `Array.from(rows)` returns plain result arrays. Supabase keeps
`postgres(DATABASE_URL, { max: 5, prepare: false })`; disabled prepared statements remain
necessary for its transaction-mode pooler. No manual BEGIN/COMMIT is mixed with pooled queries.

Node and Vercel Node use the pg helper. Cloudflare uses it with its Hyperdrive pg connection.
Supabase imports the postgres.js helper alongside `core.js`. Keep `transaction-db.mjs` and
the relative collector directory structure when copying an adapter. Use a connection/driver
that supports an interactive callback transaction; replacing it with independent HTTP
queries cannot satisfy this contract. There is no hosted deployment in this verification.

## Verification and boundaries

Run deterministic tests without a database:

```sh
node skills/first-party-pixel/scripts/test-transactions.mjs
```

They exercise pinned-client ordering, awaited callbacks, connect/BEGIN/callback/COMMIT/ROLLBACK
and release failures, original-error preservation, concurrent distinct clients, postgres.js
transaction-local delegation, and prevalidation/403/bot paths.

Run the existing disposable native suites from the repository root:

```sh
env -u DATABASE_URL bash skills/first-party-pixel/scripts/roundtrip.sh
node skills/first-party-pixel/scripts/test-touch-integration.mjs
```

A roundtrip-owned local cluster runs the transaction test in guarded `--connected` mode.
It injects exceptions **after successful native writes** to events, identity observations, identity links, unique-contact provenance, ambiguous-candidate provenance, touchpoints,
conversions and consent. Complete before/inside/after snapshots of
visitors, events, contacts, identity links, touchpoints, conversion events, consent state and identity observations
prove the intermediate writes occurred and all eight tables returned to their prior state.
Existing consent and per-kind contact provenance updates are covered, along with new rows.
Obsolete touch back-fill is absent; historical touch ownership remains unchanged. Successful
requests commit. Concurrent requests use distinct observed PostgreSQL backend PIDs; failure
in one leaves the other's committed result intact. A rolled-back connection is queried again.
All existing HTTP roundtrip and touch integration assertions remain enabled.

Native evidence is from local PostgreSQL with pg and the real collector core, plus the Node
HTTP adapter in the roundtrip. postgres.js is covered with a deterministic driver mock;
Supabase/Deno, Vercel and Cloudflare hosted runtimes are not claimed as natively exercised.
Timestamped private JSON reports, including raw synthetic queries and complete row snapshots,
are saved under `~/Downloads/first-party-pixel-transaction-native-evidence-*.json`.

Historical transaction-only verification on 2026-09-09 (before immutable observation capture): 60 deterministic assertions and 52 native transaction
assertions passed in each of two disposable clusters. The original HTTP roundtrip retained
all 18 assertions. The touch integration passed 16 journey goldens, 35 pageviews and 372
assertions, including full SQL export-to-dedupe checks and repeated legacy migration. Collector
identity parity passed 144 standalone and 191 repository assertions. Both test-owned Node
servers and PostgreSQL clusters were stopped and removed after completion.

The subsequent [identity-capture revision](identity-capture-contract.md) extended snapshots
to eight tables and seven injections (57 native assertions). The current
[resolution revision](identity-resolution-contract.md) retains all eight tables, replaces the
obsolete back-fill injection with unique-contact provenance, and adds ambiguous-candidate
provenance: eight post-write injections and 62 native assertions. The dated original
60/52-assertion and capture-revision evidence remain unchanged and evaluate their earlier sources.

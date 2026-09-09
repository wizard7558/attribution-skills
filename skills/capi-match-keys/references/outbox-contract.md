# Destination-scoped conversion outbox

Version `0.1.0`, validated 2026-09-08. The runnable reference is
[sql/conversion_outbox.sql](sql/conversion_outbox.sql), for PostgreSQL 17+ with a UTF-8 database.
It implements durable enqueue, exact-byte replay, destination-scoped uniqueness, worker claims,
lease fencing, and immutable attempt/audit history. It performs no provider HTTP calls, request
building, credential handling, or automatic classification of provider responses.

## Destination and event identity

The exact destination tuple is `(platform, account_key, destination_key, event_type)`.
`platform` is one of `meta`, `google`, `tiktok`, `linkedin`, or `reddit`. The remaining fields are
opaque, nonempty, control-free strings with no surrounding whitespace. All destination and
identity text columns use PostgreSQL `C` collation for exact comparison. Case, internal ordinary
spaces, and literal plus signs are preserved.

The caller must map this tuple **canonically and immutably to the provider's actual deduplication
domain**. It is not a set of arbitrary labels, a mutable campaign/stage taxonomy, or dimensions
that callers may change on retry to create a new namespace. The database does not independently
verify provider account ownership or deduplication configuration. A wrong mapping can create
unintended duplicate submissions even when these database constraints hold.

The actual [provider bridge](provider-outbox-contract.md) obtains this tuple from the accepted
payload builder. Google and LinkedIn use their configured action/rule as `destination_key` and
fixed `event_type: "conversion"`. Meta and TikTok use the exact configured event name. Reddit
uses `JSON.stringify([tracking_type, custom_event_name])`, including null for standard events;
this is a local collision-safe encoding, not a provider wire field. See the
[payload contract](payload-contract.md) for each complete destination mapping.

There are two independent native unique constraints:

- `(destination tuple, business_conversion_id)`
- `(destination tuple, provider_event_id)`

`business_conversion_id` is the lowercase 64-character SHA-256 returned by the accepted
`makeConversionId` helper. This database validates its representation, not its provenance; the
caller supplies that helper's stable business-event ID. Never derive a replacement from mutable
timestamps, values, destinations, or browser identifiers. `provider_event_id` is the exact opaque
`event_id` from `prepareConversion`, including a supplied browser override. Preserve the separate
business ID so one business conversion cannot silently adopt another event ID within its domain.

## Request bytes and durable state

`capi_outbox.events` stores the destination, business/provider IDs, exact `request_body TEXT`,
a server-generated `request_fingerprint`, state, monotonic integer attempt token, lease owner and
expiry, availability time, creation/update time, and nullable terminal completion time.

`request_body` must be nonempty text representing a JSON **object**. A PostgreSQL `json` cast
validates syntax/object type without replacing the stored text. The generated fingerprint is
lowercase hex from PostgreSQL's built-in `sha256(convert_to(request_body, 'UTF8'))`. No extension
or client-supplied digest is trusted. Event identity, request bytes, creation time, and destination
are immutable; direct attempts to modify them or delete/truncate the event history are rejected.

The replay contract is **exact text**, not a generic JSON canonicalization claim. Key order,
whitespace, duplicate member spelling, number spelling, and Unicode representation affect bytes
and therefore replay. Even semantically equivalent JSON with reordered keys conflicts. Serialize
once, persist once, and send/retry the stored `request_body` bytes. Do not parse and reserialize
on retry. Fingerprints are diagnostic; equality checks compare the actual stored text as well,
so a digest collision does not permit an overwrite.

Provider credentials and access tokens must remain outside the body and outbox. Store only the
necessary provider request data, protect it using deployment-specific database access and
retention controls, and do not log request bodies or identities. The reference raises fixed
validation/conflict messages; applications must also suppress raw PostgreSQL error detail and
bound SQL parameters, which can otherwise reveal data on direct constraint violations.

## API and transaction boundary

All functions are explicitly `SECURITY INVOKER` with a fixed `pg_catalog, capi_outbox` search path.
The reference creates no roles and assumes no elevated application permissions. It revokes
PUBLIC access to its schema, tables, sequences, and functions. A deployment must grant its
reviewed runtime role schema usage, required function execution, event SELECT/INSERT/UPDATE,
attempt/audit SELECT/INSERT, and sequence usage as appropriate. DELETE/TRUNCATE and history
UPDATE grants are unnecessary. The test's temporary role has additional DML grants only to
prove that history triggers still reject modifications; that role exists solely in its owned
local cluster.

Invoker functions are not a replacement for authorization. Required DML rights also let trusted
callers issue direct SQL. Any role granted the needed UPDATE/INSERT rights can bypass the
functions' state-transition or lease sequencing, while native unique/check constraints and
immutable-field/history triggers still apply. This is a trusted server/database-worker boundary;
deployment policy must constrain those callers to the reviewed API. Application agents should
invoke authorized service actions, not receive this database role. Table owners/administrators can bypass application guards, alter tables, or disable triggers.
Append-only here describes the enforced normal DML behavior, not a tamper-proof audit system or
an independently verified provider permission boundary.

The SQL is caller-composable and contains no COMMIT. Run business updates and enqueue within
**one explicit transaction on the same pinned database connection**:

```text
acquire one connection
BEGIN
perform the source business update
SELECT ... FROM capi_outbox.enqueue_conversion(...)
COMMIT
release the connection
```

A pool-per-query sequence of BEGIN, update, enqueue, and COMMIT does not create this guarantee.
Rollback removes the business update, outbox insert, and audit insert together. Claims and their
attempt/audit entries are likewise transactional. Commit a claim before making a network request;
never hold the transaction or row locks open while sending. Complete in a subsequent transaction
using that exact worker/token. Long transactions can consume a lease before the client sends.

Use normal PostgreSQL READ COMMITTED behavior. Enqueue's conflict wait followed by a new statement
snapshot observes a concurrent committed winner. At stricter isolation, serialization failures,
and ordinary database deadlocks, callers retry the entire transaction with the same identity and
stored bytes. Functions do not hide transaction errors or perform autonomous commits.

### Enqueue

```sql
capi_outbox.enqueue_conversion(
  p_platform text, p_account text, p_destination text, p_event_type text,
  p_business_id text, p_provider_id text, p_request_body text
) RETURNS TABLE(disposition text, snapshot jsonb)
```

A new event returns `disposition: inserted` and its complete durable-row snapshot in state
`queued`, token 0, no lease, and database-clock availability/creation/update times. Its enqueue
audit is written in the same transaction. An exact duplicate returns `replayed` and the existing
complete snapshot. Replay does not append another enqueue audit or modify availability/state.

The same tuple/business ID with a different provider ID or different request text raises SQLSTATE
`P0001` with `outbox_conflict`. The same tuple/provider ID belonging to another business ID also
conflicts. No row is overwritten. Concurrent identical enqueues resolve through native unique
indexes to one row and one enqueue audit. Independent actual destination domains can each retain
the same business/provider IDs.

An exact replay after `succeeded` or `permanent_failure` returns that terminal snapshot; it never
automatically retries a permanent failure. Changed accepted facts require a reviewed business
adjustment/conflict process, not a new event ID that evades deduplication.

### Claim

```sql
capi_outbox.claim_conversions(
  p_platform text, p_account text, p_destination text, p_event_type text,
  p_worker text, p_lease_seconds numeric, p_batch_size integer
) RETURNS SETOF capi_outbox.events
```

The destination and worker are exact qualified keys. Lease seconds must be finite numeric in
`[0.01, 3600]`; batch size must be an integer in `[1, 100]`. PostgreSQL stores lease timestamps
at its native microsecond precision. Null, nonfinite, and out-of-range parameters are rejected,
including when no rows match. The short lower bound enables bounded real-clock tests without
adding a production clock-injection API.

Only the exact requested destination is considered. Eligible rows are queued/due retry rows
with `available_at <= database clock`, or inflight rows with an expired lease. Selection orders
by availability then outbox ID and uses `FOR UPDATE SKIP LOCKED`. Locked rows are skipped rather
than handed to two workers. The function samples the database clock, advances each claimed row's
attempt token atomically, sets `inflight`, assigns its worker/lease, inserts an immutable attempt,
and appends a claim audit. The returned rows contain the stored request text to send after commit.

Reclaiming an expired inflight row first appends a separate `lease_expired` audit for its old
token/owner, then records the new token/claim. It never edits the prior attempt. If the transaction
rolls back, all those state and history changes roll back together. The integer token has no
wraparound path; exhaustion fails the transaction and requires operator review.

### Completion

```sql
capi_outbox.complete_conversion(
  p_platform text, p_account text, p_destination text, p_event_type text,
  p_business_id text, p_worker text, p_attempt_token integer,
  p_outcome text, p_result_code text, p_available_at timestamptz DEFAULT NULL
) RETURNS TABLE(applied boolean, snapshot jsonb)
```

Outcomes are exactly `succeeded`, `retry`, or `permanent_failure`. Tokens are positive integers.
The caller supplies a sanitized result-code enum matching `[A-Z][A-Z0-9_]{0,63}`. This shape check
is not a secret detector: callers must map responses to reviewed codes, never encode response
bodies, tokens, URLs, identities, or error prose into this field. There is no automatic HTTP
status classification in this layer.

`retry` requires an explicit finite future `p_available_at`; both terminal outcomes require it
to be null. All parameters, including otherwise-unused retry times and keys on nonexistent rows,
are validated. Future retry availability is rechecked after acquiring the row lock.

Completion locks the exact tuple/business row and samples `clock_timestamp()` **after any lock
wait**. Applying requires state `inflight`, exact worker, exact current attempt token, and
`lease_until > database clock`. Expired or stale completions return `applied: false` and the
unchanged snapshot, with no audit or state effect. A well-formed absent row returns false/null.
Reclaim advances the token, fencing the old worker even if its original network request finishes
later. Concurrent completions can apply at most once.

Applied completion clears worker and lease, sets the outcome and update time, and appends a
separate immutable completion audit containing the caller's sanitized code. Retry sets future
availability and keeps completion time null. Success/permanent failure set terminal completion
time. Native constraints enforce the state/lease/completion shape.

## History and limits of the guarantee

`capi_outbox.attempts` contains one immutable claim identity per `(outbox_id, attempt_token)`,
including worker, claimed time, and original lease expiry. `capi_outbox.audit` contains immutable
`enqueued`, `claimed`, `lease_expired`, `retry`, `succeeded`, and `permanent_failure` records.
It records previous/next state, token, worker, time, and nullable sanitized result code. Unique
partial indexes prevent duplicate enqueue, claim, expiry, and completion records for the same
relevant identity. Normal UPDATE, DELETE, and TRUNCATE operations on history are rejected.

The mutable event row is the current state; prior claims are never rewritten as the only account
of a lease. No-op stale completions and exact enqueue replays do not create history rows. There
is no built-in retention purge or terminal reset API. Production retention or schema evolution
requires a separately reviewed migration. Reapplying the reference is safe on its own schema;
`CREATE TABLE IF NOT EXISTS` is not a migration engine for incompatible older definitions.

This is durable database idempotency and lease fencing, **not exactly-once network delivery**.
A worker can send successfully and crash before persisting completion; an expired lease can be
reclaimed while the old request is still in flight. The provider's actual deduplication contract,
the immutable mapped destination, and the same stored provider event ID/request bytes remain
necessary. Workers must reconcile ambiguous outcomes according to a later provider-specific
workflow. Nothing in this reference provisions infrastructure or calls a conversion endpoint.

## Native verification and sanitized result

Run `bash scripts/test-conversion-outbox.sh`. The harness always initializes a **new owned local
cluster**, binds only `127.0.0.1`, disables Unix sockets, and ignores existing `DATABASE_URL` and
PG connection defaults. It requires local PostgreSQL 17+ tools, Node, and npm; `pg@8.16.3` is
installed with lifecycle scripts disabled in owned disposable scratch. Registry installation is
the only dependency-fetch network operation; tests make no provider HTTP calls. The runner
checks the cluster's resolved data directory and loopback address before applying SQL twice.

Tests use real independent PostgreSQL connections, an ordinary non-superuser runtime role, native
unique-index waits, actual held row locks, short real leases, and bounded database-clock polls.
They compare full persisted enqueue/claim/result snapshots and immutable history, not mocked
sequential approximations. The integration invokes the actual accepted `prepareConversion` and
persists its stable ID/browser override using a synthetic envelope. These original tests remain
unchanged. The shell then runs the separate [provider integration](provider-outbox-contract.md),
which invokes all five actual payload builders, persists their independently checked wire bytes,
and retries them only against a loopback HTTP stub. Failed database assertions redact detail.

Verified on 2026-09-08 (2026-09-09 UTC) using PostgreSQL **17.9**, Node **22.22.1**, and pg **8.16.3**:

- **15 native test groups, 235 assertions passed**.
- Sequential and concurrent replay, conflicting request/provider/business identities, and all
  four independent destination components passed.
- Concurrent claims were disjoint; native locked rows were skipped; business/enqueue and claim
  rollbacks preserved atomicity.
- Retry not-before, lease expiry/reclaim, old-worker fencing, expiry during a completion lock
  wait, concurrent single completion, and success/permanent terminal behavior passed.
- Native constraints, generated hashes, append-only history, parameter validation on unused
  paths, and actual prepared-event integration passed.
- The disposable database held 28 event rows, 18 immutable attempts, and 52 audit records before
  teardown. No external conversion calls occurred.
- Cleanup verified the cluster stopped, scratch was removed, and the loopback port was closed.

Detailed sanitized evidence is saved to
`~/Downloads/capi-conversion-outbox-evidence-20260909T003856Z.json`; each run writes a new timestamped
file in Downloads. Evidence includes server/tool versions, source SHA-256 hashes, per-group
assertion counts and durations, aggregate persisted states, and verified cleanup. No private
request bodies, credentials, or raw identity values are included in this public summary.

The added provider integration currently passes **4 groups and 289 assertions**, in addition to
the unchanged 15 groups / 235 assertions above. Its full native rows, synthetic input and request
bytes, query hashes, ten HTTP receipts, committed-claim probes and rollback evidence are under
`provider_integration` in each new Downloads evidence file. The outer cleanup record covers the
shared owned cluster; integration cleanup separately covers its HTTP server, copied modules and
connections. This demonstrates local transport correctness, not provider acceptance.

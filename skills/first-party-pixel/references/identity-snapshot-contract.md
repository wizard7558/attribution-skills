# Consistent native identity snapshot

`readIdentitySnapshot(db, { site_keys, snapshot_evidence_ref })` reads the three accepted
pixel identity exports in one PostgreSQL **repeatable-read, read-only transaction**. It
returns source rows and native snapshot provenance without calling an identity engine,
changing records, provisioning a database or acquiring a second connection itself.

The snapshot describes rows visible during this read. It does not reconstruct historical
contact attestation state from creation time, and it does not synchronize an external CRM
catalog. A later projection's `as_of` restricts events, not historical contact versions.
Retain the actual source snapshot under the caller's evidence reference.

## Database and options contract

The injected database must expose the accepted interactive `transaction(async tx => result)`
interface, where `tx.query(text, params)` returns `{ rows }` on one pinned connection. The
[transaction helper](transaction-contract.md) owns BEGIN, COMMIT, rollback and release.
The snapshot reader does not duplicate acquisition, release or retry logic. A query-only
database fails clearly. Permission, SQL, transaction and file-read errors propagate as
original errors; they never become empty successful snapshots.

Options contain exactly:

| Field | Requirement |
| --- | --- |
| `site_keys` | Nonempty dense array of exact nonempty site strings, without surrounding whitespace. Identical values collapse; the returned list is sorted. |
| `snapshot_evidence_ref` | Exact nonempty opaque reference to the caller-retained snapshot evidence. |

Unknown options, accessors, symbols, nonplain option objects, sparse arrays and extra array
properties are rejected. The validated evidence-reference primitive and unique sorted site-key
copy are captured synchronously before the first await. Later caller changes to the original
reference or site-key array cannot alter this invocation; no caller object is frozen or
mutated. The reader never rereads the caller options after suspension. No site is inferred from a visitor, hostname, other table or
configured default. Site-key parameters remain values and never become SQL identifiers.
Requested scopes do not replace the caller's database/application authorization controls.

## Exact read sequence

Before opening the transaction, read the exact bytes of these fixed local trusted files
and compute each SHA-256:

- [identity_touches.sql](sql/identity_touches.sql)
- [identity_observations.sql](sql/identity_observations.sql)
- [identity_contacts.sql](sql/identity_contacts.sql)

Inside the callback, the **first SQL statement** is:

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
```

The reader then obtains `transaction_timestamp()` formatted as UTC with six fractional
digits and `pg_current_snapshot()::text`. In normal production execution this provenance
SELECT acquires the repeatable-read snapshot. A separate parameterized
`pixel.sites WHERE site_key = ANY($1::text[])` query establishes which requested sites exist.
Every requested site gets an explicit presence row. A missing site is not silently presented
as an existing site with zero activity.

The three exports run sequentially on that same transaction connection. Each original SQL
body retains its comments, expressions and internal ordering; only its fixed final semicolon
is removed so it can appear inside an outer SELECT. The outer SQL filters
`exported.source_scope = ANY($1::text[])` in PostgreSQL and applies fixed qualified field
ordering using `COLLATE "C"`. Touches order by source/scope/visitor/touch key; observations by
source/scope/visitor/observation key; contacts by source/scope/contact key. No unscoped export
result is returned or filtered in JavaScript, and no caller-supplied SQL is accepted.

All row reads retain the same acquired MVCC snapshot. A concurrent commit after acquisition
is absent from all three exports, even if it occurs between their statements. A new invocation
can see that commit. This promise covers these PostgreSQL reads only; it does not cover
external catalogs, later queries, subsequent ingestion or business-event replay semantics.
Read-only mode rejects native writes in the transaction. Connection loss during COMMIT still
has the accepted transaction helper's uncertainty boundary; there is no automatic retry.

## Output

The exact object fields are:

```text
contract_version: "0.1.0"
snapshot_evidence_ref: supplied reference
site_keys: unique sorted requested sites
site_presence: [{ site_key, exists: boolean }]
transaction_started_at: native UTC timestamp with six fractional digits
database_snapshot: native pg_current_snapshot() text
source_sql_sha256: { touches, observations, contacts }
touches: complete source export rows
observations: complete source export rows
contacts: complete source export rows
```

Rows preserve all source-export fields, including original nanosecond timestamp strings,
native contact evidence, legacy rejection statuses and unknown contact kinds. No source row
is reclassified, rehashed or assigned a subject here. Native transaction time and snapshot ID
are run provenance; neither is an identity-validity timestamp or an archive of the rows.
Output metadata varies across database transactions by design. The SQL hashes identify the
actual source bytes read by this invocation.

## Actual database and projection usage

Use the accepted helper with an application-owned pg pool and explicitly requested sites:

```js
import pg from 'pg';
import { createPgDatabase } from './assets/collector/transaction-db.mjs';
import { readIdentitySnapshot } from './scripts/read-identity-snapshot.mjs';
import { projectIdentity } from './scripts/project-identity.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const snapshot = await readIdentitySnapshot(createPgDatabase(pool), {
    site_keys: ['site-a'],
    snapshot_evidence_ref: 'retained-snapshot-reference'
  });
  const projection = await projectIdentity({
    snapshot_evidence_ref: snapshot.snapshot_evidence_ref,
    config: {
      invocation_key: 'attribution-run-reference',
      as_of: '2026-09-03T01:00:00.000000001Z',
      lookback_days: 1,
      identity_scope_bindings: [{
        source_system: 'first_party_pixel', source_scope: 'site-a',
        contact_source_system: 'first_party_pixel', contact_source_scope: 'site-a'
      }],
      identity_input_format: 'canonical_sha256_v1',
      identity_normalization_version: '0.1.0'
    },
    touches: snapshot.touches,
    observations: snapshot.observations,
    contacts: snapshot.contacts
  }, { identitySkillRoot: '/absolute/path/to/installed/clickstream-identity-stitching' });
  // Retain snapshot and projection with the caller's evidence system.
} finally {
  await pool.end();
}
```

Select only the required export arrays and evidence reference for `projectIdentity`; passing
the entire snapshot would violate its strict input shape. Review `site_presence` explicitly
in the application. If using an external CRM catalog, supply its actual attested rows as
`external_contacts`, its independent `external_contact_evidence_ref`, and explicit visitor-to-CRM
bindings. A CRM-only binding is allowed; adding a pixel contact binding can introduce legitimate
cross-catalog ambiguity. No external snapshot consistency is inferred.

The [projection contract](identity-projection-contract.md) defines subject fields, current
snapshot limitations and actual engine behavior. This step verifies native snapshot through
that projection, not BigQuery MTA ingestion or credit allocation. Original timestamps retain
up to nine fractional digits; current native MTA TIMESTAMP is microsecond precision. No
rounding, truncation, timestamp parser or ledger adapter is added here. That separate precision
boundary must be explicitly specified and verified before claiming full MTA ingestion.

## Verification

Offline options, dependency bytes and transaction-shape checks:

```sh
node skills/first-party-pixel/scripts/test-identity-snapshot.mjs
```

Owned native PostgreSQL plus actual HTTP collector, snapshot and projection:

```sh
node skills/first-party-pixel/scripts/test-identity-snapshot.mjs --native
# Equivalent explicit opt-in roundtrip:
env -u DATABASE_URL bash skills/first-party-pixel/scripts/roundtrip.sh --identity-snapshot
```

The native wrapper removes inherited database configuration and the opt-in roundtrip rejects
an existing `DATABASE_URL`. Guarded `--connected` mode runs only inside that owned localhost
cluster. Default roundtrip behavior is unchanged; snapshot integration is opt-in. Existing
HTTP, transaction, immutable capture and safe resolver assertions remain enabled.

Five independent full snapshot goldens cover all requested sites, a single-site filter,
explicit missing-site absence, a prewriter consistent snapshot and a fresh postwriter snapshot.
Three complete actual projection goldens cover native bindings, missing bindings and CRM-only
bindings. Native HTTP fixtures include unique later-identify graph projection, shared-device
A-to-B ambiguity with own-event form contact IDs retained, an unobserved unverified contact,
and repeated browser IDs/email across sites. PostgreSQL UUID primary keys remain globally
unique; raw reports preserve each actual UUID. A documented scoped label map makes these
full golden comparisons readable. Only UUID labels and native provenance timestamps/IDs are
normalized; all business fields, hashes, statuses, source times, candidates and subjects remain
fully asserted. Arrays reorder by their normalized qualified keys (or the graph's normalized
serialized ordering), without removing rows. Production output is never rewritten this way.

The consistency test pauses inside the reader after the actual touch SELECT, awaits a separate
successful HTTP identify transaction that creates an observation/contact, and then allows the
reader to query observations and contacts. No timing sleep supplies synchronization. All three
reads match the prewriter golden; a new snapshot matches the postwriter golden. Native settings,
backend PID, snapshot ID, SQL/results and before/after complete table rows are recorded.

Three executed temporary mutants remove repeatable-read isolation, read-only protection or
the SQL scope filter. They respectively expose an inconsistent source set, allow a controlled
native INSERT probe (always rolled back), or expose another site's evidence; the full checks
reject each. An injected export error preserves the original error object, returns no partial
snapshot, rolls back/releases the pinned connection and leaves complete rows unchanged. A
missing SQL file fails before opening the transaction. Immediate caller mutations preserve
the original evidence reference and site scope; an executed old-reference mutant reproduces
the prior NULL-reference bypass and is rejected by the focused check. An exact copied pixel directory with a
separately installed identity directory executes this same native snapshot/projection chain.

Full raw native snapshots, projection inputs/outputs, native UUID label maps, table snapshots,
SQL/runtime/source hashes and failures are retained under
`~/Downloads/first-party-pixel-identity-snapshot-native-evidence-*.json`. Test-owned servers,
clusters and temporary copies are cleaned up; cleanup proof belongs in the separate review
report. Earlier failed attempts remain immutable evidence of their executed tests and fixtures.
No user database, hosted deployment, MTA engine or model calls occur in this step.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const EXPORTS = [
  ['touches', 'identity_touches.sql', ['source_system', 'source_scope', 'visitor_key', 'touch_key']],
  ['observations', 'identity_observations.sql', ['source_system', 'source_scope', 'visitor_key', 'observation_key']],
  ['contacts', 'identity_contacts.sql', ['source_system', 'source_scope', 'contact_key']]
];
function invalid() { throw new TypeError('Snapshot options require an exact evidence reference and nonempty array of exact site keys'); }
function exact(value) { return typeof value === 'string' && value.length > 0 && value === value.trim(); }
function validate(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(options).length !== 2 || !descriptors.site_keys || !descriptors.snapshot_evidence_ref) invalid();
  for (const item of Object.values(descriptors)) if (!item.enumerable || !Object.prototype.hasOwnProperty.call(item, 'value')) invalid();
  if (!exact(options.snapshot_evidence_ref) || !Array.isArray(options.site_keys) || !options.site_keys.length) invalid();
  const keys = Object.getOwnPropertyDescriptors(options.site_keys);
  if (Reflect.ownKeys(options.site_keys).length !== options.site_keys.length + 1) invalid();
  for (let i = 0; i < options.site_keys.length; i++) {
    const item = keys[i];
    if (!item || !item.enumerable || !Object.prototype.hasOwnProperty.call(item, 'value') || !exact(item.value)) invalid();
  }
  return [...new Set(options.site_keys)].sort();
}

export async function readIdentitySnapshot(db, options) {
  const siteKeys = validate(options);
  const snapshotEvidenceRef = options.snapshot_evidence_ref;
  if (!db || typeof db.transaction !== 'function') throw new TypeError('Identity snapshot requires an interactive transaction callback');
  // Read/hash the exact trusted source bytes before acquiring the transaction.
  const exports = await Promise.all(EXPORTS.map(async ([kind, filename, order]) => {
    const bytes = await readFile(new URL(`../references/sql/${filename}`, import.meta.url));
    const text = bytes.toString('utf8');
    if (!/;\s*$/.test(text)) throw new TypeError('Identity export must end in its fixed final semicolon');
    const sql = text.replace(/;(\s*)$/, '$1'); // Remove only the final semicolon, preserving all other source bytes/text.
    return { kind, sha256: createHash('sha256').update(bytes).digest('hex'),
      query: `SELECT exported.* FROM (\n${sql}\n) AS exported\nWHERE exported.source_scope = ANY($1::text[])\nORDER BY ${order.map(field => `exported.${field} COLLATE "C"`).join(', ')}` };
  }));
  return db.transaction(async tx => {
    if (!tx || typeof tx.query !== 'function') throw new TypeError('Identity snapshot transaction requires query');
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const provenance = (await tx.query(`SELECT
      to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS transaction_started_at,
      pg_current_snapshot()::text AS database_snapshot`)).rows[0];
    const existing = (await tx.query('SELECT site_key FROM pixel.sites WHERE site_key = ANY($1::text[]) ORDER BY site_key COLLATE "C"', [siteKeys])).rows;
    const found = new Set(existing.map(row => row.site_key));
    const rows = {};
    for (const item of exports) rows[item.kind] = (await tx.query(item.query, [siteKeys])).rows;
    return {
      contract_version: '0.1.0', snapshot_evidence_ref: snapshotEvidenceRef,
      site_keys: siteKeys, site_presence: siteKeys.map(site_key => ({ site_key, exists: found.has(site_key) })),
      transaction_started_at: provenance.transaction_started_at, database_snapshot: provenance.database_snapshot,
      source_sql_sha256: Object.fromEntries(exports.map(item => [item.kind, item.sha256])),
      touches: rows.touches, observations: rows.observations, contacts: rows.contacts
    };
  });
}

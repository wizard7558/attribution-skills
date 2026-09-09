import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleCollect, __internal } from '../assets/collector/core.js';
import { canonicalizeEmail, canonicalizePhone, touchSignature, IDENTITY_NORMALIZATION_VERSION } from '../assets/collector/identity-normalization.mjs';

for (const arg of process.argv.slice(2)) if (arg !== '--repository') throw new TypeError('Usage: node scripts/identity-parity.mjs [--repository]');
const authority = process.argv.includes('--repository') ? await import('../../clickstream-identity-stitching/scripts/identity-primitives.mjs') : null;
let assertions = 0;
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
if (authority) check('deepEqual', await readFile(new URL('../assets/collector/identity-normalization.mjs', import.meta.url)), await readFile(new URL('../../clickstream-identity-stitching/scripts/identity-normalization.mjs', import.meta.url)), 'bundled bytes equal repository authority');
check('equal', IDENTITY_NORMALIZATION_VERSION, '0.1.0');
check('equal', __internal.canonicalizeEmail, canonicalizeEmail, 'collector exports actual shared email canonicalizer');
check('equal', __internal.canonicalizePhone, canonicalizePhone, 'collector exports actual shared phone canonicalizer');
const identities = [
  ['email', ' Test.User@Example.COM ', 'test.user@example.com'],
  ['email', ' First.Last+Offer@GMAIL.com ', 'first.last+offer@gmail.com'],
  ['email', 'not-an-email', null],
  ['email', 'two@@example.com', null],
  ['email', 'person@localhost', null],
  ['email', ' person @example.com ', null],
  ['email', '', null],
  ['email', null, null],
  ['email', 42, null],
  ['phone', '+1 (415) 555-0123', '+14155550123'],
  ['phone', '+1 (415) 555-0123 ext. 99', '+14155550123'],
  ['phone', '+44 20 7946 0958 x123', '+442079460958'],
  ['phone', '+14155550123;123', '+14155550123'],
  ['phone', '+14155550123,123', '+14155550123'],
  ['phone', '+14155550123x123', '+14155550123'],
  ['phone', '4155550123', null],
  ['phone', '0014155550123', null],
  ['phone', '+0123456789', null],
  ['phone', '+1234567', null],
  ['phone', '+1234567890123456', null],
  ['phone', '+1-800-FLOWERS', null],
  ['phone', '', null],
  ['phone', null, null],
];
for (const [kind, input, expected] of identities) {
  const canonicalizer = kind === 'email' ? __internal.canonicalizeEmail : __internal.canonicalizePhone;
  const canonical = canonicalizer(input);
  check('equal', canonical, expected, `${kind}: explicit canonical golden`);
  const webHash = canonical ? await __internal.sha256Hex(canonical) : null;
  const nodeHash = expected ? createHash('sha256').update(expected, 'utf8').digest('hex') : null;
  check('equal', webHash, nodeHash, `${kind}: collector Web Crypto equals Node SHA-256`);
  if (authority) {
    check('equal', canonical, (kind === 'email' ? authority.canonicalizeEmail : authority.canonicalizePhone)(input), `${kind}: repository canonicalizer parity`);
    check('equal', webHash, authority.hashIdentity(kind, input), `${kind}: repository identity hash parity`);
  }
  // Exercise the real collector branch and inspect its actual database parameters.
  // No HTTP, database service, or outbound identity call is needed for this spy.
  const calls = [];
  const db = { async transaction(callback) { return callback({ query: this.query.bind(this) }); }, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT allowed_origins')) return { rows: [{ allowed_origins: [] }] };
    if (sql.startsWith('INSERT INTO pixel.visitors')) return { rows: [{ id: 'visitor-test' }] };
    if (sql.startsWith('INSERT INTO pixel.events')) return { rows: [{ id: 'event-test' }] };
    if (sql.includes('pg_advisory_xact_lock') || sql.includes('FROM pixel.contacts WHERE')) return { rows: [] };
    if (sql.startsWith('INSERT INTO pixel.contacts')) return { rows: [{ id: 'contact-test' }] };
    if (sql.startsWith('INSERT INTO pixel.identity_observations')) return { rows: [] };
    if (sql.startsWith('INSERT INTO pixel.identity_links')) return { rows: [] };
    throw new Error(`Unexpected collector query: ${sql}`);
  } };
  const payload = { site_key: 'site-test', visitor_uid: 'visitor-test', event_type: 'identify', occurred_at: '2026-09-01T12:00:00Z', identity: { [kind]: input } };
  const before = structuredClone(payload);
  const result = await handleCollect(payload, { now: () => new Date(payload.occurred_at), ip: null }, db);
  check('equal', result.status, 204, `${kind}: collector accepts event`);
  check('deepEqual', payload, before, `${kind}: collector preserves input`);
  const contactWrites = calls.filter((call) => call.sql.startsWith('INSERT INTO pixel.contacts'));
  check('equal', contactWrites.length, expected ? 1 : 0, `${kind}: invalid identity creates no contact/hash`);
  if (expected) check('deepEqual', contactWrites[0].params, kind === 'email' ? ['site-test', expected, nodeHash, null, null, 'canonical_sha256_v1', null] : ['site-test', null, null, expected, nodeHash, null, 'canonical_sha256_v1'], `${kind}: actual persisted canonical/hash parameters`);
  else check('equal', calls.some((call) => call.sql.startsWith('INSERT INTO pixel.identity_links') || call.sql.startsWith('UPDATE pixel.touchpoints')), false, `${kind}: invalid identity has no identity effects`);
}
const signatures = [
  [{ channel: 'Paid Search', utm_campaign: ' Summer+Launch ', click_ids: { gclid: 'Ab+C' } }, '["Paid Search","summer launch",[["gclid","Ab+C"]]]'],
  [{ channel: 'Email', utm_campaign: 'A%2520B', click_ids: { gclid: 'NULL', fbclid: '%252BABC' } }, '["Email","a b",[["fbclid","+ABC"]]]'],
  [{ channel: 'Direct' }, '["Direct",null,[]]'],
];
for (const [input, expected] of signatures) check('equal', touchSignature(input), expected, 'bundled touch signature golden');
console.log(`PASS collector identity parity: ${identities.length} canonical/hash + actual collector cases, ${signatures.length} bundled signature goldens, ${assertions} assertions${authority ? '; repository authority and generated bytes verified' : '; standalone bundled authority'}`);

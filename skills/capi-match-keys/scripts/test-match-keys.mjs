import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildMetaFbc, hashPlatformIdentity, normalizePlatformIdentity, SUPPORTED_PLATFORMS } from './match-keys.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../references/key-fixtures.json', import.meta.url)));
let assertions = 0;
function check(condition, label) {
  // Report case labels, never raw identities, normalized identities, or cookies.
  assert.ok(condition, label);
  assertions += 1;
}
function throws(callback, errorClass, label) {
  let error;
  try { callback(); } catch (caught) { error = caught; }
  check(error instanceof errorClass, label);
}
function verifyIdentity(fixture, normalize = normalizePlatformIdentity, hash = hashPlatformIdentity) {
  check(normalize(fixture.platform, fixture.kind, fixture.value) === fixture.expected, `${fixture.id}: canonical`);
  check(hash(fixture.platform, fixture.kind, fixture.value) === fixture.expected_hash, `${fixture.id}: hash`);
}
const clone = (value) => structuredClone(value);
const sha = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

check(new Set(fixtures.identity.map(({ id }) => id)).size === fixtures.identity.length, 'identity fixture IDs unique');
for (const fixture of fixtures.identity) {
  check(Object.hasOwn(fixture, 'expected'), `${fixture.id}: literal canonical present`);
  check(Object.hasOwn(fixture, 'expected_hash'), `${fixture.id}: literal hash present`);
  check(fixture.expected === null ? fixture.expected_hash === null : typeof fixture.expected === 'string' && /^[a-f0-9]{64}$/.test(fixture.expected_hash), `${fixture.id}: golden types`);
  verifyIdentity(fixture);
}
check(fixtures.identity.find(({ id }) => id === 'reddit-email-published-vector').expected_hash === 'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976', 'published Reddit email vector');
check(fixtures.identity.find(({ id }) => id === 'reddit-phone-baseline').expected_hash === 'e5b124c58580eb16bd959b8d0cac12b12c952e2ceae0203d416cff94f10b994a', 'published Reddit phone vector');
for (const platform of SUPPORTED_PLATFORMS) {
  for (const kind of ['email', 'phone']) {
    check(normalizePlatformIdentity(platform, kind, undefined) === null, `${platform}-${kind}: undefined canonical`);
    check(hashPlatformIdentity(platform, kind, undefined) === null, `${platform}-${kind}: undefined hash`);
  }
}
for (const fn of [normalizePlatformIdentity, hashPlatformIdentity]) {
  throws(() => fn('bing', 'email', null), TypeError, 'unsupported platform throws before input validation');
  throws(() => fn('meta', 'address', null), TypeError, 'unsupported kind throws before input validation');
  throws(() => fn('linkedin', 'address', null), TypeError, 'unsupported kind on LinkedIn throws');
}
check(hashPlatformIdentity('meta', 'phone', '+15554441234') !== hashPlatformIdentity('google', 'phone', '+15554441234'), 'provider phone key separation');

check(new Set(fixtures.fbc.map(({ id }) => id)).size === fixtures.fbc.length, 'FBC fixture IDs unique');
for (const fixture of fixtures.fbc) {
  const before = clone(fixture);
  if (fixture.expected_error) throws(() => buildMetaFbc(fixture), TypeError, `${fixture.id}: rejected`);
  else check(buildMetaFbc(fixture) === fixture.expected, `${fixture.id}: result`);
  check(JSON.stringify(fixture) === JSON.stringify(before), `${fixture.id}: input unchanged`);
}
check(buildMetaFbc() === null, 'missing FBC inputs');
check(buildMetaFbc({ existing_fbc: undefined, fbclid: 'Ab+C', observed_at: '2026-01-02T03:04:05Z' }) === 'fb.1.1767323045000.Ab+C', 'undefined existing cookie absent');

// Exercise realistic regressions in each provider, proving both canonical and hash
// assertions reject faulty behavior. Expected data always comes from golden fixtures.
const wrongEmailCanonical = {
  meta: 'alicesmith@gmail.com',
  google: 'alice.smith+ads@gmail.com',
  tiktok: 'alicesmith@gmail.com',
  linkedin: 'alicesmith@gmail.com',
  reddit: 'alice.smith+ads@gmail.com',
};
let mutations = 0;
for (const platform of SUPPORTED_PLATFORMS) {
  const aliasFixture = fixtures.identity.find(({ id }) => id === `${platform}-email-alias`);
  const phoneFixture = fixtures.identity.find(({ id }) => id === `${platform}-phone-baseline`);
  const nullFixture = fixtures.identity.find(({ id }) => id === `${platform}-email-null`);
  throws(() => verifyIdentity(aliasFixture, () => wrongEmailCanonical[platform]), assert.AssertionError, `${platform}: wrong email normalization detected`);
  mutations += 1;
  const wrongPhoneCanonical = platform === 'meta' || platform === 'linkedin' ? '+15554441234' : '15554441234';
  throws(() => verifyIdentity(phoneFixture, normalizePlatformIdentity, () => sha(wrongPhoneCanonical)), assert.AssertionError, `${platform}: wrong phone hash detected`);
  mutations += 1;
  throws(() => verifyIdentity(nullFixture, normalizePlatformIdentity, () => sha('')), assert.AssertionError, `${platform}: hashed null detected`);
  mutations += 1;
}
// Mutation of the literal hash alone must fail even when normalization is correct.
for (const platform of SUPPORTED_PLATFORMS) {
  const fixture = clone(fixtures.identity.find(({ id }) => id === `${platform}-email-alias`));
  fixture.expected_hash = '0'.repeat(64);
  throws(() => verifyIdentity(fixture), assert.AssertionError, `${platform}: corrupt golden hash detected`);
  mutations += 1;
}
const captureFixture = fixtures.fbc.find(({ id }) => id === 'capture');
throws(() => check(buildMetaFbc(captureFixture) === 'fb.1.0.Ab+C', 'capture mutation'), assert.AssertionError, 'capture epoch mutation detected');
mutations += 1;
console.log(`PASS ${fixtures.identity.length} identity fixtures (canonical + hash each), ${fixtures.fbc.length} FBC fixtures, ${mutations} detected mutations, ${assertions} passed assertions; no raw identity logged.`);

import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIdentityGraph } from './identity-graph.mjs';
import { hashIdentity } from './identity-primitives.mjs';

const fixture = JSON.parse(await readFile(new URL('../references/graph-fixtures.json', import.meta.url)));
const OUTPUT_FIELDS = ['edges', 'observations', 'touch_links', 'diagnostics'];
const INPUT_ARRAYS = ['contacts', 'identifies', 'touches', 'identity_scope_bindings'];
let assertions = 0;
let executed = 0;
let permutations = 0;
let mutations = 0;
const nontrivialPermutations = new Set();
function check(method, ...args) { assertions += 1; return assert[method](...args); }
function exactFields(value, fields, label) {
  check('deepEqual', Object.keys(value).sort(), [...fields].sort(), `${label}: missing or unknown fields`);
}
function validateFixture(test) {
  check('ok', ['graph', 'error'].includes(test.kind), `${test.name}: unknown fixture kind ${test.kind}`);
  exactFields(test, ['name', 'kind', 'input', test.kind === 'graph' ? 'expected' : 'expectedError'], test.name);
  check('equal', typeof test.name, 'string', 'fixture name must be a string');
  if (test.kind === 'graph') exactFields(test.expected, OUTPUT_FIELDS, `${test.name}: expected`);
  else check('equal', typeof test.expectedError, 'string', `${test.name}: expectedError`);
}
function assertGraphFixture(test, actual) {
  validateFixture(test);
  // The complete output golden includes every qualified contact, observation candidate,
  // evidence hash/key, touch reason, and diagnostic. No declared field is ignored.
  exactFields(actual, OUTPUT_FIELDS, `${test.name}: output`);
  for (const field of OUTPUT_FIELDS) check('deepEqual', actual[field], test.expected[field], `${test.name}: ${field}`);
}
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return value;
}
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}
function runFixture(test) {
  validateFixture(test);
  executed += 1;
  if (test.kind === 'error') {
    check('throws', () => buildIdentityGraph(test.input), new RegExp(test.expectedError), test.name);
    return;
  }
  const before = structuredClone(test.input);
  const actual = buildIdentityGraph(test.input);
  assertGraphFixture(test, actual);
  check('deepEqual', test.input, before, `${test.name}: entire input is immutable`);
  check('equal', JSON.stringify(actual).includes('@'), false, `${test.name}: raw email leaked`);
  check('equal', JSON.stringify(actual).includes('203.0.113'), false, `${test.name}: IP leaked`);
  check('equal', /\+\d{8,15}/.test(JSON.stringify(actual)), false, `${test.name}: raw phone leaked`);
  check('deepEqual', buildIdentityGraph(freezeDeep(structuredClone(test.input))), actual, `${test.name}: frozen input`);
  // Exercise each array independently, then all arrays together, then every object's
  // insertion order. Track that each array actually changes in at least one case.
  for (const variant of [...INPUT_ARRAYS, 'all_arrays', 'object_keys']) {
    const permuted = variant === 'object_keys' ? reverseKeys(test.input) : structuredClone(test.input);
    for (const field of INPUT_ARRAYS) {
      if (variant === field || variant === 'all_arrays') {
        permuted[field]?.reverse();
        if (JSON.stringify(permuted[field]) !== JSON.stringify(test.input[field])) nontrivialPermutations.add(field);
      }
    }
    if (variant === 'object_keys' && JSON.stringify(permuted) !== JSON.stringify(test.input)) nontrivialPermutations.add(variant);
    const snapshot = structuredClone(permuted);
    const output = buildIdentityGraph(permuted);
    assertGraphFixture(test, output);
    check('deepEqual', output, actual, `${test.name}: ${variant} full output equality`);
    check('equal', JSON.stringify(output), JSON.stringify(actual), `${test.name}: ${variant} serialization equality`);
    check('deepEqual', permuted, snapshot, `${test.name}: ${variant} input mutation`);
    permutations += 1;
  }
}
exactFields(fixture, ['version', 'cases'], 'fixture document');
check('equal', fixture.version, '1.0', 'fixture version');
check('equal', new Set(fixture.cases.map((test) => test.name)).size, fixture.cases.length, 'unique fixture names');
for (const test of fixture.cases) runFixture(test);

// Produce hash-mode inputs through the accepted shared primitive, then compare
// against independent complete raw goldens rather than hash-mode generated answers.
let hashParityCases = 0;
for (const test of fixture.cases.filter((item) => item.kind === 'graph' && (item.input.identity_input_format ?? 'raw') === 'raw')) {
  const hashed = structuredClone(test.input);
  hashed.identity_input_format = 'canonical_sha256_v1';
  for (const field of ['contacts', 'identifies']) {
    for (const row of hashed[field] ?? []) {
      for (const kind of ['email', 'phone']) {
        row[`${kind}_hash`] = row[kind] == null ? null : hashIdentity(kind, row[kind]);
        delete row[kind];
      }
    }
  }
  const before = structuredClone(hashed);
  const actual = buildIdentityGraph(hashed);
  assertGraphFixture(test, actual);
  check('equal', JSON.stringify(actual), JSON.stringify(test.expected), `${test.name}: raw/hash byte parity`);
  check('deepEqual', hashed, before, `${test.name}: hashed input immutability`);
  check('deepEqual', buildIdentityGraph(freezeDeep(structuredClone(hashed))), actual, `${test.name}: frozen hashed input`);
  hashParityCases += 1;
}

// JSON files cannot represent these inputs. Construct and execute real JavaScript
// values here rather than disguising null as NaN or counting unexecuted cases.
const base = fixture.cases.find((test) => test.name === 'matched_projection').input;
const runtimeErrors = [
  ['actual_nan', (input) => { input.lookback_days = NaN; }, 'not JSON-compatible'],
  ['actual_infinity', (input) => { input.contacts[0].metadata = Infinity; }, 'not JSON-compatible'],
  ['actual_undefined', (input) => { input.identifies[0].metadata = undefined; }, 'not JSON-compatible'],
  ['actual_sparse_array', (input) => { delete input.touches[0]; }, 'sparse'],
  ['actual_date_object', (input) => { input.metadata = new Date(); }, 'plain object'],
  ['actual_nonplain_root', (input) => Object.setPrototypeOf(input, { inherited: true }), 'plain object'],
  ['actual_cycle', (input) => { input.metadata = input; }, 'cyclic'],
  ['actual_symbol_key', (input) => { input[Symbol('private')] = true; }, 'symbol keys'],
  ['actual_accessor', (input) => { Object.defineProperty(input, 'metadata', { enumerable: true, get() { throw new Error('accessor executed'); } }); }, 'JSON data property'],
  ['actual_bigint', (input) => { input.metadata = 1n; }, 'not JSON-compatible'],
  ['actual_function', (input) => { input.metadata = () => 1; }, 'not JSON-compatible'],
  ['actual_array_property', (input) => { input.touches.extra = true; }, 'JSON array index'],
];
for (const [name, mutate, expectedError] of runtimeErrors) {
  const input = structuredClone(base);
  mutate(input);
  runFixture({ name, kind: 'error', input, expectedError });
}
check('deepEqual', [...nontrivialPermutations].sort(), [...INPUT_ARRAYS, 'object_keys'].sort(), 'each input array and object insertion order must have meaningful permutations');
check('equal', fixture.cases.filter((test) => test.name.startsWith('window_jan')).length, 6, 'six explicit Jan10/lookback2 boundary goldens');

// Invoke exactly the same golden assertion as the real runner with deliberately
// corrupted expectations, including nested fields that the old summary missed.
const mutationChecks = [
  ['matched_projection', (expected) => { expected.edges[0].contact.source_scope = 'wrong'; }],
  ['matched_projection', (expected) => { expected.edges[0].evidence.email_hash = 'wrong'; }],
  ['matched_projection', (expected) => { expected.observations[0].candidates[0].contact_key = 'wrong'; }],
  ['matched_projection', (expected) => { expected.observations[0].status = 'unresolved'; }],
  ['matched_projection', (expected) => { expected.touch_links[0].edge_evidence_keys = []; }],
  ['matched_projection', (expected) => { expected.diagnostics.future_excluded.touches = 1; }],
  ['shared_device_one_eligible_edge', (expected) => { expected.touch_links[0].contacts.pop(); }],
  ['shared_device_one_eligible_edge', (expected) => { delete expected.touch_links[0].reason; }],
  ['shared_device_one_eligible_edge', (expected) => { expected.diagnostics.shared_devices[0].contacts.pop(); }],
  ['matched_projection', (expected) => { expected.unchecked = true; }],
];
for (const [name, mutate] of mutationChecks) {
  const test = structuredClone(fixture.cases.find((item) => item.name === name));
  mutate(test.expected);
  check('throws', () => assertGraphFixture(test, buildIdentityGraph(test.input)), assert.AssertionError, `${name}: mutated expectation must fail`);
  mutations += 1;
}
for (const mutate of [(test) => { test.kind = 'unexecuted'; }, (test) => { test.ignored = true; }, (test) => { test.expectedError = 'ignored'; }]) {
  const test = structuredClone(fixture.cases[0]);
  mutate(test);
  check('throws', () => validateFixture(test), assert.AssertionError, 'unknown fixture schema must fail');
}
// Execute a syntax-valid isolated module with the prior millisecond truncation.
// New literal goldens must detect the bug, not merely a changed expected summary.
const sourceUrl = new URL('./identity-graph.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const exactTime = "return BigInt(wholeSecondMs) * 1_000_000n + BigInt(fraction.padEnd(9, '0'));";
check('ok', source.includes(exactTime), 'temporal mutant source target exists');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'identity-graph-ns-mutant-'));
let temporalMutations = 0;
try {
  for (const file of ['identity-primitives.mjs', 'identity-normalization.mjs']) await copyFile(new URL(file, import.meta.url), path.join(scratch, file));
  await writeFile(path.join(scratch, 'identity-graph.mjs'), source.replace(exactTime, 'return BigInt(Date.parse(value)) * 1_000_000n;'));
  const oldPrecision = await import(pathToFileURL(path.join(scratch, 'identity-graph.mjs')).href);
  for (const name of ['ns_future_touch_one_nanosecond', 'ns_future_identify_one_nanosecond', 'ns_day_lookback_outside_one_nanosecond', 'ns_subnanosecond_one_ns_earlier', 'ns_pre_epoch_future_touch']) {
    const test = fixture.cases.find((item) => item.name === name);
    check('throws', () => assertGraphFixture(test, oldPrecision.buildIdentityGraph(test.input)), assert.AssertionError, `${name}: old millisecond precision must fail`);
    temporalMutations += 1;
  }
  // A standalone copied graph uses only these local modules and Node built-ins.
  await writeFile(path.join(scratch, 'identity-graph-clean.mjs'), source);
  const standalone = await import(pathToFileURL(path.join(scratch, 'identity-graph-clean.mjs')).href);
  for (const name of ['hashed_matched_projection', 'hashed_shared_device_one_eligible_edge', 'hashed_ns_future_identify_one_nanosecond']) {
    const test = fixture.cases.find((item) => item.name === name);
    assertGraphFixture(test, standalone.buildIdentityGraph(test.input));
  }
  const hashReturn = 'return { email: null, phone: null, email_hash, phone_hash };';
  check('ok', source.includes(hashReturn), 'hash-mode mutant source target exists');
  await writeFile(path.join(scratch, 'identity-graph-rehash.mjs'), source.replace(hashReturn,
    "return { email: null, phone: null, email_hash: email_hash ? hashIdentity('email', email_hash) : null, phone_hash };"));
  const rehashed = await import(pathToFileURL(path.join(scratch, 'identity-graph-rehash.mjs')).href);
  const hashGolden = fixture.cases.find((item) => item.name === 'hashed_matched_projection');
  check('throws', () => assertGraphFixture(hashGolden, rehashed.buildIdentityGraph(hashGolden.input)), assert.AssertionError, 'rehashing canonical input must fail complete golden');
} finally { await rm(scratch, { recursive: true, force: true }); }
console.log(`executed ${executed} graph fixtures (${fixture.cases.length} JSON + ${runtimeErrors.length} runtime); ${assertions} assertions; ${permutations} full-output permutations; ${mutations} mutated goldens rejected; ${temporalMutations} executed old-precision mutant detections; ${hashParityCases} raw/hash parity cases; 3 standalone hash goldens; 1 rehash mutant detected; nontrivial permutations: ${[...nontrivialPermutations].sort().join(', ')}`);

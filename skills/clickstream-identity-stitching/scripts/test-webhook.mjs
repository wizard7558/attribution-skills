import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveWebhookStitch } from './webhook-stitch.mjs';
import { canonicalizeEmail, canonicalizePhone, hashIdentity, dedupeTouches } from './identity-primitives.mjs';
import { buildIdentityGraph } from './identity-graph.mjs';

const fixture = JSON.parse(await readFile(new URL('../references/webhook-fixtures.json', import.meta.url)));
const ARRAYS = ['visitors', 'page_rule_events', 'recent_identity_edges', 'receipts'];
let assertions = 0, executed = 0, permutations = 0, mutations = 0, integrationScenarios = 0;
const nontrivial = new Set();
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
function fields(value, expected, label) { check('deepEqual', Object.keys(value).sort(), [...expected].sort(), `${label}: missing or unknown fields`); }
function schema(test) {
  check('ok', ['resolution', 'error'].includes(test.kind), `${test.name}: unknown fixture kind`);
  fields(test, ['name', 'kind', 'input', test.kind === 'resolution' ? 'expected' : 'expectedError'], test.name);
  if (test.kind === 'resolution') fields(test.expected, ['receipt_key', 'payload_sha256', 'replayed', 'resolution', 'receipt'], test.name);
  else check('equal', typeof test.expectedError, 'string', `${test.name}: expectedError`);
}
function assertFixture(test, actual) { schema(test); check('deepEqual', actual, test.expected, test.name); }
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return value;
}
function freezeDeep(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); } return value; }
function run(test) {
  schema(test); executed += 1;
  if (test.kind === 'error') { check('throws', () => resolveWebhookStitch(test.input), new RegExp(test.expectedError), test.name); return; }
  const before = structuredClone(test.input), actual = resolveWebhookStitch(test.input);
  assertFixture(test, actual);
  check('deepEqual', test.input, before, `${test.name}: whole input immutability`);
  check('deepEqual', resolveWebhookStitch(freezeDeep(structuredClone(test.input))), actual, `${test.name}: frozen input`);
  check('equal', /@|203\.0\.113|\+\d{8,15}|private\.example/.test(JSON.stringify(actual)), false, `${test.name}: privacy`);
  for (const variant of [...ARRAYS, 'all_arrays', 'object_keys']) {
    const input = variant === 'object_keys' ? reverseKeys(test.input) : structuredClone(test.input);
    for (const field of ARRAYS) if (variant === field || variant === 'all_arrays') {
      input[field].reverse();
      if (JSON.stringify(input[field]) !== JSON.stringify(test.input[field])) nontrivial.add(field);
    }
    if (variant === 'object_keys' && JSON.stringify(input) !== JSON.stringify(test.input)) nontrivial.add(variant);
    const snapshot = structuredClone(input), result = resolveWebhookStitch(input);
    assertFixture(test, result);
    check('equal', JSON.stringify(result), JSON.stringify(actual), `${test.name}: deterministic ${variant}`);
    check('deepEqual', input, snapshot, `${test.name}: immutable ${variant}`);
    permutations += 1;
  }
}
fields(fixture, ['version', 'cases'], 'fixture document');
check('equal', fixture.version, '1.0');
check('equal', fixture.cases.length, 30, '30 fixed complete golden fixtures');
check('equal', new Set(fixture.cases.map((test) => test.name)).size, fixture.cases.length, 'unique fixture names');
fixture.cases.forEach(run);
check('deepEqual', [...nontrivial].sort(), [...ARRAYS, 'object_keys'].sort(), 'nontrivial array and object-key permutations');
const base = fixture.cases.find((test) => test.name === 'recent_identity_match');
const errors = [
  ['empty_email', (x) => { x.submission.email = ''; }, 'email is invalid'],
  ['malformed_email', (x) => { x.submission.email = 'invalid'; }, 'email is invalid'],
  ['national_phone', (x) => { x.submission.phone = '4155550123'; }, 'phone is invalid'],
  ['empty_phone', (x) => { x.submission.phone = ''; }, 'phone is invalid'],
  ['whitespace_key', (x) => { x.submission.visitor_key = ' v1'; }, 'exact string'],
  ['invalid_calendar_date', (x) => { x.submission.occurred_at = '2026-02-30T12:00:00Z'; }, 'is invalid'],
  ['missing_timezone', (x) => { x.submission.occurred_at = '2026-01-10T12:00:00'; }, 'ISO timestamp'],
  ['negative_window', (x) => { x.policy.page_rule_window_minutes = -1; }, 'nonnegative'],
  ['missing_confidence', (x) => { delete x.policy.confidence.page_rule; }, 'missing or unknown fields'],
  ['out_of_range_confidence', (x) => { x.policy.confidence.page_rule = 1.1; }, 'between 0 and 1'],
  ['nonfinite_window', (x) => { x.policy.recent_visitor_window_minutes = NaN; }, 'JSON-compatible'],
  ['nonfinite_metadata', (x) => { x.submission.metadata = Infinity; }, 'JSON-compatible'],
  ['sparse_visitors', (x) => { delete x.visitors[0]; }, 'sparse'],
  ['nonplain_input', (x) => Object.setPrototypeOf(x, { inherited: true }), 'plain object'],
  ['date_metadata', (x) => { x.submission.metadata = new Date(); }, 'plain object'],
  ['cyclic_input', (x) => { x.metadata = x; }, 'cyclic'],
  ['undefined_input', (x) => { x.metadata = undefined; }, 'JSON-compatible'],
  ['conflicting_page_event_key', (x) => { x.page_rule_events.push({ ...x.page_rule_events[0], visitor_key: 'v2' }); }, 'conflicting duplicate page rule event'],
  ['conflicting_visitor_key', (x) => { x.visitors.push({ ...x.visitors[0], last_seen_at: '2026-01-10T11:40:00Z' }); }, 'conflicting duplicate visitor'],
  ['conflicting_evidence_key', (x) => { x.recent_identity_edges.push({ ...x.recent_identity_edges[0], email_hash: hashIdentity('email', 'other@example.com') }); }, 'conflicting duplicate identity evidence'],
  ['raw_identity_not_hash_evidence', (x) => { x.recent_identity_edges[0].email_hash = 'person@example.com'; }, 'email_hash is invalid'],
  ['no_explicit_hash_evidence', (x) => { x.recent_identity_edges[0].email_hash = null; }, 'requires explicit identity hash evidence'],
  ['conflicting_receipt_rows', (x) => { x.receipts = [structuredClone(base.expected.receipt), structuredClone(base.expected.receipt)]; x.receipts[1].resolution.visitor.visitor_key = 'v2'; }, 'conflicting duplicate receipt'],
  ['receipt_wrong_visitor_scope', (x) => { x.receipts = [structuredClone(base.expected.receipt)]; x.receipts[0].resolution.visitor.source_scope = 'other'; }, 'scope conflicts'],
  ['receipt_raw_pii_field', (x) => { x.receipts = [structuredClone(base.expected.receipt)]; x.receipts[0].resolution.email = 'person@example.com'; }, 'missing or unknown fields'],
  ['receipt_invalid_method', (x) => { x.receipts = [structuredClone(base.expected.receipt)]; x.receipts[0].resolution.method = 'ip_match'; }, 'method/status'],
  ['receipt_wrong_confidence', (x) => { x.receipts = [structuredClone(base.expected.receipt)]; x.receipts[0].resolution.confidence = 0.2; }, 'confidence conflicts'],
  ['receipt_injected_diagnostic', (x) => { x.receipts = [structuredClone(base.expected.receipt)]; x.receipts[0].resolution.diagnostics = [{ code: 'person@example.com' }]; }, 'diagnostic code'],
];
for (const [name, mutate, expectedError] of errors) { const input = structuredClone(base.input); mutate(input); run({ name, kind: 'error', input, expectedError }); }
// Every normalized submission field that can change the ladder, plus policy, changes
// the fingerprint. Capture scope/provider/key changes instead create distinct receipts.
for (const [field, value] of [['occurred_at', '2026-01-10T12:00:01Z'], ['visitor_key', 'v1'], ['page_rule_event_key', 'p1'], ['email', 'other@example.com'], ['phone', '+14155550123']]) {
  const input = structuredClone(base.input); input.receipts = [structuredClone(base.expected.receipt)]; input.submission[field] = value;
  run({ name: `receipt_conflict_${field}`, kind: 'error', input, expectedError: 'conflicting receipt payload' });
}
for (const field of ['page_rule_window_minutes', 'recent_visitor_window_minutes']) {
  const input = structuredClone(base.input); input.receipts = [structuredClone(base.expected.receipt)]; input.policy[field] += 1;
  run({ name: `receipt_conflict_${field}`, kind: 'error', input, expectedError: 'conflicting receipt payload' });
}
for (const method of ['visitor_field', 'page_rule', 'recent_visitor', 'new_visitor']) {
  const input = structuredClone(base.input); input.receipts = [structuredClone(base.expected.receipt)]; input.policy.confidence[method] = 0.5;
  run({ name: `receipt_conflict_confidence_${method}`, kind: 'error', input, expectedError: 'conflicting receipt payload' });
}
for (const mutate of [
  (expected) => { expected.resolution.visitor.source_scope = 'wrong'; },
  (expected) => { expected.receipt.resolution.confidence = 0; },
  (expected) => { expected.payload_sha256 = 'wrong'; },
  (expected) => { expected.replayed = true; },
  (expected) => { expected.unchecked = true; },
]) {
  const test = structuredClone(base); mutate(test.expected);
  check('throws', () => assertFixture(test, resolveWebhookStitch(test.input)), assert.AssertionError, 'same golden assertion rejects mutation'); mutations += 1;
}
for (const mutate of [(test) => { test.kind = 'unexecuted'; }, (test) => { test.unchecked = true; }]) {
  const test = structuredClone(base); mutate(test); check('throws', () => schema(test), assert.AssertionError, 'reject unknown fixture schema');
}
// Integration uses the exported primitives and accepted graph implementation.
// Adapter projections must come from established graph.edges, never observations.
const projectEdges = (graph) => graph.edges.map((edge) => ({ source_system: edge.source_system, source_scope: edge.source_scope, visitor_key: edge.visitor_key, evidence_key: edge.edge_key, evidence_at: edge.occurred_at, email_hash: edge.evidence.email_hash, phone_hash: edge.evidence.phone_hash }));
const contact = { source_system: 'crm', source_scope: 'account', contact_key: 'c1', email: canonicalizeEmail(' PERSON@example.com '), phone: canonicalizePhone('+1 (415) 555-0123') };
const binding = { source_system: 'pixel', source_scope: 'site', contact_source_system: 'crm', contact_source_scope: 'account' };
const observation = { source_system: 'pixel', source_scope: 'site', visitor_key: 'v1', observation_key: 'identified-1', occurred_at: '2026-01-10T11:50:00Z', email: contact.email, phone: contact.phone };
const graphInput = { contacts: [contact], identifies: [observation], touches: [], identity_scope_bindings: [binding], as_of: '2026-01-10T12:00:00Z', lookback_days: 2 };
const graph = buildIdentityGraph(graphInput);
check('equal', graph.edges[0].evidence.email_hash, hashIdentity('email', contact.email));
const input = { ...structuredClone(base.input), recent_identity_edges: projectEdges(graph) };
const attached = resolveWebhookStitch(input);
check('equal', attached.resolution.method, 'recent_visitor');
check('deepEqual', attached.resolution.visitor, { source_system: 'pixel', source_scope: 'site', visitor_key: 'v1' });
integrationScenarios += 1;
// A new browser already carrying its own scoped key can identify the same contact.
// Its identify observation backfills an earlier touch without inventing prior activity.
const secondInput = structuredClone(input);
secondInput.submission.visitor_key = 'v2'; secondInput.submission.submission_key = 's2';
secondInput.visitors.push({ source_system: 'pixel', source_scope: 'site', visitor_key: 'v2', last_seen_at: '2026-01-10T12:00:00Z' });
const second = resolveWebhookStitch(secondInput);
const touch = { source_system: 'pixel', source_scope: 'site', visitor_key: 'v2', touch_key: 'touch-2', occurred_at: '2026-01-10T11:40:00Z', channel: 'Paid Search', taxonomy_version: '0.1.0' };
const ordered = dedupeTouches([touch]).touches;
const identify = { ...second.resolution.visitor, observation_key: `submission:${second.receipt_key}`, occurred_at: secondInput.submission.occurred_at, email: canonicalizeEmail(secondInput.submission.email) };
const backfilled = buildIdentityGraph({ ...graphInput, identifies: [observation, identify], touches: ordered });
check('equal', second.resolution.status, 'matched');
check('equal', backfilled.edges.length, 2);
check('deepEqual', backfilled.edges.map((edge) => edge.contact), [{ source_system: 'crm', source_scope: 'account', contact_key: 'c1' }, { source_system: 'crm', source_scope: 'account', contact_key: 'c1' }]);
check('equal', backfilled.touch_links[0].status, 'matched');
check('deepEqual', backfilled.touch_links[0].edge_evidence_keys, [JSON.stringify(['pixel', 'site', 'v2', identify.observation_key])]);
const retried = resolveWebhookStitch({ ...secondInput, receipts: [second.receipt] });
const persistedIdentifies = [observation, identify];
if (!retried.replayed) persistedIdentifies.push(identify);
check('equal', retried.replayed, true);
check('equal', persistedIdentifies.length, 2, 'replay does not enqueue a duplicate identify');
integrationScenarios += 1;
// A shared device stays ambiguous in the graph even when webhook identifies it.
const otherContact = { source_system: 'crm', source_scope: 'account', contact_key: 'c2', email: 'other@example.com' };
const otherObservation = { ...observation, observation_key: 'identified-other', occurred_at: '2026-01-10T11:55:00Z', email: otherContact.email, phone: null };
const shared = buildIdentityGraph({ ...graphInput, contacts: [contact, otherContact], identifies: [observation, otherObservation], touches: [{ ...touch, visitor_key: 'v1' }] });
const sharedResolution = resolveWebhookStitch({ ...input, recent_identity_edges: projectEdges(shared) });
check('equal', sharedResolution.resolution.visitor.visitor_key, 'v1');
const sharedAfter = buildIdentityGraph({ ...graphInput, contacts: [contact, otherContact], identifies: [observation, otherObservation, { ...identify, ...sharedResolution.resolution.visitor }], touches: [{ ...touch, visitor_key: 'v1' }] });
check('equal', sharedAfter.touch_links[0].status, 'ambiguous');
check('equal', sharedAfter.touch_links[0].reason, 'shared_device');
check('equal', sharedAfter.touch_links[0].contacts.length, 2);
integrationScenarios += 1;
// Matching one identity to multiple devices does not justify choosing the newest.
const ambiguousRecent = resolveWebhookStitch({ ...input, visitors: secondInput.visitors, recent_identity_edges: projectEdges(backfilled) });
check('equal', ambiguousRecent.resolution.status, 'created');
check('equal', ambiguousRecent.resolution.diagnostics[0].code, 'recent_visitor_ambiguous');
check('equal', ambiguousRecent.resolution.diagnostics[0].candidates.length, 2);
integrationScenarios += 1;
console.log(`executed ${executed} webhook fixtures (30 JSON + ${executed - 30} runtime errors); ${assertions} assertions; ${permutations} full-output permutations; ${mutations} mutated goldens rejected; ${integrationScenarios} graph integration scenarios`);

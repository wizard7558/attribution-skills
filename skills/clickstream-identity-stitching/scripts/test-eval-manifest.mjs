// Offline manifest construction and independent native-fixture/scorer verification.
// --write updates only the manifest; --evidence FILE writes private derivation evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalizeEmail, canonicalizePhone, hashIdentity, dedupeTouches } from './identity-primitives.mjs';
import { buildIdentityGraph } from './identity-graph.mjs';
import { resolveWebhookStitch } from './webhook-stitch.mjs';

const skill = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(skill, '../..');
const sha = (x) => createHash('sha256').update(x).digest('hex');
const copy = structuredClone;
const equal = (a, b) => { assertions++; assert.deepEqual(a, b); };
let assertions = 0;
const nativeEvidence = [], sources = {};
async function source(relative) { const bytes = await readFile(join(skill, relative)); sources[relative] = sha(bytes); return bytes.toString(); }
const primitive = JSON.parse(await source('references/primitive-fixtures.json')).cases;
const graph = JSON.parse(await source('references/graph-fixtures.json')).cases;
const webhook = JSON.parse(await source('references/webhook-fixtures.json')).cases;
for (const path of ['scripts/identity-primitives.mjs', 'scripts/identity-normalization.mjs', 'scripts/identity-graph.mjs', 'scripts/webhook-stitch.mjs', 'scripts/test-primitives.mjs', 'scripts/test-graph.mjs', 'scripts/test-webhook.mjs', 'references/identity-contract.md', 'references/graph-contract.md', 'references/webhook-contract.md']) await source(path);
const contract = await source('references/evaluation-output-contract.md');
const contexts = ['SKILL.md', 'references/identity-quick-reference.md'];
for (const path of contexts) await source(path);
const tuple = (row, field) => [row.source_system, row.source_scope, row.visitor_key, row[field]];
const contact = (row) => [row.source_system, row.source_scope, row.contact_key];
const visitor = (row) => [row.source_system, row.source_scope, row.visitor_key];
const category = (text) => /receipt payload/.test(text) ? 'conflicting_receipt_payload' : /older than existing/.test(text) ? 'late_replay_required' : /conflicting/.test(text) ? 'conflicting_key' : 'invalid_input';
const emptyDedupe = (error = null) => ({ error, canonical: null, kept: [], suppressed: [] });
const emptyGraph = (error) => ({ error, edges: [], observations: [], touches: [], future_excluded: null, shared_devices: [] });
const emptyWebhook = (error) => ({ error, receipt: [], replayed: null, status: null, method: null, visitor: null, new_visitor_scope: null, confidence: null, diagnostics: [] });
function ordered(rows, keyOf = (row) => row) {
  return [...rows].sort((a, b) => {
    const left = JSON.stringify(keyOf(a)), right = JSON.stringify(keyOf(b));
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
const orderingProbe = [['p', 's', 'a'], ['p', 's', 'Z'], ['p', 's', '_'], ['p', 's', 'A'], ['p', 's', 'z']];
const orderingGolden = [['p', 's', 'A'], ['p', 's', 'Z'], ['p', 's', '_'], ['p', 's', 'a'], ['p', 's', 'z']];
equal(ordered(freeze(copy(orderingProbe))), orderingGolden);
equal(ordered([['p', 's', '\uE000'], ['p', 's', '\u{1F600}']]), [['p', 's', '\u{1F600}'], ['p', 's', '\uE000']]);
const orderingMutants = [
  (rows) => [...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  (rows) => ordered(rows).reverse(),
];
for (const mutant of orderingMutants) { assertions++; assert.notDeepEqual(mutant(orderingProbe), orderingGolden); }
function project(kind, output, error) {
  if (kind === 'dedupe') return error ? emptyDedupe(error) : { ...emptyDedupe(), kept: output.touches.map((r) => tuple(r, 'touch_key')), suppressed: output.suppressed.map((r) => ({ key: tuple(r, 'touch_key'), reason: r.reason })) };
  if (kind === 'canonical') return { ...emptyDedupe(), canonical: output };
  if (kind === 'graph') return error ? emptyGraph(error) : {
    error: null, edges: ordered(output.edges.map((e) => ({ observation: JSON.parse(e.edge_key), contact: contact(e.contact) })), (e) => e.observation),
    observations: ordered(output.observations.map((o) => ({ key: tuple(o, 'observation_key'), status: o.status, candidates: ordered(o.candidates.map(contact)) })), (o) => o.key),
    touches: ordered(output.touch_links.map((t) => ({ key: tuple(t, 'touch_key'), status: t.status, reason: t.reason ?? null, contacts: ordered(t.contacts.map(contact)), evidence: ordered(t.edge_evidence_keys.map((key) => JSON.parse(key))) })), (t) => t.key),
    future_excluded: output.diagnostics.future_excluded,
    shared_devices: ordered(output.diagnostics.shared_devices.map((v) => ({ visitor: visitor(v), contacts: ordered(v.contacts.map(contact)) })), (v) => v.visitor),
  };
  return error ? emptyWebhook(error) : {
    error: null, receipt: JSON.parse(output.receipt_key), replayed: output.replayed, status: output.resolution.status,
    method: output.resolution.method, visitor: output.resolution.status === 'matched' ? visitor(output.resolution.visitor) : null,
    new_visitor_scope: output.resolution.status === 'created' ? visitor(output.resolution.visitor).slice(0, 2) : null,
    confidence: output.resolution.confidence,
    diagnostics: output.resolution.diagnostics.map((d) => ({ code: d.code, candidates: (d.candidates ?? []).map(visitor) })),
  };
}
// Independent visible-order golden from an additional native-produced graph.
// Deliberately use keys whose code-unit order differs from locale ordering.
const orderedLabels = ['A', '_'];
const nativeOrderingInput = {
  contacts: [{ source_system: 'c', source_scope: 's', contact_key: '_', email: 'b@example.test' }, { source_system: 'c', source_scope: 's', contact_key: 'A', email: 'a@example.test' }],
  identifies: ['_', 'A'].flatMap((v) => ['_', 'A'].map((o) => ({ source_system: 'p', source_scope: 's', visitor_key: v, observation_key: o, occurred_at: '2026-01-10T00:00:00Z', email: o === 'A' ? 'a@example.test' : 'b@example.test' }))),
  touches: ['_', 'A'].flatMap((v) => ['_', 'A'].map((t) => ({ source_system: 'p', source_scope: 's', visitor_key: v, touch_key: t, occurred_at: '2026-01-09T00:00:00Z', channel: 'Referral', taxonomy_version: '0.1.0' }))),
  identity_scope_bindings: [{ source_system: 'p', source_scope: 's', contact_source_system: 'c', contact_source_scope: 's' }], as_of: '2026-01-11T00:00:00Z', lookback_days: 2,
};
const nativeOrderingOutput = buildIdentityGraph(freeze(copy(nativeOrderingInput)));
const nativeOrderingBefore = copy(nativeOrderingOutput);
const literalOrderingProjection = {
  error: null,
  edges: orderedLabels.flatMap((v) => orderedLabels.map((o) => ({ observation: ['p','s',v,o], contact: ['c','s',o] }))),
  observations: orderedLabels.flatMap((v) => orderedLabels.map((o) => ({ key: ['p','s',v,o], status: 'matched', candidates: [['c','s',o]] }))),
  touches: orderedLabels.flatMap((v) => orderedLabels.map((t) => ({ key: ['p','s',v,t], status: 'ambiguous', reason: 'shared_device', contacts: [['c','s','A'],['c','s','_']], evidence: [['p','s',v,'A'],['p','s',v,'_']] }))),
  future_excluded: { identifies: 0, touches: 0 },
  shared_devices: orderedLabels.map((v) => ({ visitor: ['p','s',v], contacts: [['c','s','A'],['c','s','_']] })),
};
equal(project('graph', nativeOrderingOutput), literalOrderingProjection);
equal(nativeOrderingOutput, nativeOrderingBefore);
const legacyObservationOrder = copy(literalOrderingProjection);
legacyObservationOrder.observations = nativeOrderingOutput.observations.map((o) => ({ key: tuple(o,'observation_key'), status: o.status, candidates: o.candidates.map(contact) }));
assertions++; assert.notDeepEqual(legacyObservationOrder, literalOrderingProjection);
const orderingProbeEvidence = { input: nativeOrderingInput, native_output: nativeOrderingOutput, expected_projection: literalOrderingProjection, old_native_order_mutant_killed: true };
function invoke(kind, input) {
  if (kind === 'dedupe') return dedupeTouches(input.touches, { existing_touches: input.existing_touches ?? [] });
  if (kind === 'canonical') return input.operation === 'email' ? canonicalizeEmail(input.value) : canonicalizePhone(input.value);
  return kind === 'graph' ? buildIdentityGraph(input) : resolveWebhookStitch(input);
}
function select(kind, index) {
  const f = copy((kind === 'graph' ? graph : kind === 'webhook' ? webhook : primitive)[index]);
  const nativeKind = f.kind === 'value' ? 'canonical' : kind;
  if (nativeKind === 'canonical') f.input = { operation: f.actual, ...f.input };
  if (kind === 'dedupe' && index === 1) {
    // Reviewed reserved-domain substitution; independently authored canonical expected value.
    f.input.value = ' First.Last+tag@example.test ';
    f.expected = 'first.last+tag@example.test';
    f.derivation = 'Only raw/expected email domain replaced with reserved example.test; dots/plus/case/trim semantics retained.';
  }
  return { ...f, nativeKind, fixture_index: index, fixture_family: kind };
}
const p = (...indices) => indices.map((i) => select('dedupe', i));
const g = (...indices) => indices.map((i) => select('graph', i));
const w = (...indices) => indices.map((i) => select('webhook', i));
const pageConflict = select('webhook', 2);
pageConflict.input.page_rule_events.push({ ...pageConflict.input.page_rule_events[0], visitor_key: 'v2' });
pageConflict.kind = 'error'; delete pageConflict.expected; pageConflict.expectedError = 'conflicting';
pageConflict.derivation = 'Accepted dynamic page-event conflict test: duplicate qualified event key with another visitor.';
const semanticConflict = select('webhook', 2);
semanticConflict.input.receipts = [copy(semanticConflict.expected.receipt)];
semanticConflict.input.submission.occurred_at = '2026-01-10T12:00:01Z';
semanticConflict.kind = 'error'; delete semanticConflict.expected; semanticConflict.expectedError = 'conflicting receipt payload';
semanticConflict.derivation = 'Accepted dynamic receipt conflict test: semantic occurred_at changes under the same receipt key.';
const policyConflict = select('webhook', 2);
policyConflict.input.receipts = [copy(policyConflict.expected.receipt)];
policyConflict.input.policy.recent_visitor_window_minutes += 1;
policyConflict.kind = 'error'; delete policyConflict.expected; policyConflict.expectedError = 'conflicting receipt payload';
policyConflict.derivation = 'Accepted dynamic receipt conflict test: policy window changes under the same receipt key.';

const configuredConfidence = select('webhook', 2);
configuredConfidence.input.policy.confidence.recent_visitor = 0.37;
configuredConfidence.expected.resolution.confidence = 0.37;
configuredConfidence.expected.receipt.resolution.confidence = 0.37;
// Independent Python hashlib + sorted semantic JSON derivation, not resolver output.
configuredConfidence.expected.payload_sha256 = '4f52300a5347c8946ea32ecb47062e05b27030e7624bc475a4bfcbab4770af38';
configuredConfidence.expected.receipt.payload_sha256 = configuredConfidence.expected.payload_sha256;
configuredConfidence.derivation = 'Only configured recent confidence changes to 0.37; full expected resolution inherited, semantic fingerprint independently authored with Python hashlib and sorted semantic JSON.';

const definitions = [
  { id: 'dedup-and-direct-entry', operation: 'canonicalization or dedupeTouches', cases: [p(0,1,3,4),p(55),p(13),p(32,33),p(8,11,12),p(39,40,41),p(42,43,54),p(44,57),p(26,37),p(38,20)], decisions: { local_rules_are_destination_capi_rules: false, dedup_redefines_collector_sessions: false, incremental_late_input_requires_full_replay: true } },
  { id: 'non-destructive-identity-graph', operation: 'buildIdentityGraph', cases: [g(71,72),g(73,35),g(74,24),g(17,18,19,22),g(75,25,27),g(79,80,49),g(50,51,52,62),g(81,37),g(76,77,78),g(29,46)], decisions: { merge_ambiguous_contacts: false, overwrite_prior_observations: false, global_contacts_are_credit_candidates: false, equal_scope_names_authorize_binding: false, equal_ip_authorizes_identity: false, bare_ga4_id_authorizes_bridge: false, bare_posthog_id_authorizes_bridge: false, bare_segment_id_authorizes_bridge: false, bare_snowplow_id_authorizes_bridge: false, emit_raw_pii: false } },
  { id: 'webhook-stitch-and-receipts', operation: 'resolveWebhookStitch', cases: [w(0,1),w(4,5,6),[...w(2,9,10),configuredConfidence],w(11,12,13,14),w(17,3),[...w(18),pageConflict],w(24,25,28),[semanticConflict,policyConflict],w(26,27),w(15,16,22,29)], decisions: { confidence_is_calibrated_probability: false, ambiguous_graph_candidates_are_recent_evidence: false, caller_authentication_required: true, atomic_receipt_effects_outbox_required: true, qualified_unique_constraints_required: true, bounded_race_retry_after_rollback: true, replay_enqueues_duplicate_effects: false, business_event_id_separate_from_transport: true, outbox_consumer_idempotency_required: true, pure_function_guarantees_exactly_once: false, new_visitor_infers_prior_behavior: false } },
];

const S = { type: 'string' }, B = { type: 'boolean' }, N = { type: 'number' }, I = { type: 'integer' };
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
const arr = (items) => ({ type: 'array', items });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const key = arr(S), keys = arr(key);
const runSchemas = [
  obj({ label: S, error: nullable(S), canonical: nullable(S), kept: keys, suppressed: arr(obj({ key, reason: S })) }),
  obj({ label: S, error: nullable(S), edges: arr(obj({ observation: key, contact: key })), observations: arr(obj({ key, status: S, candidates: keys })), touches: arr(obj({ key, status: S, reason: nullable(S), contacts: keys, evidence: keys })), future_excluded: nullable(obj({ identifies: I, touches: I })), shared_devices: arr(obj({ visitor: key, contacts: keys })) }),
  obj({ label: S, error: nullable(S), receipt: key, replayed: nullable(B), status: nullable(S), method: nullable(S), visitor: nullable(key), new_visitor_scope: nullable(key), confidence: nullable(N), diagnostics: arr(obj({ code: S, candidates: keys })) }),
];
function checksFor(value, path = '') {
  if (Array.isArray(value)) return [{ path, op: 'array_length_equals', expected: value.length }, ...value.flatMap((v, i) => checksFor(v, `${path}/${i}`))];
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => checksFor(v, `${path}/${k}`));
  return [{ path, op: typeof value === 'number' && !Number.isInteger(value) ? 'approximately' : 'equals', expected: value, ...(typeof value === 'number' && !Number.isInteger(value) ? { tolerance: 1e-12 } : {}) }];
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const expected = [], manifest = { context_files: contexts, groups: [] };
for (const [groupIndex, definition] of definitions.entries()) {
  const inputCases = [], outputCases = [];
  for (const [caseIndex, runs] of definition.cases.entries()) {
    const label = String.fromCharCode(65 + caseIndex), base = copy(runs[0].input), inputRuns = [], outputRuns = [];
    for (const [runIndex, fixture] of runs.entries()) {
      const runLabel = String(runIndex + 1), before = copy(fixture.input);
      let actual, nativeError = null;
      if (fixture.kind === 'error') {
        assertions++; assert.throws(() => invoke(fixture.nativeKind, freeze(copy(fixture.input))), new RegExp(fixture.expectedError));
        try { invoke(fixture.nativeKind, fixture.input); } catch (error) { nativeError = error.message; }
        equal(category(nativeError), category(fixture.expectedError));
      } else { actual = invoke(fixture.nativeKind, freeze(copy(fixture.input))); equal(actual, fixture.expected); }
      equal(fixture.input, before);
      const expectedNativeBeforeProjection = copy(fixture.expected);
      const projected = project(fixture.nativeKind, fixture.expected, fixture.kind === 'error' ? category(fixture.expectedError) : null);
      equal(fixture.expected, expectedNativeBeforeProjection);
      if (fixture.kind !== 'error') equal(project(fixture.nativeKind, actual), projected);
      // Start with a full input; below, hoist common properties without inventing nulls.
      inputRuns.push({ label: runLabel, replace: copy(fixture.input), evidence: fixture.nativeKind === 'webhook' ? {
        identity_hashes: { email_hash: hashIdentity('email', fixture.input.submission.email), phone_hash: hashIdentity('phone', fixture.input.submission.phone) },
        semantic_payload_sha256: resolveWebhookStitch({ ...copy(fixture.input), receipts: [], page_rule_events: [], recent_identity_edges: [], visitors: [] }).payload_sha256,
      } : {} });
      outputRuns.push({ label: runLabel, ...projected });
      nativeEvidence.push({ group: definition.id, case: label, run: runLabel, fixture_family: fixture.fixture_family, fixture_index: fixture.fixture_index, fixture_name_private: fixture.name, derivation: fixture.derivation ?? 'Unchanged accepted full literal fixture.', input: fixture.input, expected_native: fixture.expected ?? null, actual_native: actual ?? null, expected_error_pattern: fixture.expectedError ?? null, actual_error: nativeError, expected_projection: projected });
    }
    // Hoist only properties identical in every run, so replacing needs no delete/merge convention.
    const common = Object.fromEntries(Object.entries(base).filter(([k,v]) => runs.every((r) => Object.hasOwn(r.input, k) && JSON.stringify(r.input[k]) === JSON.stringify(v))));
    for (const [i, r] of inputRuns.entries()) {
      r.replace = Object.fromEntries(Object.entries(r.replace).filter(([k]) => !Object.hasOwn(common, k)));
      equal({ ...copy(common), ...copy(r.replace) }, runs[i].input);
    }
    inputCases.push({ label, operation: runs[0].nativeKind, base_input: common, runs: inputRuns });
    outputCases.push({ label, runs: outputRuns });
  }
  const answer = { cases: outputCases, decisions: definition.decisions };
  expected.push(answer);
  const heading = contract.indexOf(`## ${definition.id}`), next = contract.indexOf('\n## ', heading + 1);
  const common = contract.slice(0, contract.indexOf('\n## '));
  const format = common + contract.slice(heading, next < 0 ? undefined : next);
  manifest.groups.push({ id: definition.id, prompt: `Evaluate ${definition.operation} for every independent run and answer the contract decision questions. Use the supplied precomputed evidence for identity hashes and semantic fingerprints; do not compute SHA-256. Return the compact projection described below.\n\n${format}`, input: { cases: inputCases }, output_schema: obj({ cases: arr(obj({ label: S, runs: arr(runSchemas[groupIndex]) })), decisions: obj(Object.fromEntries(Object.keys(definition.decisions).map((k) => [k, B]))) }), checks: checksFor(answer) });
}
const serialized = JSON.stringify(manifest, null, 2) + '\n';
const manifestPath = join(skill, 'references/eval-cases.json');
if (process.argv.includes('--write')) await writeFile(manifestPath, serialized);
equal(await readFile(manifestPath, 'utf8'), serialized);
equal(manifest.groups.map((g) => g.id), ['dedup-and-direct-entry','non-destructive-identity-graph','webhook-stitch-and-receipts']);
// Test transport and semantic mutations with the actual shared Python parser/schema/scorer.
const temp = await mkdtemp(join(tmpdir(), 'identity-eval-offline-'));
let scorer;
try {
  await writeFile(join(temp, 'expected.json'), JSON.stringify(expected));
  const python = String.raw`
import importlib.util,json,pathlib,sys,copy,hashlib
spec=importlib.util.spec_from_file_location('skill_eval',sys.argv[1]); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
skill=pathlib.Path(sys.argv[2]); manifest,contexts,digest=h.validate_manifest(skill)
answers=json.loads(pathlib.Path(sys.argv[3]).read_text()); probes=[]; groups=[]
def accepted(group,value):
    return h.schema_type_ok(value,group['output_schema']) and all(h.compare(c,value)['passed'] for c in group['checks'])
for g,a in zip(manifest['groups'],answers):
    assert accepted(g,h.parse_full_json(json.dumps(a)))
    prompt=h.prompt_for(g); request=json.loads(prompt)
    assert set(request)=={'prompt','input','output_schema'} and 'checks' not in request
    groups.append({'id':g['id'],'checks':len(g['checks']),'prompt_bytes':len(prompt.encode()),'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest(),'expected_compact_bytes':len(json.dumps(a,separators=(',',':')).encode()),'system_bytes':len(h.system_prompt('with-skill',{p:(skill/p).read_text() for p in contexts}).encode())})
def probe(name,group,change):
    a=copy.deepcopy(answers[group]); change(a); assert not accepted(manifest['groups'][group],a),name; probes.append(name)
probe('missing_case',0,lambda a:a['cases'].pop())
probe('extra_run',0,lambda a:a['cases'][0]['runs'].append(copy.deepcopy(a['cases'][0]['runs'][0])))
probe('unknown_phone_to_empty',0,lambda a:a['cases'][0]['runs'][2].update(canonical=''))
probe('below_30min_to_kept',0,lambda a:a['cases'][5]['runs'][0]['kept'].append(['pixel','ns-site','ns-browser','b']))
probe('late_increment_accepted',0,lambda a:a['cases'][7]['runs'][0].update(error=None))
probe('scope_erased',0,lambda a:a['cases'][4]['runs'][0]['kept'][0].__setitem__(1,'global'))
probe('journey_reordered',0,lambda a:a['cases'][2]['runs'][0]['kept'].reverse())
probe('ambiguity_dropped',1,lambda a:a['cases'][1]['runs'][0]['observations'][0].update(status='matched'))
probe('global_candidate_dropped',1,lambda a:a['cases'][2]['runs'][0]['touches'][0]['contacts'].pop())
probe('unknown_reason_invented',1,lambda a:a['cases'][2]['runs'][1]['touches'][0].update(reason='shared_device'))
probe('future_count_erased',1,lambda a:a['cases'][5]['runs'][0]['future_excluded'].update(identifies=0))
probe('implicit_binding',1,lambda a:a['decisions'].update(equal_scope_names_authorize_binding=True))
probe('replay_lost',2,lambda a:a['cases'][6]['runs'][0].update(replayed=False))
probe('receipt_scope_erased',2,lambda a:a['cases'][8]['runs'][1]['receipt'].__setitem__(1,'site'))
probe('recent_old_activity_matched',2,lambda a:a['cases'][3]['runs'][1].update(method='recent_visitor'))
probe('changed_policy_replayed',2,lambda a:a['cases'][7]['runs'][1].update(error=None,replayed=True))
probe('configured_confidence_defaulted',2,lambda a:a['cases'][2]['runs'][3].update(confidence=0.8))
probe('confidence_wrong_type',2,lambda a:a['cases'][0]['runs'][0].update(confidence='1'))
probe('outbox_atomicity_removed',2,lambda a:a['decisions'].update(atomic_receipt_effects_outbox_required=False))
probe('missing_required_null',0,lambda a:a['cases'][0]['runs'][2].pop('canonical'))
probe('extra_property',2,lambda a:a.update(invented=True))
for raw in ['{"x":NaN}','{"x":Infinity}','{} trailing']:
    try:h.parse_full_json(raw)
    except (ValueError,json.JSONDecodeError):pass
    else:raise AssertionError('parser accepted invalid transport')
# Independently verify the one derived confidence fixture fingerprint with Python hashlib.
c=manifest['groups'][2]['input']['cases'][2]; r=c['runs'][3]; i={**c['base_input'],**r['replace']}; sub=i['submission']
semantic={k:sub[k] for k in ('source_system','source_scope','provider','submission_key')}
semantic.update(occurred_at='2026-01-10T12:00:00.000Z',visitor_key=sub.get('visitor_key'),page_rule_event_key=sub.get('page_rule_event_key'),email_hash=hashlib.sha256(sub['email'].strip().lower().encode()).hexdigest(),phone_hash=None,policy=i['policy'])
assert hashlib.sha256(json.dumps(semantic,sort_keys=True,separators=(',',':')).encode()).hexdigest() == r['evidence']['semantic_payload_sha256'] == '4f52300a5347c8946ea32ecb47062e05b27030e7624bc475a4bfcbab4770af38'
historical_proof=[]
if sys.argv[4] != '-':
    old=json.loads(pathlib.Path(sys.argv[4]).read_text())
    assert manifest['context_files']==old['context_files']
    for index in (0,2):
        current=manifest['groups'][index];prior=old['groups'][index]
        for field in ('id','prompt','input','output_schema','checks'):assert current[field]==prior[field],(index,field)
        historical_proof.append({'group':current['id'],'prompt_sha256':h.digest_bytes(h.prompt_for(current).encode()),'input_sha256':h.digest_json(current['input']),'schema_sha256':h.digest_json(current['output_schema']),'checks_sha256':h.digest_json(current['checks']),'all_fields_identical_to_original':True})
    assert manifest['groups'][1]['input']==old['groups'][1]['input']
    assert manifest['groups'][1]['output_schema']==old['groups'][1]['output_schema']
    if sys.argv[5] != '-':
        raw=json.loads(pathlib.Path(sys.argv[5]).read_text());verified=[]
        for model,conditions in raw['models'].items():
            for condition,cells in conditions.items():
                for index in (0,2):
                    g=manifest['groups'][index];cell=cells[g['id']]
                    assert cell['prompt']==h.prompt_for(g)
                    assert cell['schema_sha256']==h.digest_json(g['output_schema'])
                    assert cell['system_prompt']==h.system_prompt(condition,{p:(skill/p).read_text() for p in contexts})
                    call=copy.deepcopy(cell['transport']);call['raw_envelope']=copy.deepcopy(cell['raw_envelope'])
                    again=h.evaluate_call(call,model,g,cell['prompt'],cell['prompt_sha256'],cell['context_sha256'],cell['cases_sha256'])
                    for field in ('parsed','resolved_model','completion_status','schema_status','check_status','errors'):assert again[field]==cell[field]
                    verified.append({'model':model,'condition':condition,'group':g['id'],'retained_original_manifest_sha256':cell['cases_sha256'],'unchanged_request_schema_context_checks':True})
        assert len(verified)==12
        historical_proof.append({'retained_original_cells':verified,'original_raw_sha256':h.digest_bytes(pathlib.Path(sys.argv[5]).read_bytes()),'new_model_calls':0})
print(json.dumps({'historical_non_graph_identity':historical_proof,'independent_confidence_fingerprint_verified':True,'manifest_sha256':digest,'context_sha256':contexts,'groups':groups,'semantic_and_structure_mutants_killed':probes,'parser_rejections':3,'baseline_scored_groups':len(groups)}))
`;
  const result = spawnSync('python3', ['-c', python, join(repository, 'scripts/run-skill-evals.py'), skill, join(temp, 'expected.json'), process.argv.includes('--original-manifest') ? resolve(process.argv[process.argv.indexOf('--original-manifest') + 1]) : '-', process.argv.includes('--original-results') ? resolve(process.argv[process.argv.indexOf('--original-results') + 1]) : '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout); assertions++;
  scorer = JSON.parse(result.stdout);
} finally { await rm(temp, { recursive: true, force: true }); }
for (const [path, digest] of Object.entries(sources)) equal(sha(await readFile(join(skill, path))), digest);
const harness = await readFile(join(repository, 'scripts/run-skill-evals.py'));
const evidence = { kind: 'offline_pre_live_review', model_calls: 0, executed_ordering_mutants_killed: orderingMutants.length + 1, additional_native_ordering_probe: orderingProbeEvidence, generated_at: new Date().toISOString(), node: process.version, assertions, native_runs: nativeEvidence.length, native_full_goldens: nativeEvidence.filter((e) => e.expected_error_pattern === null).length, unchanged_native_full_goldens: nativeEvidence.filter((e) => e.expected_error_pattern === null && e.derivation === 'Unchanged accepted full literal fixture.').length, native_error_runs: nativeEvidence.filter((e) => e.expected_error_pattern !== null).length, harness_sha256: sha(harness), source_sha256: sources, test_sha256: sha(await readFile(fileURLToPath(import.meta.url))), scorer, expected_projections: expected, native_derivation_private: nativeEvidence };
const evidenceIndex = process.argv.indexOf('--evidence');
if (evidenceIndex >= 0) { assert.ok(process.argv[evidenceIndex + 1]); await writeFile(resolve(process.argv[evidenceIndex + 1]), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' }); }
console.log(JSON.stringify({ status: 'PASS', assertions, native_runs: evidence.native_runs, full_goldens: evidence.native_full_goldens, error_runs: evidence.native_error_runs, mutants_killed: scorer.semantic_and_structure_mutants_killed.length, groups: scorer.groups.map((g) => ({ id: g.id, checks: g.checks, prompt_bytes: g.prompt_bytes, expected_compact_bytes: g.expected_compact_bytes, system_bytes: g.system_bytes })), manifest_sha256: scorer.manifest_sha256, model_calls: 0 }, null, 2));

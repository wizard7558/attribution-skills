import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { normalizePlatformIdentity, hashPlatformIdentity, buildMetaFbc } from './match-keys.mjs';
import { conversionFromStage, prepareConversion, makeConversionId } from './conversion-events.mjs';
import { buildGooglePayload, buildLinkedInPayload, buildMetaPayload, buildTikTokPayload, buildRedditPayload } from './provider-payloads.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, 'references', file), 'utf8'));
const keyFixtures = read('key-fixtures.json'); const conversionFixtures = read('conversion-fixtures.json').cases; const payloadFixtures = read('payload-fixtures.json').cases;
const platforms = ['meta', 'google', 'tiktok', 'linkedin', 'reddit'];
const find = (rows, id) => { const row = rows.find((f) => f.id === id); assert.ok(row, id); return row; };
const strip = (f, keys) => Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k)));
const clone = structuredClone;
const idRows = (suffix) => platforms.map((p) => find(keyFixtures.identity, `${p}-${suffix}`));
const keySets = [
  { identities: idRows('email-alias'), fbc: ['capture'] },
  { identities: idRows('phone-ext'), fbc: ['absent-click-null'] },
  { identities: idRows('email-non-gmail'), fbc: ['existing-sdk'] },
  { identities: idRows('email-spaces'), fbc: ['invalid-existing-empty'] },
];
// Expected values project independently authored literal fixtures, never helper outputs.
const keyCases = keySets.map((set, i) => ({ case: String.fromCharCode(65 + i), requests: [
  ...set.identities.map((f) => ({ operation: 'identity', input: { platform: f.platform, kind: f.kind, value: f.value } })),
  ...set.fbc.map((id) => ({ operation: 'fbc', input: strip(find(keyFixtures.fbc, id), ['id', 'expected', 'expected_error']) })),
] }));
const keyExpected = { cases: keySets.map((set, i) => ({ case: String.fromCharCode(65 + i), results: [
  ...set.identities.map((f) => ({ operation: 'identity', platform: f.platform, kind: f.kind, normalized: f.expected, hash: f.expected_hash, error: null })),
  ...set.fbc.map((id) => { const f = find(keyFixtures.fbc, id); return { operation: 'fbc', value: f.expected ?? null, error: f.expected_error ? 'TypeError' : null }; }),
] })) };
const conversionSets = [
  ['stage-nonprimary-zero', 'stage-unknown-currency', 'stage-exact-negative-decimal'],
  ['stage-native-ledger', 'stage-undated', 'stage-unknown', 'stage-false'],
  ['prepare-click-inclusive-microseconds', 'prepare-event-age-boundary', 'prepare-event-age-plus-microsecond', 'prepare-future-plus-microsecond'],
  ['prepare-qualified-exclusions', 'prepare-latest-qualified-tie-dedup', 'prepare-browser-override-zero-projection'],
];
const conversionCases = conversionSets.map((ids, i) => ({ case: String.fromCharCode(65 + i), requests: ids.map((id) => { const f = find(conversionFixtures, id); return { operation: f.operation, input: f.input }; }) }));
const conversionExpected = { cases: conversionSets.map((ids, i) => ({ case: String.fromCharCode(65 + i), results: ids.map((id) => { const f = find(conversionFixtures, id); return { operation: f.operation, result: f.expected }; }) })) };
const deliveryIds = ['google-all-signals-routing-consent', 'linkedin-email-click', 'meta-website-all-context', 'tiktok-custom-all-context', 'reddit-custom-ldu-qualified-url'];
const deliveryCases = deliveryIds.map((id, i) => { const f = find(payloadFixtures, id); return { case: String.fromCharCode(65 + i), platform: f.platform, input: f.input }; });
const scenario = {
  transport: 'loopback HTTP stub only; no provider endpoint contacted',
  enqueue: 'Use the actual bridge on a fresh domain and commit. Repeat identical input once.',
  changes: ['business_conversion_id', 'provider_event_id', 'request_body'],
  conflict_trials: 'Independently change only the specified field in the same domain after the first committed enqueue; preserve the other ID and body except for the stated change.',
  blocked_trial: 'In a separate pinned transaction update business state, invoke a blocked payload, propagate the error and roll back.',
  post_enqueue_trial: 'In another pinned transaction update business state and enqueue a distinct fresh event, inject an error after enqueue, then roll back.',
  sends: ['Claim the original queued event as worker-A; commit the claim; send its stored bytes.', 'Classify the stub 503 as retry with a future database available_at; complete with the current token.', 'Await database eligibility; claim as worker-B and commit; attempt a stale completion using worker-A and its old token.', 'Send the second claim; classify stub 200 as succeeded; complete with worker-B and its current token.'],
  request_parts: ['destination', 'business_conversion_id', 'provider_event_id', 'request_body', 'url', 'headers', 'authorization', 'api_version'],
};
// Literal analytic expectations, independently supported by accepted native evidence.
const review = {
  replay_disposition: 'replayed', replay_adds_audit: false,
  conflicts: ['business_conversion_id', 'provider_event_id', 'request_body'].map((change) => ({ change, code: 'P0001', preserves_row: true, preserves_audit: true })),
  blocked_rollback: { business_restored: true, outbox_restored: true, audit_restored: true },
  post_enqueue_rollback: { business_restored: true, outbox_restored: true, audit_restored: true },
  claim_transaction_open_during_send: false, retry_uses_stored_bytes: true, attempt_tokens: [1, 2], stale_completion_applied: false,
  audit_actions: ['enqueued', 'claimed', 'retry', 'claimed', 'succeeded'], final_state: 'succeeded',
  persisted_request_parts: ['destination', 'business_conversion_id', 'provider_event_id', 'request_body'], provider_acceptance_proven: false,
};
const deliveryExpected = { cases: deliveryIds.map((id, i) => { const e = find(payloadFixtures, id).expected; return { case: String.fromCharCode(65 + i), result: { status: e.status, reasons: e.reasons, destination: e.destination, body: e.request.body, diagnostics: e.diagnostics } }; }), review };
const expected = [keyExpected, conversionExpected, deliveryExpected];
const pointer = (x) => x.replaceAll('~', '~0').replaceAll('/', '~1');
function checks(value, at = '') {
  if (Array.isArray(value)) return [{ path: at, op: 'array_length_equals', expected: value.length }, ...value.flatMap((v, i) => checks(v, `${at}/${i}`))];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => checks(v, `${at}/${pointer(k)}`));
  // Native count/time integers are strict; finite fractional numbers allow numerical spelling equivalence.
  return [{ path: at, op: typeof value === 'number' && !Number.isInteger(value) ? 'approximately' : 'equals', expected: value, ...(typeof value === 'number' && !Number.isInteger(value) ? { tolerance: 1e-12 } : {}) }];
}
function schema(values) {
  const groups = new Map();
  for (const v of values) { const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v; const key = type === 'object' ? `${type}:${Object.keys(v).sort().join('|')}` : type; if (!groups.has(key)) groups.set(key, { type, values: [] }); groups.get(key).values.push(v); }
  const options = [...groups.values()].map(({ type, values }) => {
    if (type === 'object') { const keys = Object.keys(values[0]); return { type, properties: Object.fromEntries(keys.map((k) => [k, schema(values.map((v) => v[k]))])), required: keys, additionalProperties: false }; }
    if (type === 'array') return { type, items: values.flat().length ? schema(values.flat()) : { type: 'string' } };
    return { type };
  });
  return options.length === 1 ? options[0] : { anyOf: options };
}
// Neutral computation support: candidates come from raw inputs and alternative preprocessing,
// not expected answer fields. Every candidate digest is independently rechecked in Python below.
function identityPreimages(requests) {
  const out = new Set();
  for (const { kind, value } of requests) {
    if (typeof value !== 'string') continue;
    out.add(value); out.add(value.trim()); out.add(value.trim().toLowerCase());
    if (kind === 'email') {
      for (const text of [value.trim().toLowerCase(), value.replace(/\s/g, '').toLowerCase()]) {
        out.add(text); const [local, domain] = text.split('@');
        if (domain) for (const v of [local.split('+')[0], local.replaceAll('.', ''), local.split('+')[0].replaceAll('.', '')]) out.add(v + '@' + domain);
      }
    } else {
      const stripped = value.replace(/\s*(?:ext\.?|x)\s*[0-9]+\s*$/i, '').replace(/[\s().-]/g, '');
      out.add(stripped); out.add(stripped.replace(/^\+/, '')); out.add(value.replace(/[^0-9]/g, ''));
    }
  }
  return [...out];
}
function conversionPreimages(requests) {
  const out = new Set();
  for (const r of requests) {
    const c = r.operation === 'conversionFromStage' ? r.input : r.input.conversion ?? r.input;
    const key = r.operation === 'conversionFromStage' ? JSON.stringify([c.lead_key, c.stage_key]) : c.conversion_key;
    for (const tuple of [['conversion', 1, c.source_system, c.source_scope, key], ['conversion', 1, c.source_system, key], ['conversion', 1, c.source_scope, key]]) out.add(JSON.stringify(tuple));
    out.add(key);
  }
  return [...out];
}
function oracle(preimages) { return [...new Set(preimages)].sort().map((preimage_utf8) => ({ preimage_utf8, sha256: crypto.createHash('sha256').update(preimage_utf8, 'utf8').digest('hex') })); }
const keyOracle = oracle(identityPreimages(keyCases.flatMap((c) => c.requests.filter((r) => r.operation === 'identity').map((r) => r.input))));
const conversionOracle = oracle(conversionPreimages(conversionCases.flatMap((c) => c.requests)));
const deliveryOracle = oracle([
  ...identityPreimages(deliveryCases.flatMap((c) => Object.entries(c.input.identity).map(([kind, value]) => ({ kind, value })))),
  ...conversionPreimages(deliveryCases.map((c) => ({ operation: 'prepareConversion', input: c.input.preparation_input }))),
]);
// Public nullable fields remain nullable even when every selected case happens to be ready.
function nullableFields(s) {
  for (const [key, child] of Object.entries(s.properties ?? {})) {
    if (['normalized', 'hash', 'error'].includes(key)) s.properties[key] = { type: ['string', 'null'] };
    else { nullableFields(child); if (key === 'body') s.properties[key] = { anyOf: [child, { type: 'null' }] }; }
  }
  if (s.items) nullableFields(s.items);
  for (const child of s.anyOf ?? []) nullableFields(child);
  return s;
}
const manifest = { context_files: ['SKILL.md', 'references/key-contract.md', 'references/conversion-contract.md', 'references/payload-quick-reference.md', 'references/evaluation-output-contract.md'], groups: [
  { id: 'keys', prompt: 'Evaluate each ordered request and return its public evaluation projection. Preserve case and request order. Use the output contract when supplied.', input: { cases: keyCases, sha256_oracle: keyOracle } },
  { id: 'conversions', prompt: 'Evaluate each ordered public conversion operation and return its complete result in the evaluation projection. Preserve case and request order. Use the output contract when supplied.', input: { cases: conversionCases, sha256_oracle: conversionOracle } },
  { id: 'delivery', prompt: 'Build each requested provider projection and evaluate the supplied delivery scenario. Return the case results and review. Preserve case order. Use the output contract when supplied.', input: { cases: deliveryCases, scenario, sha256_oracle: deliveryOracle } },
].map((g, i) => ({ ...g, output_schema: nullableFields(schema([expected[i]])), checks: checks(expected[i]) })) };
const quick = fs.readFileSync(path.join(root, 'references/payload-quick-reference.md'), 'utf8');
const providerSource = fs.readFileSync(path.join(root, 'scripts/provider-payloads.mjs'), 'utf8');
const configBlock = providerSource.match(/const CONFIG_KEYS = \{([\s\S]*?)\n\};/)[1];
const configCoverage = {};
for (const row of configBlock.matchAll(/(reddit|tiktok|meta|google|linkedin): \[([^\]]+)\]/g)) {
  configCoverage[row[1]] = [...row[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const key of configCoverage[row[1]]) assert.ok(quick.includes(key), `quick reference missing configuration ${key}`);
}
assert.equal(Object.keys(configCoverage).length, 5);
const wireNames = new Set();
function collectWireKeys(v) { if (Array.isArray(v)) v.forEach(collectWireKeys); else if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) { wireNames.add(k); collectWireKeys(child); } }
for (const f of payloadFixtures) if (f.expected.request) collectWireKeys(f.expected.request.body);
for (const key of wireNames) assert.ok(quick.includes(key), `quick reference missing accepted wire key ${key}`);
for (const f of payloadFixtures) for (const word of [...f.expected.reasons, ...f.expected.diagnostics.warnings]) assert.ok(quick.includes(word) || fs.readFileSync(path.join(root, 'references/conversion-contract.md'), 'utf8').includes(word), `reference missing diagnostic ${word}`);
const manifestPath = path.join(root, 'references/eval-cases.json');
const serialized = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--write')) fs.writeFileSync(manifestPath, serialized);
assert.equal(fs.readFileSync(manifestPath, 'utf8'), serialized, 'manifest deterministic freshness');
// Actual production helpers verify every projected literal; they do not generate expected values.
for (let i = 0; i < keyCases.length; i++) for (let j = 0; j < keyCases[i].requests.length; j++) {
  const r = keyCases[i].requests[j]; let actual;
  if (r.operation === 'identity') actual = { operation: 'identity', platform: r.input.platform, kind: r.input.kind, normalized: normalizePlatformIdentity(r.input.platform, r.input.kind, r.input.value), hash: hashPlatformIdentity(r.input.platform, r.input.kind, r.input.value), error: null };
  else { try { actual = { operation: 'fbc', value: buildMetaFbc(r.input), error: null }; } catch (e) { assert.ok(e instanceof TypeError); actual = { operation: 'fbc', value: null, error: 'TypeError' }; } }
  assert.deepEqual(actual, keyExpected.cases[i].results[j]);
}
const operations = { conversionFromStage, prepareConversion, makeConversionId };
for (let i = 0; i < conversionCases.length; i++) for (let j = 0; j < conversionCases[i].requests.length; j++) { const r = conversionCases[i].requests[j]; assert.deepEqual(operations[r.operation](r.input), conversionExpected.cases[i].results[j].result); }
const builders = { google: buildGooglePayload, linkedin: buildLinkedInPayload, meta: buildMetaPayload, tiktok: buildTikTokPayload, reddit: buildRedditPayload };
for (let i = 0; i < deliveryCases.length; i++) { const c = deliveryCases[i]; const p = builders[c.platform](c.input); assert.deepEqual({ status: p.status, reasons: p.reasons, destination: p.destination, body: p.request.body, diagnostics: p.diagnostics }, deliveryExpected.cases[i].result); }
// Golden provenance and native evidence verification are optional to preserve portable offline use.
if (process.argv.includes('--native-evidence')) {
  const file = process.argv[process.argv.indexOf('--native-evidence') + 1]; const raw = JSON.parse(fs.readFileSync(file)); const e = raw.provider_integration;
  assert.equal(raw.status, 'passed'); assert.equal(e.status, 'passed'); assert.equal(e.cases.length, 5); assert.equal(e.receipts.length, 10);
  for (const c of e.cases) { const f = find(payloadFixtures, c.fixture_id); assert.equal(c.persisted.request_body, f.expected.request.request_body); assert.equal(c.final.state, review.final_state); assert.deepEqual(c.audit.map((a) => a.action), review.audit_actions); assert.deepEqual(c.attempts.map((a) => a.attempt_token), review.attempt_tokens); const r = e.receipts.filter((r) => r.outbox_id === c.persisted.outbox_id); assert.equal(r[0].body_base64, r[1].body_base64); assert.deepEqual(r[0].activity, { state: 'idle', xact_start: null }); }
  assert.ok(raw.groups.some((g) => g.status === 'passed' && /fenc|old.worker|lease/.test(g.name)), 'original native fencing checks');
  assert.ok(e.groups.some((g) => /rollback/.test(g.name) && g.status === 'passed'));
}
// Real frozen Python scorer/request construction: never emulate scoring in JavaScript.
const harness = process.env.CAPI_EVAL_HARNESS ?? path.resolve(root, '../../scripts/run-skill-evals.py');
assert.ok(fs.existsSync(harness), 'Set CAPI_EVAL_HARNESS to the frozen shared harness for a standalone copy');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capi-eval-check-'));
try {
  fs.writeFileSync(path.join(temp, 'expected.json'), JSON.stringify(expected));
  const python = String.raw`
import copy,hashlib,importlib.util,json,math,pathlib,re,sys
spec=importlib.util.spec_from_file_location('harness',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
assert h.HARNESS_VERSION=='2026-09-08.3'
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()=='b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45'
root=pathlib.Path(sys.argv[2]); manifest,hashes,sha=h.validate_manifest(root)
expected=json.load(open(sys.argv[3])); mutations=0;counts=[];sizes=[];vocabulary_audit=[];named_mutants=[]
try:
 import tiktoken
 enc=tiktoken.get_encoding('cl100k_base'); tokens=lambda s:len(enc.encode(s)); tokenizer='cl100k_base estimate, not provider tokenizer'
except ImportError:
 tokens=lambda s:len(s.encode('utf8'));tokenizer='conservative UTF8 byte upper bound'
contexts={p:(root/p).read_text() for p in manifest['context_files']}
def evaluated(g,x):
 return h.evaluate_call({'transport_exit_code':0,'raw_envelope':{'model':'qwen3:4b','message':{'content':json.dumps(x)}}},'qwen3:4b',g,h.prompt_for(g),'offline-prompt','offline-context','offline-manifest')
def passed(g,x):return sum(c['passed'] for c in evaluated(g,x)['check_status'])
for g,golden in zip(manifest['groups'],expected):
 h.validate_types_only_schema(g['output_schema'],'schema');assert h.schema_type_ok(golden,g['output_schema']);assert passed(g,golden)==len(g['checks'])
 request=h.prompt_for(g)
 for item in g['input']['sha256_oracle']:assert hashlib.sha256(item['preimage_utf8'].encode('utf8')).hexdigest()==item['sha256']
 assert set(g['input']['sha256_oracle'][0])=={'preimage_utf8','sha256'}
 oracle_hashes={r['sha256'] for r in g['input']['sha256_oracle']}
 for c in g['checks']:
  if isinstance(c['expected'],str) and re.fullmatch('[0-9a-f]{64}',c['expected']):assert c['expected'] in oracle_hashes, c['path']
 vocabulary_text='\n'.join(contexts.values())+json.dumps(g['input'],ensure_ascii=False)
 derived=[]
 for c in g['checks']:
  v=c['expected']
  if isinstance(v,str) and v not in vocabulary_text:
   # Only documented deterministic encodings may be absent verbatim; vocabulary may not.
   assert re.fullmatch('[0-9a-f]{64}',v) or v.startswith('fb.') or v.startswith('urn:lla:llaPartnerConversion:') or (c['path'].endswith('/conversion_key') and v.startswith('[')) or (c['path'].endswith('/event_type') and v.startswith('[')), (c['path'],v)
   derived.append(c['path'])
 vocabulary_audit.append({'group':g['id'],'missing_nonderived_literals':0,'derived_string_paths':derived})
 assert 'checks' not in json.loads(request)
 changed=copy.deepcopy(g);changed['checks']=[{'path':'/sentinel','op':'equals','expected':'EXPECTED_ONLY_719a'}]
 assert h.prompt_for(changed)==request and 'EXPECTED_ONLY_719a' not in h.system_prompt('with-skill',contexts) and 'EXPECTED_ONLY_719a' not in h.system_prompt('without-skill',contexts)
 assert all(c['case']==chr(65+i) for i,c in enumerate(g['input']['cases']))
 # Every scalar and array cardinality has exactly one check.
 def fields(x,p=''):
  if isinstance(x,list):return [(p,'array_length_equals')]+[z for i,v in enumerate(x) for z in fields(v,p+'/'+str(i))]
  if isinstance(x,dict):return [z for k,v in x.items() for z in fields(v,p+'/'+k.replace('~','~0').replace('/','~1'))]
  return [(p,'scalar')]
 a=fields(golden);b=[(c['path'],'array_length_equals' if c['op']=='array_length_equals' else 'scalar') for c in g['checks']];assert sorted(a)==sorted(b)
 def setpath(x,p,v,remove=False):
  parts=p.split('/')[1:];q=x
  for s in parts[:-1]:q=q[int(s)] if isinstance(q,list) else q[s.replace('~1','/').replace('~0','~')]
  k=int(parts[-1]) if isinstance(q,list) else parts[-1].replace('~1','/').replace('~0','~')
  if remove: del q[k]
  else:q[k]=v
 # Plausible field defects and structural failures exercise real scorer.
 candidates=[c for c in g['checks'] if c['op']!='array_length_equals' and c['path'].endswith(('/normalized','/hash','/value','/status','/reason','/event_id','/business_conversion_id','/currency','/event_type','/no_selected_clicks','/stale_completion_applied','/provider_acceptance_proven','/retry_uses_stored_bytes','/claim_transaction_open_during_send'))]
 for c in candidates:
  x=copy.deepcopy(golden);v=c['expected'];bad=(not v) if isinstance(v,bool) else (0 if v is None else None if isinstance(v,(int,float)) else v+'WRONG')
  setpath(x,c['path'],bad);assert passed(g,x)<len(g['checks']);mutations+=1
 for c in g['checks']:
  if c['op']=='array_length_equals':
   x=copy.deepcopy(golden);present,arr=h.json_pointer(x,c['path']);assert present
   arr.append(copy.deepcopy(arr[0]) if arr else 'extra');assert passed(g,x)<len(g['checks']);mutations+=1
   if len(arr)>2:
    x=copy.deepcopy(golden);_,arr=h.json_pointer(x,c['path']);arr.reverse()
    if arr!=h.json_pointer(golden,c['path'])[1]:assert passed(g,x)<len(g['checks']);mutations+=1
   break
 x=copy.deepcopy(golden);x['extra']=True;assert not h.schema_type_ok(x,g['output_schema']);assert 'schema_failure' in evaluated(g,x)['errors'];mutations+=1
 leaf=next(c for c in g['checks'] if c['op']!='array_length_equals');x=copy.deepcopy(golden);setpath(x,leaf['path'],None,True);assert not h.schema_type_ok(x,g['output_schema']);assert passed(g,x)<len(g['checks']);mutations+=1
 for bad in [float('nan'),float('inf'),float('-inf')]:
  x=copy.deepcopy(golden);setpath(x,leaf['path'],bad)
  try:h.ensure_finite(x);raise AssertionError('nonfinite accepted')
  except ValueError:pass
  assert not h.schema_type_ok(x,g['output_schema']);assert evaluated(g,x)['errors'];mutations+=1
 named=[]
 if g['id']=='keys':
  named=[('meta_uses_google_alias', '/cases/0/results/0/normalized', golden['cases'][0]['results'][1]['normalized']),('meta_phone_keeps_plus','/cases/1/results/0/normalized',golden['cases'][1]['results'][1]['normalized']),('linkedin_sends_phone','/cases/1/results/3/hash',golden['cases'][1]['results'][1]['hash']),('missing_click_fabricates_fbc','/cases/1/results/5/value',golden['cases'][0]['results'][5]['value']),('invalid_cookie_silently_missing','/cases/3/results/5/error',None)]
 elif g['id']=='conversions':
  named=[('nonprimary_suppresses_event','/cases/0/results/0/result/status','not_achieved'),('unknown_value_zero_filled','/cases/0/results/1/result/conversion/value',0),('negative_value_loses_sign','/cases/0/results/2/result/conversion/value',str(golden['cases'][0]['results'][2]['result']['conversion']['value']).lstrip('-')),('old_event_accepted','/cases/2/results/2/result/status','ready'),('browser_id_replaced_by_business_id','/cases/3/results/2/result/event_id',golden['cases'][3]['results'][2]['result']['business_conversion_id'])]
 else:
  named=[('reddit_destination_name_collision','/cases/4/result/destination/event_type',g['input']['cases'][4]['input']['configuration']['custom_event_name']),('stale_completion_wins','/review/stale_completion_applied',True),('retry_rebuilds_body','/review/retry_uses_stored_bytes',False),('network_inside_claim_transaction','/review/claim_transaction_open_during_send',True),('local_success_claims_provider_acceptance','/review/provider_acceptance_proven',True),('wrong_conflict_sqlstate','/review/conflicts/0/code','23505')]
 for name,p,v in named:
  x=copy.deepcopy(golden);setpath(x,p,v);assert passed(g,x)<len(g['checks']);mutations+=1;named_mutants.append(name)
 output=json.dumps(golden,ensure_ascii=False,indent=2);inputtokens=tokens(request+h.system_prompt('with-skill',contexts));outtokens=tokens(output)
 sizes.append({'group':g['id'],'request_with_context_estimated_tokens':inputtokens,'canonical_expected_output_estimated_tokens':outtokens,'output_headroom':8192-outtokens,'context_plus_output_budget':inputtokens+8192})
 assert inputtokens+8192<=28000, sizes[-1]
 assert outtokens+1024<8192,sizes[-1]
 counts.append({'group':g['id'],'cases':len(g['input']['cases']),'checks':len(g['checks']),'oracle_entries':len(g['input']['sha256_oracle'])})
assert h.compare({'path':'','op':'approximately','expected':5,'tolerance':1e-12},5.0)['passed']
assert not h.schema_type_ok(True,{'type':'integer'})
assert not h.schema_type_ok(1,{'type':'boolean'})
assert not h.compare({'path':'','op':'approximately','expected':5,'tolerance':1e-12},True)['passed']
print(json.dumps({'status':'passed','groups':counts,'mutations':mutations,'manifest_sha256':sha,'context_hashes':hashes,'harness_sha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest(),'tokenizer':tokenizer,'sizes':sizes,'vocabulary_audit':vocabulary_audit,'named_mutants':named_mutants}))
`;
  const run = spawnSync('python3', ['-c', python, harness, root, path.join(temp, 'expected.json')], { encoding: 'utf8' });
  if (run.status !== 0) { process.stderr.write(run.stderr); throw new Error('real scorer validation failed'); }
  const report = JSON.parse(run.stdout); report.quick_reference_coverage = { configuration_keys: configCoverage, accepted_wire_keys: [...wireNames].sort(), all_fixture_reason_and_warning_literals: true }; console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--evidence')) {
    const dest = process.argv[process.argv.indexOf('--evidence') + 1];
    const sourceFiles = ['scripts/match-keys.mjs', 'scripts/conversion-events.mjs', 'scripts/provider-payloads.mjs', 'scripts/provider-outbox.mjs', 'scripts/test-eval-manifest.mjs', 'references/sql/conversion_outbox.sql', 'references/key-fixtures.json', 'references/conversion-fixtures.json', 'references/payload-fixtures.json', 'references/implementation.md', 'references/eval.md', 'references/payload-quick-reference.md'];
    const source_hashes = Object.fromEntries(sourceFiles.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
    const nativeFile = process.argv.includes('--native-evidence') ? process.argv[process.argv.indexOf('--native-evidence') + 1] : null;
    const native_evidence_sha256 = nativeFile ? crypto.createHash('sha256').update(fs.readFileSync(nativeFile)).digest('hex') : null;
    fs.writeFileSync(dest, JSON.stringify({ ...report, source_hashes, native_evidence_sha256, verified_at: new Date().toISOString(), node_version: process.version, sql_execution: 'NO SQL EXECUTED', model_calls: 0 }, null, 2) + '\n');
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

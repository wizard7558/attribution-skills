import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectIdentity } from './project-identity.mjs';

const pixelRoot = fileURLToPath(new URL('../', import.meta.url));
const identityRoot = resolve(pixelRoot, '../clickstream-identity-stitching'); // Test fixture dependency only; production never infers this path.
const options = { identitySkillRoot: identityRoot };
const fixturePath = join(pixelRoot, 'references/identity-projection-fixtures.json');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const source = await readFile(new URL('./project-identity.mjs', import.meta.url), 'utf8');
const fixture = name => structuredClone(fixtures.cases.find(row => row.name === name));
const hash = value => createHash('sha256').update(value).digest('hex');
let assertions = 0, invalidCases = 0, permutations = 0;
const check = (method, ...args) => { assertions++; return assert[method](...args); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function permute(value, reverseArrays) {
  if (Array.isArray(value)) return (reverseArrays ? [...value].reverse() : value).map(item => permute(item, reverseArrays));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(key => [key, permute(value[key], reverseArrays)]));
  return value;
}
async function rejects(name, change, base = 'unique_match') {
  const input = fixture(base).input; change(input);
  let error;
  try { await projectIdentity(input, options); } catch (caught) { error = caught; }
  check('ok', error instanceof TypeError || error instanceof RangeError, name);
  check('ok', !String(error).includes('PII-SENTINEL'), `${name}: errors must not echo values`);
  invalidCases++;
}
const started = new Date().toISOString();
const report = { started_at: started, node: process.version, status: 'running', fixture_file_sha256: hash(await readFile(fixturePath)), hashes: {}, mutations: [], boundaries: ['Actual local identity engines; no model, database or hosted calls.', 'Fixture subjects and graph selections are independently specified literal full outputs.'] };
const reportPath = join(homedir(), 'Downloads', `first-party-pixel-identity-projection-evidence-${started.replaceAll(/[^0-9]/g, '')}.json`);
const scratch = await mkdtemp(join(tmpdir(), 'pixel-identity-projection-'));
try {
  check('equal', fixtures.contract_version, '0.1.0');
  check('equal', new Set(fixtures.cases.map(row => row.name)).size, fixtures.cases.length);
  for (const row of fixtures.cases) {
    check('deepEqual', Object.keys(row).sort(), ['expected', 'input', 'name']);
    const before = JSON.stringify(row.input);
    const actual = await projectIdentity(freeze(row.input), options);
    check('deepEqual', actual, row.expected, row.name);
    check('equal', JSON.stringify(row.input), before, `${row.name}: no mutation`);
    for (const reverseArrays of [false, true]) {
      const permuted = await projectIdentity(freeze(permute(row.input, reverseArrays)), options);
      check('deepEqual', permuted, row.expected, `${row.name}: full permutation`);
      check('equal', JSON.stringify(permuted), JSON.stringify(actual), `${row.name}: output bytes deterministic`);
      permutations++;
    }
  }
  const invocationCaptureCases = [
    ['legacy hash mutation repro', 'unknown_legacy_never_matches', (input) => { input.contacts[0].email_hash = input.observations[0].email_hash; }],
    ['contact attestation and hash', 'unknown_legacy_never_matches', (input) => { Object.assign(input.contacts[0], { email_hash: input.observations[0].email_hash, email_hash_format: 'canonical_sha256_v1', email_hash_status: 'attested', capture_status: 'eligible' }); }],
    ['binding array mutation', 'missing_binding', (input) => { input.config.identity_scope_bindings.push({ source_system: 'first_party_pixel', source_scope: 'site', contact_source_system: 'first_party_pixel', contact_source_scope: 'site' }); }],
    ['config as_of and invocation', 'unique_match', (input) => { input.config.as_of = '2025-01-01T00:00:00Z'; input.config.invocation_key = 'changed-invocation'; }],
    ['touch nested fields and array', 'unique_match', (input) => { input.touches[0].click_ids.gclid = 'changed-click'; input.touches[0].occurred_at = '2027-01-01T00:00:00Z'; input.touches.push({ invalid: true }); }],
    ['observation hash and time', 'unique_match', (input) => { input.observations[0].email_hash = 'f'.repeat(64); input.observations[0].occurred_at = '2027-01-01T00:00:00Z'; }],
    ['external catalog and evidence', 'external_crm_only_binding', (input) => { input.external_contacts[0].email_hash = 'f'.repeat(64); input.external_contact_evidence_ref = 'changed-external-reference'; input.snapshot_evidence_ref = null; }],
    ['dependency root primitive', 'unique_match', (input, rootOptions) => { rootOptions.identitySkillRoot = '/missing-mutated-root'; }]
  ];
  for (const [name, caseName, mutate] of invocationCaptureCases) {
    const sample = fixture(caseName), rootOptions = { ...options };
    const promise = projectIdentity(sample.input, rootOptions);
    // Deliberately synchronous: mutation happens before any Promise continuation.
    mutate(sample.input, rootOptions);
    const callerAfterMutation = JSON.stringify(sample.input);
    check('deepEqual', await promise, sample.expected, `${name}: validated invocation determines output`);
    check('equal', JSON.stringify(sample.input), callerAfterMutation, `${name}: caller remains untouched`);
    check('equal', Object.isFrozen(sample.input), false);
    check('equal', Object.isFrozen(sample.input.contacts), false);
  }
  report.invocation_capture_cases = invocationCaptureCases.map(([name]) => name);
  const captureNeedle = '  input = structuredClone(input);';
  check('equal', source.split(captureNeedle).length, 2);
  const sharingFile = join(scratch, 'old-shared-caller-references.mjs');
  await writeFile(sharingFile, source.replace(captureNeedle, '  // MUTANT: retain caller row references across await.'));
  const sharing = await import(pathToFileURL(sharingFile).href);
  const repro = fixture('unknown_legacy_never_matches');
  const reproPromise = sharing.projectIdentity(repro.input, options);
  repro.input.contacts[0].email_hash = repro.input.observations[0].email_hash;
  const unsafeResult = await reproPromise;
  check('equal', unsafeResult.touches[0].identity_status, 'matched', 'executed old sharing defect reproduced');
  check('notDeepEqual', unsafeResult, repro.expected, 'full original unresolved golden kills old sharing');
  report.invocation_capture_mutant = { killed: true, sha256: hash(await readFile(sharingFile)), old_status: unsafeResult.touches[0].identity_status, expected_status: repro.expected.touches[0].identity_status };
  const edits = [
    ['unknown top-level field', x => { x.extra = 'PII-SENTINEL'; }],
    ['missing top-level field', x => { delete x.contacts; }],
    ['unknown config field', x => { x.config.extra = true; }],
    ['raw config format', x => { x.config.identity_input_format = 'raw'; }],
    ['null config format', x => { x.config.identity_input_format = null; }],
    ['normalization version', x => { x.config.identity_normalization_version = '2'; }],
    ['missing binding array', x => { delete x.config.identity_scope_bindings; }],
    ['binding unknown field', x => { x.config.identity_scope_bindings[0].email = 'PII-SENTINEL'; }],
    ['binding empty scope', x => { x.config.identity_scope_bindings[0].source_scope = ''; }],
    ['zero lookback', x => { x.config.lookback_days = 0; }],
    ['NaN lookback', x => { x.config.lookback_days = NaN; }],
    ['infinite lookback', x => { x.config.lookback_days = Infinity; }],
    ['invalid as_of', x => { x.config.as_of = 'PII-SENTINEL'; }],
    ['snapshot evidence empty', x => { x.snapshot_evidence_ref = ''; }],
    ['invocation whitespace', x => { x.config.invocation_key = ' a '; }],
    ['array required', x => { x.observations = {}; }],
    ['null external contacts', x => { x.external_contacts = null; }],
    ['external evidence required', x => { x.external_contacts = [structuredClone(x.contacts[0])]; }],
    ['external evidence empty', x => { x.external_contacts = [structuredClone(x.contacts[0])]; x.external_contact_evidence_ref = ''; }],
    ['raw contact mixing', x => { x.contacts[0].email = 'PII-SENTINEL'; }],
    ['raw observation mixing', x => { x.observations[0].phone = 'PII-SENTINEL'; }],
    ['touch arbitrary metadata', x => { x.touches[0].metadata = { email: 'PII-SENTINEL' }; }],
    ['contact lowercase digest required', x => { x.contacts[0].email_hash = x.contacts[0].email_hash.toUpperCase(); }],
    ['contact digest length', x => { x.contacts[0].email_hash = 'a'.repeat(63); }],
    ['contact digest type', x => { x.contacts[0].email_hash = 123; }],
    ['contact digest whitespace', x => { x.contacts[0].email_hash += ' '; }],
    ['attestation missing', x => { x.contacts[0].email_hash_format = null; }],
    ['attestation null digest', x => { x.contacts[0].email_hash = null; }],
    ['missing status cannot expose hash', x => { x.contacts[0].email_hash_status = 'missing'; }],
    ['legacy cannot expose hash', x => { x.contacts[0].email_hash_status = 'legacy_unverified'; x.contacts[0].email_hash_format = null; x.contacts[0].capture_status = 'no_attested_identity'; }],
    ['unknown contact kind status', x => { x.contacts[0].email_hash_status = 'unknown'; }],
    ['contact eligibility contradiction', x => { x.contacts[0].capture_status = 'no_attested_identity'; }],
    ['contact current creation null', x => { x.contacts[0].native_created_at = null; }],
    ['native contact source', x => { x.contacts[0].source_system = 'crm'; }],
    ['observation digest type', x => { x.observations[0].email_hash = true; }],
    ['observation capture contradiction', x => { x.observations[0].capture_status = 'no_valid_identity'; }],
    ['observation format', x => { x.observations[0].identity_input_format = 'raw'; }],
    ['observation normalization', x => { x.observations[0].identity_normalization_version = '9'; }],
    ['observation event type', x => { x.observations[0].source_event_type = 'track'; }],
    ['observation invalid eligible date', x => { x.observations[0].occurred_at = '2026-02-30T00:00:00Z'; }],
    ['observation unauthorized malformed hash', x => { x.config.identity_scope_bindings = []; x.observations[0].email_hash = 'PII-SENTINEL'; }],
    ['observation future malformed hash', x => { x.observations[0].occurred_at = '2027-01-01T00:00:00Z'; x.observations[0].email_hash = 'PII-SENTINEL'; }],
    ['touch invalid eligible date', x => { x.touches[0].occurred_at = '2026-02-30T00:00:00Z'; }],
    ['touch nonpixel source', x => { x.touches[0].source_system = 'other'; }],
    ['touch scoped whitespace', x => { x.touches[0].visitor_key = ' v1 '; }],
    ['touch empty source', x => { x.touches[0].source_scope = ''; }],
    ['touch campaign type', x => { x.touches[0].utm_campaign = 1; }],
    ['click missing field', x => { delete x.touches[0].click_ids.srsltid; }],
    ['click extra field', x => { x.touches[0].click_ids.unknown = null; }],
    ['click nonstring', x => { x.touches[0].click_ids.gclid = false; }],
    ['native contact invalid type', x => { x.touches[0].native_contact_id = 1; }],
    ['touch unknown status', x => { x.touches[0].export_status = 'unknown'; }],
    ['touch version contradiction', x => { x.touches[0].taxonomy_version = null; }],
    ['touch channel contradiction', x => { x.touches[0].channel = 'Invalid'; }],
    ['touch conflicting duplicate', x => { x.touches.push({ ...structuredClone(x.touches[0]), native_contact_id: 'different-native' }); }],
    ['observation conflicting duplicate', x => { x.observations.push({ ...x.observations[0], source_event_type: 'form_submit' }); }],
    ['contact conflicting duplicate', x => { x.contacts.push({ ...x.contacts[0], native_created_at: '2001-01-01T00:00:00Z' }); }],
    ['native external conflicting duplicate', x => { x.external_contacts = [{ ...x.contacts[0], native_created_at: null }]; x.external_contact_evidence_ref = 'external-proof'; }],
    ['nonplain record', x => { x.touches[0].click_ids = new Date(); }],
    ['cyclic input', x => { x.contacts.push(x); }],
    ['sparse array', x => { x.touches.length = 3; }],
    ['array extra property', x => { x.touches.extra = true; }],
    ['array non-index numeric property', x => { x.touches['4294967295'] = true; }],
    ['function input', x => { x.contacts[0].native_created_at = () => 'PII-SENTINEL'; }],
    ['symbol property', x => { x[Symbol('PII-SENTINEL')] = true; }],
    ['nonenumerable property', x => { Object.defineProperty(x.contacts[0], 'hidden', { value: 1 }); }]
  ];
  for (const [name, change] of edits) await rejects(name, change);
  await rejects('excluded touch conflicting duplicate', x => { x.touches.push({ ...structuredClone(x.touches[0]), occurred_at: 'different-unjudged-time' }); }, 'source_rejections_no_temporal_judgment');
  await rejects('excluded observation conflicting duplicate', x => { x.observations.push({ ...x.observations[0], source_event_type: 'form_submit' }); }, 'source_rejections_no_temporal_judgment');
  await rejects('excluded observation missing format', x => { delete x.observations[0].identity_input_format; }, 'no_valid_identity');
  await rejects('excluded touch empty time', x => { x.touches[0].occurred_at = ''; }, 'source_rejections_no_temporal_judgment');
  let getterCalls = 0;
  await rejects('accessor never evaluated', x => { Object.defineProperty(x.contacts[0], 'email_hash', { enumerable: true, get() { getterCalls++; throw new Error('PII-SENTINEL'); } }); });
  check('equal', getterCalls, 0);
  const nullPrototype = fixture('unique_match');
  nullPrototype.input.contacts[0] = Object.assign(Object.create(null), nullPrototype.input.contacts[0]);
  check('deepEqual', await projectIdentity(nullPrototype.input, options), nullPrototype.expected);
  for (const badOptions of [undefined, {}, { identitySkillRoot: '' }, { identitySkillRoot: null }, { identitySkillRoot: '/nonexistent-explicit-identity-root' }, { identitySkillRoot: identityRoot, other: true }]) {
    await check('rejects', projectIdentity(fixture('unique_match').input, badOptions), TypeError);
  }

  // Observe sanitized arguments while delegating to copied, byte-exact actual engines.
  const instrumented = join(scratch, 'instrumented-identity');
  await cp(join(identityRoot, 'scripts'), join(instrumented, 'scripts'), { recursive: true });
  await rename(join(instrumented, 'scripts/identity-primitives.mjs'), join(instrumented, 'scripts/actual-primitives.mjs'));
  await rename(join(instrumented, 'scripts/identity-graph.mjs'), join(instrumented, 'scripts/actual-graph.mjs'));
  await writeFile(join(instrumented, 'scripts/identity-primitives.mjs'), `export * from './actual-primitives.mjs';\nimport { dedupeTouches as actual } from './actual-primitives.mjs';\nexport function dedupeTouches(...args) { globalThis.__pixelProjectionCalls.dedupe.push(structuredClone(args)); return actual(...args); }\n`);
  await writeFile(join(instrumented, 'scripts/identity-graph.mjs'), `import { buildIdentityGraph as actual } from './actual-graph.mjs';\nexport function buildIdentityGraph(...args) { globalThis.__pixelProjectionCalls.graph.push(structuredClone(args)); return actual(...args); }\n`);
  const previousCalls = globalThis.__pixelProjectionCalls;
  try {
    globalThis.__pixelProjectionCalls = { dedupe: [], graph: [] };
    const sample = fixture('legacy_and_per_kind_attestation');
    check('deepEqual', await projectIdentity(sample.input, { identitySkillRoot: instrumented }), sample.expected);
    const calls = globalThis.__pixelProjectionCalls;
    check('equal', calls.dedupe.length, 1); check('equal', calls.graph.length, 1);
    check('equal', calls.graph[0][0].contacts.length, 2, 'unknown contact must reach actual graph');
    check('deepEqual', calls.graph[0][0].contacts[0], { source_system: 'first_party_pixel', source_scope: 'site', contact_key: 'legacy', email_hash: null, phone_hash: null });
    check('deepEqual', calls.graph[0][0].identity_scope_bindings, sample.input.config.identity_scope_bindings);
    check('equal', calls.graph[0][0].identity_input_format, 'canonical_sha256_v1');
    check('ok', !JSON.stringify(calls.graph).includes('native_contact_id'));
    check('ok', !JSON.stringify(calls.graph).includes('native_created_at'));
    check('ok', !JSON.stringify(calls.graph).includes('source_event_type'));
    report.actual_engine_arguments = calls;
  } finally {
    if (previousCalls === undefined) delete globalThis.__pixelProjectionCalls; else globalThis.__pixelProjectionCalls = previousCalls;
  }

  const mutations = [
    ['native_contact_fallback', "const subject = link.status === 'matched' && link.contacts.length === 1 ? link.contacts[0] : null;", "const subject = link.status === 'matched' && link.contacts.length === 1 ? link.contacts[0] : row.native_contact_id ? { source_system: row.source_system, source_scope: row.source_scope, contact_key: row.native_contact_id } : null;", 'native_contact_is_never_subject'],
    ['automatic_binding', 'identity_scope_bindings: config.identity_scope_bindings.map(row => pick(row, BINDING_FIELDS)),', "identity_scope_bindings: config.identity_scope_bindings.length ? config.identity_scope_bindings : [{ source_system: 'first_party_pixel', source_scope: 'site', contact_source_system: 'first_party_pixel', contact_source_scope: 'site' }],", 'missing_binding'],
    ['drop_ambiguity_candidate', 'contacts: contacts.map(row => pick(row,', 'contacts: contacts.slice(0, 1).map(row => pick(row,', 'email_phone_candidate_ambiguity'],
    ['drop_unknown_contact', "const contacts = unique([...input.contacts, ...external], 'contact');", "const contacts = unique([...input.contacts, ...external].filter(row => row.capture_status === 'eligible'), 'contact');", 'unknown_legacy_never_matches'],
    ['legacy_hash_inclusion', "if (hash !== null || format !== null) invalid('unverified contact kind must expose null');", '/* MUTANT: accept unverified exposed digest */', null]
  ];
  for (const [name, needle, replacement, caseName] of mutations) {
    check('equal', source.split(needle).length, 2, `${name}: precise mutation target`);
    const file = join(scratch, `${name}.mjs`); await writeFile(file, source.replace(needle, replacement));
    const mutant = await import(pathToFileURL(file).href);
    let killed = false;
    if (caseName) {
      const sample = fixture(caseName);
      try { assert.deepEqual(await mutant.projectIdentity(sample.input, options), sample.expected); } catch (error) { if (error.code === 'ERR_ASSERTION') killed = true; else throw error; }
    } else {
      const input = fixture('unique_match').input;
      Object.assign(input.contacts[0], { email_hash_status: 'legacy_unverified', email_hash_format: null, capture_status: 'no_attested_identity' });
      try { await assert.rejects(mutant.projectIdentity(input, options), TypeError); } catch (error) { if (error.code === 'ERR_ASSERTION') killed = true; else throw error; }
    }
    check('equal', killed, true, name);
    report.mutations.push({ name, killed, mutant_sha256: hash(await readFile(file)) });
  }

  // Standalone copied pixel + installed identity directories, with no inferred sibling root.
  const copiedPixel = join(scratch, 'pixel-copy'), copiedIdentity = join(scratch, 'separately-installed-identity');
  await mkdir(join(copiedPixel, 'scripts'), { recursive: true });
  await writeFile(join(copiedPixel, 'scripts/project-identity.mjs'), source);
  await cp(join(identityRoot, 'scripts'), join(copiedIdentity, 'scripts'), { recursive: true });
  const copied = await import(pathToFileURL(join(copiedPixel, 'scripts/project-identity.mjs')).href);
  for (const name of ['unique_match', 'external_crm_only_binding', 'future_one_nanosecond', 'shared_device_a_b']) {
    const sample = fixture(name); check('deepEqual', await copied.projectIdentity(freeze(sample.input), { identitySkillRoot: copiedIdentity }), sample.expected);
  }
  const inputFile = join(scratch, 'input.json'); await writeFile(inputFile, JSON.stringify(fixture('unique_match').input));
  const command = (args) => spawnSync(process.execPath, [join(copiedPixel, 'scripts/project-identity.mjs'), ...args], { encoding: 'utf8', cwd: scratch });
  const cli = command(['--input', inputFile, '--identity-skill-root', 'separately-installed-identity']);
  check('equal', cli.status, 0, cli.stderr); check('deepEqual', JSON.parse(cli.stdout), fixture('unique_match').expected);
  const missing = command(['--input', inputFile]); check('equal', missing.status, 1); check('equal', missing.stdout, '');
  const absent = command(['--input', inputFile, '--identity-skill-root', 'absent']); check('equal', absent.status, 1); check('equal', absent.stdout, '');
  await mkdir(join(scratch, 'wrong-exports/scripts'), { recursive: true });
  for (const module of ['identity-primitives.mjs', 'identity-graph.mjs']) await writeFile(join(scratch, 'wrong-exports/scripts', module), 'export const wrong = true;\n');
  await check('rejects', projectIdentity(fixture('unique_match').input, { identitySkillRoot: join(scratch, 'wrong-exports') }), /lacks required engine exports/);
  await writeFile(inputFile, '{"PII-SENTINEL"'); const malformed = command(['--input', inputFile, '--identity-skill-root', copiedIdentity]);
  check('equal', malformed.status, 1); check('ok', !malformed.stderr.includes('PII-SENTINEL')); check('equal', malformed.stdout, '');
  report.cli = { valid_exit: cli.status, missing_root_exit: missing.status, absent_root_exit: absent.status, malformed_json_exit: malformed.status };
  for (const [label, path] of [
    ['project-identity.mjs', join(pixelRoot, 'scripts/project-identity.mjs')], ['test-identity-projection.mjs', fileURLToPath(import.meta.url)],
    ['identity-primitives.mjs', join(identityRoot, 'scripts/identity-primitives.mjs')], ['identity-graph.mjs', join(identityRoot, 'scripts/identity-graph.mjs')],
    ['identity-normalization.mjs', join(identityRoot, 'scripts/identity-normalization.mjs')]
  ]) report.hashes[label] = hash(await readFile(path));
  report.status = 'passed';
  report.counts = { assertions, literal_full_goldens: fixtures.cases.length, full_permutations: permutations, structural_rejections: invalidCases, executed_mutants: mutations.length + 1, invocation_capture_cases: invocationCaptureCases.length, copied_standalone_goldens: 4 };
  console.log(`PASS identity projection: ${fixtures.cases.length} literal full goldens, ${permutations} full permutations, ${invalidCases} structural rejections, ${mutations.length + 1} executed mutants, ${invocationCaptureCases.length} invocation capture cases, 4 standalone goldens; ${assertions} assertions; actual engines invoked`);
} catch (error) {
  report.status = 'failed'; report.failure = { name: error.name, message: error.message }; throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
  report.finished_at = new Date().toISOString(); report.scratch_removed = true;
  await mkdir(join(homedir(), 'Downloads'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${reportPath}`);
}

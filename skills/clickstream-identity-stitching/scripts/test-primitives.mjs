import assert from 'node:assert/strict';
import { readFile, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalizeEmail, canonicalizePhone, dedupeTouches, hashIdentity } from './identity-primitives.mjs';

const fixture = JSON.parse(await readFile(new URL('../references/primitive-fixtures.json', import.meta.url)));
let executed = 0;
for (const test of fixture.cases) {
  executed += 1;
  if (test.kind === 'value') assert.deepEqual(test.actual === 'hash' ? hashIdentity(test.input.kind, test.input.value) : test.actual === 'email' ? canonicalizeEmail(test.input.value) : canonicalizePhone(test.input.value), test.expected, test.name);
  else if (test.kind === 'error') {
    assert.throws(() => dedupeTouches(test.input.touches, { existing_touches: test.input.existing_touches || [] }), new RegExp(test.expectedError), test.name);
  } else if (test.kind === 'dedupe') {
    const before = structuredClone(test.input.touches);
    const existingBefore = structuredClone(test.input.existing_touches || []);
    const result = dedupeTouches(test.input.touches, { existing_touches: test.input.existing_touches || [] });
    assert.deepEqual(result, test.expected, test.name);
    assert.deepEqual(test.input.touches, before, `${test.name}: input mutation`);
    assert.deepEqual(test.input.existing_touches || [], existingBefore, `${test.name}: existing input mutation`);
  } else throw new TypeError(`unknown fixture kind: ${test.kind}`);
}
assert.ok(executed >= 25, 'fixture suite must contain at least 25 cases');
const mutation = structuredClone(fixture.cases.find((test) => test.name === 'exactly_30_minutes_kept'));
mutation.expected.touches = [];
assert.throws(() => assert.deepEqual(dedupeTouches(mutation.input.touches).touches, mutation.expected.touches, mutation.name), 'mutated expectation must fail');
console.log(`executed ${executed} typed primitive fixtures; mutation guard passed`);

// All dedupe goldens also retain complete output under reversed input order.
let permutations = 0;
for (const test of fixture.cases.filter((test) => test.kind === 'dedupe')) {
  assert.deepEqual(dedupeTouches([...test.input.touches].reverse(), { existing_touches: [...(test.input.existing_touches || [])].reverse() }), test.expected, `${test.name}: full permutation golden`);
  permutations += 1;
}
const source = await readFile(new URL('./identity-primitives.mjs', import.meta.url), 'utf8');
const mutants = [
  ['window', 'ns_window_below', 'occurredAtNs(touch.occurred_at) - occurredAtNs(prior.occurred_at) < 1800n * 1000000000n', 'Date.parse(touch.occurred_at) - Date.parse(prior.occurred_at) < 1800000'],
  ['sort', 'ns_reversed_lexical_keys', 'const left = occurredAtNs(a.occurred_at), right = occurredAtNs(b.occurred_at);', 'const left = Date.parse(a.occurred_at), right = Date.parse(b.occurred_at);'],
  ['late', 'ns_late_increment', 'occurredAtNs(touch.occurred_at) < occurredAtNs(priorLatest.occurred_at)', 'Date.parse(touch.occurred_at) < Date.parse(priorLatest.occurred_at)'],
  ['calendar', 'ns_year_zero_leap', 'd > days[m - 1]', 'd > new Date(Date.UTC(y, m, 0)).getUTCDate()'],
];
const scratch = await mkdtemp(join(tmpdir(), 'identity-primitives-ns-mutants-'));
try {
  await copyFile(new URL('./identity-normalization.mjs', import.meta.url), join(scratch,'identity-normalization.mjs'));
  for (const [name, caseName, from, to] of mutants) {
    assert.equal(source.split(from).length, 2, `${name}: exact mutant patch point`);
    const path = join(scratch, name+'.mjs'); await writeFile(path, source.replace(from,to));
    const mutant = await import(pathToFileURL(path));
    const test = fixture.cases.find((test) => test.name === caseName);
    assert.ok(test, caseName);
    let killed = false;
    try {
      if (test.kind === 'error') assert.throws(() => mutant.dedupeTouches(test.input.touches,{existing_touches:test.input.existing_touches || []}),new RegExp(test.expectedError));
      else assert.deepEqual(mutant.dedupeTouches(test.input.touches,{existing_touches:test.input.existing_touches || []}),test.expected);
    } catch { killed = true; }
    assert.ok(killed, `${name}: old behavior must fail its independent full golden`);
    console.log(`PASS executed old ${name} regression mutant rejected by ${caseName}`);
  }
} finally { await rm(scratch,{recursive:true,force:true}); }
console.log(`PASS ${permutations} full-output permutation goldens and ${mutants.length} executed temporal regression mutants`);

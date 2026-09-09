import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as profiler from './profile.mjs';

const fixtureFile = process.argv[2] ?? fileURLToPath(new URL('../references/fixtures.json', import.meta.url));
const fixtures = JSON.parse(await readFile(fixtureFile, 'utf8'));
assert.ok(fixtures.cases.length >= 28, 'at least 28 executable fixtures required');
const operations = new Set(['profileCrmAttribution', 'normalizeJoinValue', 'logicalFieldName', 'isCandidateField', 'isExcludedLabelValue', 'classifyShape', 'shapeDistribution', 'decideVerdict']);
const ids = new Set();
let executed = 0; let apiCount = 0; let apiSuccessCount = 0; let errorCount = 0; let goldenCount = 0;
for (const fixture of fixtures.cases) {
  assert.ok(!ids.has(fixture.id), `duplicate fixture: ${fixture.id}`); ids.add(fixture.id);
  assert.ok(operations.has(fixture.operation), `${fixture.id}: unknown operation`);
  const isApi = fixture.operation === 'profileCrmAttribution';
  const args = isApi ? [fixture.input] : fixture.args;
  assert.ok(Array.isArray(args), `${fixture.id}: executable arguments required`);
  const before = structuredClone(args);
  const invoke = () => profiler[fixture.operation](...args);
  try {
    if (fixture.expectedError !== undefined) {
      assert.equal(typeof fixture.expectedError, 'string');
      assert.throws(invoke, (error) => error instanceof TypeError && error.message.includes(fixture.expectedError));
      errorCount += 1;
    } else {
      assert.ok(fixture.expected && Object.keys(fixture.expected).length > 0, 'golden expected fields required');
      const result = invoke();
      for (const [field, expected] of Object.entries(fixture.expected)) {
        const actual = field === '$' ? result : field.split('.').reduce((value, key) => value?.[key], result);
        assert.deepEqual(actual, expected, `golden field ${field}`); goldenCount += 1;
      }
      if (isApi) {
        apiSuccessCount += 1;
        const reversed = structuredClone(fixture.input);
        reversed.source.rows.reverse(); reversed.adHistory.reverse(); reversed.ad_scope_bindings.reverse();
        assert.deepEqual(profiler.profileCrmAttribution(reversed), result, 'row and catalog permutation invariance');
        const serialized = JSON.stringify(result);
        for (const forbidden of ['fixture-sensitive-person@example.test', 'fixture-private@example.test', 'Summer%252BSale', '192.0.2.1']) assert.equal(serialized.includes(forbidden), false, `private value leaked: ${forbidden}`);
        for (const candidate of result.candidates) assert.deepEqual(Object.keys(candidate).sort(), ['crmField', 'logicalField', 'kind', 'platform', 'entityType', 'population', 'shapeDistribution', 'joinRates', 'verdict', 'confidence', 'diagnostics', ...(candidate.fuzzyCeiling !== undefined ? ['fuzzyCeiling'] : [])].sort());
      }
    }
    assert.deepEqual(args, before, 'input immutability');
  } catch (error) {
    throw new Error(`Fixture ${fixture.id} failed: ${error.message}`, { cause: error });
  }
  executed += 1; if (isApi) apiCount += 1;
  console.log(`PASS ${fixture.id}`);
}
assert.ok(apiCount >= 15, 'at least 15 full API fixtures required');
console.log(`PASS ${executed} executed cases: ${apiCount} full API (${apiSuccessCount} results, ${errorCount} structural errors), ${executed - apiCount} helper cases; ${goldenCount} golden field assertions; immutability for every case and permutation/privacy checks for every API result`);

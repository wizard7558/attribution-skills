import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { attributeLeads } from './attribute-leads.mjs';
import { classify, CHANNELS, TAXONOMY_VERSION } from './channel-taxonomy.mjs';
const fixturePath = process.argv[2] ?? fileURLToPath(new URL('../references/fixtures.json', import.meta.url));
const { cases } = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.ok(cases.length >= 35, 'at least 35 full API cases required');
let executed = 0; let errors = 0; let golden = 0; let parity = 0;
const ids = new Set();
const sorted = (rows) => [...rows].sort((a, b) => JSON.stringify([a.source_system, a.source_scope, a.lead_key]).localeCompare(JSON.stringify([b.source_system, b.source_scope, b.lead_key])));
for (const fixture of cases) {
  assert.ok(!ids.has(fixture.id), 'unique fixture IDs'); ids.add(fixture.id);
  const before = structuredClone(fixture.input);
  const invoke = () => attributeLeads(fixture.input.leads, fixture.input.options);
  try {
    if (fixture.expectedError !== undefined) {
      assert.throws(invoke, (error) => error instanceof TypeError && error.message.includes(fixture.expectedError)); errors += 1;
    } else {
      assert.ok(fixture.expected && Object.keys(fixture.expected).length, 'golden expected fields required');
      const result = invoke();
      for (const [field, expected] of Object.entries(fixture.expected)) {
        assert.deepEqual(field.split('.').reduce((value, key) => value?.[key], result), expected, `golden field ${field}`); golden += 1;
      }
      assert.equal(result.length, fixture.input.leads.length, 'all leads retained');
      for (const row of result) {
        assert.ok(CHANNELS.includes(row.channel));
        assert.equal(row.taxonomy_version, TAXONOMY_VERSION);
        assert.equal(row.attribution_basis, 'crm_paid_resolution');
        assert.ok(Array.isArray(row.candidate_ads));
        assert.equal(JSON.stringify(row).includes('fixture-secret@example.test'), false, 'unrelated or nested PII leaked');
        assert.deepEqual(Object.keys(row.raw_evidence).sort(), ['click_ids', 'current_utm', 'first_touch_click_ids', 'first_touch_utm', 'native_channel'].sort());
      }
      const reversed = structuredClone(fixture.input); reversed.leads.reverse();
      for (const key of ['source_map', 'source_patterns', 'ad_catalog', 'ad_scope_bindings']) reversed.options[key]?.reverse();
      assert.deepEqual(sorted(attributeLeads(reversed.leads, reversed.options)), sorted(result), 'per-key permutation invariance');
      if (fixture.canonicalEvidence) {
        const canonical = classify(fixture.canonicalEvidence);
        assert.equal(result[0].channel, canonical.channel); assert.equal(result[0].rule, canonical.rule_id); parity += 1;
      }
    }
    assert.deepEqual(fixture.input, before, 'inputs and options are immutable');
  } catch (error) { throw new Error(`Fixture ${fixture.id} failed: ${error.message}`, { cause: error }); }
  executed += 1; console.log(`PASS ${fixture.id}`);
}
console.log(`PASS ${executed} executed full API cases (${executed - errors} results, ${errors} structural errors), ${golden} golden fields, ${parity} raw canonical parity checks; immutability and per-key permutation/privacy checks passed`);

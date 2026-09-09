// Prove every golden expectation is consumed by the executable harness.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const fixtureFile = fileURLToPath(new URL('../references/fixtures.json', import.meta.url));
const harness = fileURLToPath(new URL('./run-checks.mjs', import.meta.url));
const fixtures = JSON.parse(await readFile(fixtureFile, 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'crm-profiler-fixture-check-'));
let rejected = 0;
try {
  const baseline = spawnSync(process.execPath, [harness], { encoding: 'utf8' });
  assert.equal(baseline.status, 0, baseline.stderr);
  for (let index = 0; index < fixtures.cases.length; index += 1) {
    const original = fixtures.cases[index];
    const fields = original.expectedError === undefined ? Object.keys(original.expected) : ['expectedError'];
    for (const field of fields) {
      const altered = structuredClone(fixtures);
      if (field === 'expectedError') altered.cases[index].expectedError += '-deliberate-invalid-expectation';
      else altered.cases[index].expected[field] = { deliberateInvalidExpectation: true };
      const alteredPath = join(directory, 'fixtures.json');
      await writeFile(alteredPath, JSON.stringify(altered));
      const result = spawnSync(process.execPath, [harness, alteredPath], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${original.id}.${field}: mutated expectation passed`);
      assert.ok(result.stderr.includes(`Fixture ${original.id} failed:`), `${original.id}.${field}: failed for the wrong reason: ${result.stderr}`);
      rejected += 1;
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(`PASS ${rejected} independently perturbed golden/error expectations rejected by the harness`);

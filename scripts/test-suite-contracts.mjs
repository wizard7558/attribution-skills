import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, TAXONOMY_VERSION } from '../skills/channel-taxonomy/scripts/channel-taxonomy.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repository, 'skills');
const canonicalContractPath = path.join(skillsRoot, 'channel-taxonomy/references/channel-contract.md');
const canonicalClassifierPath = path.join(skillsRoot, 'channel-taxonomy/scripts/channel-taxonomy.mjs');
const canonicalContract = await readFile(canonicalContractPath, 'utf8');
const canonicalClassifier = await readFile(canonicalClassifierPath, 'utf8');

async function skillDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(root, entry.name);
    try { await readFile(path.join(directory, 'SKILL.md'), 'utf8'); directories.push(directory); } catch {}
  }
  return directories.sort();
}

async function assertContractCopies(root, contract) {
  for (const directory of await skillDirectories(root)) {
    const target = path.join(directory, 'references/channel-contract.md');
    let actual;
    try { actual = await readFile(target, 'utf8'); } catch { throw new Error(`missing generated contract: ${target}`); }
    assert.equal(actual, contract, `stale generated contract: ${target}`);
  }
}

await assertContractCopies(skillsRoot, canonicalContract);
assert.equal(await readFile(path.join(skillsRoot, 'crm-paid-attribution/scripts/channel-taxonomy.mjs'), 'utf8'), canonicalClassifier, 'CRM classifier is not byte-identical to canonical classifier');
assert.equal(TAXONOMY_VERSION, '0.1.0');
assert.equal(classify({ click_ids: { gclid: 'raw-1' }, utm_source: 'newsletter', utm_medium: 'email' }).channel, 'Paid Search');
assert.equal(classify({ click_ids: { srsltid: 'search-1' }, utm_source: 'google', utm_medium: 'organic' }).channel, 'Organic Search');
assert.equal(classify({ utm_source: 'unmapped', utm_medium: 'mystery' }).channel, 'Other');
for (const required of ['record_kind', 'ad_scope_bindings', 'subject_source_system', 'spend_status', 'cohort', 'activity']) assert.ok(canonicalContract.includes(required), `contract missing ${required}`);

const temporary = await mkdtemp(path.join(os.tmpdir(), 'suite-contracts-'));
try {
  const good = path.join(temporary, 'good');
  const stale = path.join(temporary, 'stale');
  const missing = path.join(temporary, 'missing');
  for (const directory of [good, stale, missing]) await mkdir(path.join(directory, 'references'), { recursive: true });
  for (const directory of [good, stale, missing]) await writeFile(path.join(directory, 'SKILL.md'), '---\nname: fixture\n---\n');
  await writeFile(path.join(good, 'references/channel-contract.md'), canonicalContract);
  await writeFile(path.join(stale, 'references/channel-contract.md'), `${canonicalContract}\nSTALE`);
  await assert.rejects(() => assertContractCopies(temporary), /stale generated contract|missing generated contract/);
  const staleOnly = path.join(temporary, 'stale-only', 'fixture');
  await mkdir(path.join(staleOnly, 'references'), { recursive: true });
  await writeFile(path.join(staleOnly, 'SKILL.md'), '---\nname: fixture\n---\n');
  await writeFile(path.join(staleOnly, 'references/channel-contract.md'), `${canonicalContract}\nSTALE`);
  await assert.rejects(() => assertContractCopies(path.dirname(staleOnly)), /stale generated contract/);
  const missingOnly = path.join(temporary, 'missing-only', 'fixture');
  await mkdir(path.join(missingOnly, 'references'), { recursive: true });
  await writeFile(path.join(missingOnly, 'SKILL.md'), '---\nname: fixture\n---\n');
  await assert.rejects(() => assertContractCopies(path.dirname(missingOnly)), /missing generated contract/);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const generatedCheck = spawnSync(process.execPath, ['skills/channel-taxonomy/scripts/build-artifacts.mjs', '--repository', '--check'], { cwd: repository, encoding: 'utf8' });
assert.equal(generatedCheck.status, 0, generatedCheck.stderr || generatedCheck.stdout);
console.log('PASS suite contract copies, stale/missing detection, CRM classifier parity, and canonical behavior');

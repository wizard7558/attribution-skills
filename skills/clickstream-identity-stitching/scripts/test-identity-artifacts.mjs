import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLICK_ID_NAMES, IDENTITY_NORMALIZATION_VERSION, canonicalizeEmail, canonicalizePhone, touchSignature } from './identity-normalization.mjs';
import * as primitives from './identity-primitives.mjs';

let assertions = 0;
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
const here = path.dirname(fileURLToPath(import.meta.url));
const authorityPath = path.join(here, 'identity-normalization.mjs');
const builderPath = path.join(here, 'build-identity-artifacts.mjs');
const authorityBefore = await readFile(authorityPath);
const builderBefore = await readFile(builderPath);
check('equal', IDENTITY_NORMALIZATION_VERSION, '0.1.0');
check('equal', primitives.canonicalizeEmail, canonicalizeEmail, 'public canonicalizeEmail reexports the authority');
check('equal', primitives.canonicalizePhone, canonicalizePhone, 'public canonicalizePhone reexports the authority');
check('equal', primitives.CLICK_ID_NAMES, CLICK_ID_NAMES, 'public CLICK_ID_NAMES reexports the authority');
const signatures = [
  ['empty signature', { channel: 'Direct' }, '["Direct",null,[]]'],
  ['campaign normalization', { channel: 'Email', utm_campaign: ' +SUMMER%2520Launch+ ' }, '["Email","summer launch",[]]'],
  ['opaque click case and plus', { channel: 'Paid Search', utm_campaign: 'A+B', click_ids: { gclid: ' %252BAa%252B ' } }, '["Paid Search","a b",[["gclid","+Aa+"]]]'],
  ['placeholder clicks discarded', { channel: 'Other', click_ids: { gclid: 'NULL', fbclid: 'undefined', dclid: '[object object]', msclkid: '  ', ttclid: null } }, '["Other",null,[]]'],
  ['malformed encoding retained', { channel: 'Other', utm_campaign: '%ZZ', click_ids: { gclid: '%ZZ' } }, '["Other","%zz",[["gclid","%ZZ"]]]'],
  ['bounded five decoding passes', { channel: 'Email', utm_campaign: '%252525252541', click_ids: { gclid: '%252525252541' } }, '["Email","%41",[["gclid","%41"]]]'],
  ['unknown click fields excluded', { channel: 'Email', click_ids: { future_id: 'ignored', gclid: 'AbC' }, metadata: { email: 'private@example.com' } }, '["Email",null,[["gclid","AbC"]]]'],
  ['canonical name order', { channel: 'Paid Search', click_ids: { srsltid: 'S', fbclid: 'F', gclid: 'G', dclid: 'D' } }, '["Paid Search",null,[["dclid","D"],["gclid","G"],["fbclid","F"],["srsltid","S"]]]'],
  ['all thirteen names', { channel: 'Other', click_ids: Object.fromEntries(CLICK_ID_NAMES.map((name) => [name, name])) }, '["Other",null,[["dclid","dclid"],["gclid","gclid"],["gbraid","gbraid"],["wbraid","wbraid"],["msclkid","msclkid"],["fbclid","fbclid"],["ttclid","ttclid"],["rdt_cid","rdt_cid"],["li_fat_id","li_fat_id"],["twclid","twclid"],["epik","epik"],["sccid","sccid"],["srsltid","srsltid"]]]'],
];
for (const [name, input, expected] of signatures) {
  const before = structuredClone(input);
  check('equal', touchSignature(input), expected, name);
  check('deepEqual', input, before, `${name}: immutable`);
}
check('notEqual', touchSignature({ channel: 'Email', click_ids: { gclid: 'AbC' } }), touchSignature({ channel: 'Email', click_ids: { gclid: 'abc' } }), 'opaque IDs remain case-sensitive');
check('notEqual', touchSignature({ channel: 'Email', click_ids: { gclid: 'A+B' } }), touchSignature({ channel: 'Email', click_ids: { gclid: 'A B' } }), 'opaque plus is not a space');
const run = (script, args = [], cwd = path.dirname(script)) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const scratch = await mkdtemp(path.join(tmpdir(), 'identity-artifact-test-'));
try {
  const standalone = path.join(scratch, 'standalone', 'scripts');
  await mkdir(standalone, { recursive: true });
  await writeFile(path.join(standalone, 'identity-normalization.mjs'), authorityBefore);
  await writeFile(path.join(standalone, 'build-identity-artifacts.mjs'), builderBefore);
  for (const args of [[], ['--check']]) {
    const result = run(path.join(standalone, 'build-identity-artifacts.mjs'), args, scratch);
    check('equal', result.status, 0, `standalone ${args.join(' ')}: ${result.stderr}`);
    check('match', result.stdout, /no generated copies/);
  }
  check('deepEqual', await readdir(scratch), ['standalone'], 'standalone does not create siblings');
  const missingSibling = run(path.join(standalone, 'build-identity-artifacts.mjs'), ['--repository', '--check']);
  check('notEqual', missingSibling.status, 0);
  check('match', missingSibling.stderr, /requires the sibling/);
  const scripts = path.join(scratch, 'repository', 'skills', 'clickstream-identity-stitching', 'scripts');
  const pixel = path.join(scratch, 'repository', 'skills', 'first-party-pixel');
  const bundledPath = path.join(pixel, 'assets', 'collector', 'identity-normalization.mjs');
  await mkdir(scripts, { recursive: true }); await mkdir(pixel, { recursive: true });
  await writeFile(path.join(scripts, 'identity-normalization.mjs'), authorityBefore);
  await writeFile(path.join(scripts, 'build-identity-artifacts.mjs'), builderBefore);
  const generator = path.join(scripts, 'build-identity-artifacts.mjs');
  const missing = run(generator, ['--repository', '--check']);
  check('notEqual', missing.status, 0, 'missing copy fails');
  check('match', missing.stderr, /artifact is missing/);
  check('deepEqual', await readdir(pixel), [], 'missing --check creates no directory or file');
  const generated = run(generator, ['--repository']);
  check('equal', generated.status, 0, generated.stderr);
  check('deepEqual', await readFile(bundledPath), authorityBefore, 'generated copy is byte-exact');
  const modifiedBeforeCheck = (await stat(bundledPath)).mtimeMs;
  const current = run(generator, ['--repository', '--check']);
  check('equal', current.status, 0, current.stderr);
  check('equal', (await stat(bundledPath)).mtimeMs, modifiedBeforeCheck, 'passing --check does not rewrite target');
  const staleBytes = Buffer.concat([authorityBefore, Buffer.from('\n// stale test copy\n')]);
  await writeFile(bundledPath, staleBytes);
  const stale = run(generator, ['--repository', '--check']);
  check('notEqual', stale.status, 0, 'stale copy fails');
  check('match', stale.stderr, /artifact is stale/);
  check('deepEqual', await readFile(bundledPath), staleBytes, 'failing --check never repairs target');
  check('deepEqual', await readFile(path.join(scripts, 'identity-normalization.mjs')), authorityBefore, 'scratch source never mutated');
  const repaired = run(generator, ['--repository']);
  check('equal', repaired.status, 0, repaired.stderr);
  check('deepEqual', await readFile(bundledPath), authorityBefore, 'explicit generation repairs stale copy');
  const badArgument = run(generator, ['--unknown']);
  check('notEqual', badArgument.status, 0); check('match', badArgument.stderr, /Unknown argument/);
  // Execute actual ESM in a fresh VM realm with only language intrinsics: no
  // process, require, Buffer, Node imports, Web Crypto, DOM, or module transforms.
  const neutralScript = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import vm from 'node:vm';
    const context = vm.createContext({});
    for (const name of ['process', 'require', 'Buffer', 'crypto', 'TextEncoder', 'window', 'document']) assert.equal(vm.runInContext('typeof ' + name, context), 'undefined');
    const module = new vm.SourceTextModule(readFileSync(process.argv[1], 'utf8'), { context });
    assert.deepEqual(module.dependencySpecifiers, []);
    await module.link(() => { throw new Error('portable module attempted an import'); });
    await module.evaluate();
    assert.equal(module.namespace.canonicalizeEmail(' A.B+TAG@Gmail.com '), 'a.b+tag@gmail.com');
    assert.equal(module.namespace.canonicalizePhone('+1 (415) 555-0123 ext 99'), '+14155550123');
    assert.equal(module.namespace.canonicalizePhone('4155550123'), null);
    assert.equal(module.namespace.touchSignature({channel:'Email',utm_campaign:'A+B',click_ids:{gclid:'Ab+C'}}), '["Email","a b",[["gclid","Ab+C"]]]');
    console.log('runtime-neutral ESM passed');
  `;
  const neutral = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', neutralScript, authorityPath], { encoding: 'utf8' });
  check('equal', neutral.status, 0, neutral.stderr); check('match', neutral.stdout, /runtime-neutral ESM passed/);
} finally { await rm(scratch, { recursive: true, force: true }); }
check('deepEqual', await readFile(authorityPath), authorityBefore, 'repository source unchanged by artifact tests');
check('deepEqual', await readFile(builderPath), builderBefore, 'repository generator unchanged by artifact tests');
console.log(`PASS identity authority: ${signatures.length} exact signature goldens; ${assertions} assertions; standalone, missing/stale copy, no-write checks, and runtime-neutral ESM executed`);

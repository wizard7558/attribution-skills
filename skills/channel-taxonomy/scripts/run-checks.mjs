import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classify, classifyChannel, CHANNELS, TAXONOMY_VERSION, normalizeChannelLabel } from './channel-taxonomy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(here, '..', 'references', 'fixtures.json'), 'utf8'));
assert.equal(fixtures.taxonomy_version, TAXONOMY_VERSION);
assert.deepEqual(CHANNELS, ['Paid Search', 'Paid Social', 'Paid Other', 'Organic Search', 'Organic Social', 'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other']);
assert.ok(fixtures.cases.length >= 60, 'at least 60 hand-authored fixtures are required');
assert.deepEqual([...new Set(fixtures.cases.map((item) => item.expected))].sort(), [...CHANNELS].sort());

function clone(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
for (const item of fixtures.cases) {
  const input = clone(item.input);
  const before = clone(input);
  const result = classify(input);
  assert.equal(result.channel, item.expected, item.id);
  assert.ok(typeof result.rule_id === 'string' && result.rule_id.length > 0, `${item.id}: rule ID`);
  assert.equal(result.taxonomy_version, TAXONOMY_VERSION, `${item.id}: version`);
  assert.equal(classifyChannel(input), item.expected, `${item.id}: string API`);
  assert.deepEqual(input, before, `${item.id}: input was mutated`);
  const canonical = classifyChannel({ ...input });
  assert.equal(normalizeChannelLabel(canonical), canonical, `${item.id}: canonical idempotence`);
}

const sql = await readFile(path.join(here, '..', 'references', 'sql', 'classify_channels.sql'), 'utf8');
const match = sql.match(/AS r'''\n([\s\S]*?)\nreturn classifyChannel\(JSON\.parse\(input_json\)\);\n'''/);
assert.ok(match, 'generated UDF body is extractable');
const udf = vm.runInNewContext(`(function(input_json) { ${match[1]} return classifyChannel(JSON.parse(input_json)); })`);
for (const item of fixtures.cases) assert.equal(udf(JSON.stringify(item.input)), item.expected, `generated UDF: ${item.id}`);

for (const [input, expected] of [
  [{ native_channel: 'Affiliates' }, 'Affiliate'],
  [{ native_channel: 'Display' }, 'Paid Other'],
  [{ native_channel: 'AI Assistant' }, 'Referral'],
  [{ native_channel: 'Unassigned' }, 'Other']
]) assert.equal(normalizeChannelLabel(input.native_channel), expected);
for (const label of CHANNELS) {
  assert.equal(normalizeChannelLabel(normalizeChannelLabel(label)), label);
  assert.equal(classifyChannel({ native_channel: label }), label);
}

// Every assertion here also executes the generated BigQuery function body.
let matrixChecks = 0;
function check(input, expected, description) {
  assert.equal(classifyChannel(input), expected, description);
  assert.equal(udf(JSON.stringify(input)), expected, `UDF: ${description}`);
  matrixChecks += 1;
}
for (const [alias, expected] of [
  ['Affiliates', 'Affiliate'], ['Display', 'Paid Other'], ['Paid Shopping', 'Paid Other'],
  ['Cross-network', 'Paid Other'], ['Paid Video', 'Paid Other'], ['Paid Audio', 'Paid Other'],
  ['Audio', 'Paid Other'], ['Organic Video', 'Organic Social'], ['Organic Shopping', 'Organic Search'],
  ['AI Assistant', 'Referral'], ['Unassigned', 'Other'], ['unknown', 'Other'], [null, 'Other'],
  ['(not set)', 'Other'], ['mobile push', 'Other'], ['SMS', 'SMS']
]) check({ native_channel: alias }, expected, `native alias ${alias}`);

for (const [category, expected, source] of [
  ['paid search', 'Paid Search', 'facebook'], ['paid social', 'Paid Social', 'google'],
  ['paid other', 'Paid Other', 'google'], ['paid video', 'Paid Other', 'facebook']
]) for (const separator of [' ', '_', '-']) {
  check({ utm_medium: category.replace(' ', separator), utm_source: source }, expected, `explicit category ${category} / ${separator}`);
}

for (const [hosts, expected] of [
  [['google.com', 'google.co.uk', 'google.com.au', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'yandex.com', 'yandex.ru', 'ecosia.org', 'search.brave.com', 'ask.com', 'aol.com'], 'Organic Search'],
  [['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'reddit.com', 'pinterest.com', 'snapchat.com', 'youtube.com', 't.co'], 'Organic Social']
]) for (const host of hosts) {
  check({ utm_source: `sub.${host}` }, expected, `source subdomain ${host}`);
  check({ referrer: `https://sub.${host}/post` }, expected, `referrer subdomain ${host}`);
  check({ utm_source: `${host}.evil.test` }, 'Other', `source spoof ${host}`);
  check({ referrer: `https://${host}.evil.test/post` }, 'Referral', `referrer spoof ${host}`);
}

let encodedEmail = '%65mail';
for (let passes = 1; passes <= 6; passes += 1) {
  const expected = passes <= 5 ? 'Email' : 'Other';
  check({ utm_medium: encodedEmail }, expected, `decode explicit ${passes} passes`);
  check({ landing_url: `https://shop.test/?utm_medium=${encodedEmail}` }, expected, `decode query ${passes} passes`);
  check({ native_channel: encodedEmail }, expected, `decode native ${passes} passes`);
  encodedEmail = encodedEmail.replace(/%/g, '%25');
}


console.log(`PASS ${fixtures.cases.length} fixtures, ${matrixChecks} matrix checks, ${CHANNELS.length} labels, module/UDF parity, immutability, and idempotence`);

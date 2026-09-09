import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { conversionFromStage, makeConversionId, prepareConversion } from './conversion-events.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../references/conversion-fixtures.json', import.meta.url)));
const operations = { conversionFromStage, makeConversionId, prepareConversion };
const byId = (id) => fixtures.cases.find((fixture) => fixture.id === id);
const clone = (value) => structuredClone(value);
let assertions = 0;
let adversarialCases = 0;
let mutations = 0;
function check(condition, label) { assert.ok(condition, label); assertions += 1; }
function equal(actual, expected, label) { check(isDeepStrictEqual(actual, expected), label); }
function reject(callback, label) {
  let error;
  try { callback(); } catch (caught) { error = caught; }
  check(error instanceof TypeError, label);
  adversarialCases += 1;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function verify(fixture, operation = operations[fixture.operation]) {
  const before = clone(fixture.input);
  const result = operation(freeze(clone(fixture.input)));
  equal(result, fixture.expected, `${fixture.id}: full output`);
  equal(fixture.input, before, `${fixture.id}: input unchanged`);
}
function detected(fixture, mutant) {
  let error;
  try { verify(fixture, mutant); } catch (caught) { error = caught; }
  check(error instanceof assert.AssertionError, `${fixture.id}: mutation detected`);
  mutations += 1;
}

check(fixtures.cases.length === 28, '28 full-output goldens present');
check(new Set(fixtures.cases.map(({ id }) => id)).size === 28, 'unique fixture labels');
for (const fixture of fixtures.cases) verify(fixture);
const base = () => clone(byId('prepare-browser-override-zero-projection').input);
const stage = () => clone(byId('stage-nonprimary-zero').input);
const idBase = byId('id-base');
const stableId = makeConversionId(idBase.input);
equal(stableId, idBase.expected, 'independent base ID');
check(stableId !== byId('id-scope').expected, 'source scopes separate business IDs');
check(byId('id-delimiter-left').expected !== byId('id-delimiter-right').expected, 'JSON identity delimiter separation');
for (const extra of [{ occurred_at: '2024-01-01T00:00:00Z' }, { value: 12, currency: 'USD' }, { platform: 'reddit', destination: 'other-destination' }, { email: 'synthetic@example.invalid', ip: '192.0.2.1' }]) {
  equal(makeConversionId({ ...idBase.input, ...extra }), stableId, 'mutable metadata excluded from business ID');
}
for (const change of [{ stage_entered_at: '2026-01-03T00:00:00Z' }, { value: 123 }, { is_attribution_primary: true }, { stage_entered_at: '2026-01-04T00:00:00Z', value: '123.123456789' }]) {
  equal(conversionFromStage({ ...stage(), ...change }).business_conversion_id, byId('stage-nonprimary-zero').expected.business_conversion_id, 'stage ID stable under mutable facts');
}
const stageLeft = conversionFromStage({ ...stage(), lead_key: 'Lead|a', stage_key: 'b' });
const stageRight = conversionFromStage({ ...stage(), lead_key: 'Lead', stage_key: 'a|b' });
equal(stageLeft.conversion.conversion_key, '["Lead|a","b"]', 'stage tuple JSON key');
check(stageLeft.business_conversion_id !== stageRight.business_conversion_id, 'stage tuple delimiter separation');
for (const platform of ['meta', 'google', 'tiktok', 'linkedin', 'reddit']) {
  const input = base(); input.platform = platform; input.destination = 'changed'; input.conversion.value = 33; input.conversion.occurred_at = '2026-01-02T01:00:00Z';
  equal(prepareConversion(input).business_conversion_id, byId('prepare-browser-override-zero-projection').expected.business_conversion_id, 'business ID stable through prepare API');
  equal(prepareConversion(input).event_id, input.browser_event_id, 'browser override retained across destinations');
}
for (const value of [null, undefined]) {
  const input = base(); input.browser_event_id = value;
  const result = prepareConversion(input);
  equal(result.event_id, result.business_conversion_id, 'absent browser ID uses business ID');
}
const opaque = base(); opaque.browser_event_id = 'Browser Event+%2F' + 'x'.repeat(512);
equal(prepareConversion(opaque).event_id, opaque.browser_event_id, 'opaque browser ID not trimmed hashed or truncated');
const omittedSubject = base();
for (const field of ['subject_source_system', 'subject_source_scope', 'subject_key']) delete omittedSubject.conversion[field];
for (const field of ['subject_source_system', 'subject_source_scope', 'subject_key']) equal(prepareConversion(omittedSubject).conversion[field], null, 'omitted subject remains unknown');

// Validate malformed rows even when stage truth or click eligibility would discard them.
for (const achieved of [false, null, true]) {
  for (const [field, value] of [['source_scope', ' bad '], ['lead_key', ''], ['stage_key', 1], ['stage_entered_at', '2026-02-30T00:00:00Z'], ['value', 1], ['is_attribution_primary', null]]) {
    const row = { ...stage(), achieved, [field]: value };
    if (field === 'value') row.value_status = 'unknown';
    reject(() => conversionFromStage(row), 'stage invalid fields rejected regardless of achievement');
  }
}
for (const achieved of ['true', 1, undefined, {}, []]) reject(() => conversionFromStage({ ...stage(), achieved }), 'achieved requires boolean or null');
for (const field of ['source_system', 'source_scope', 'conversion_key']) {
  for (const value of ['', ' ', ' padded', 'padded ', 'bad\nkey', null, 1, {}, []]) {
    reject(() => makeConversionId({ ...idBase.input, [field]: value }), 'invalid qualified conversion identity');
    const input = base(); input.conversion[field] = value;
    reject(() => prepareConversion(input), 'invalid conversion key in prepare');
  }
}
for (const value of ['', ' ', ' padded', 'padded ', 'bad\nkey', 12, false, {}, []]) {
  const input = base(); input.browser_event_id = value;
  reject(() => prepareConversion(input), 'invalid explicit browser ID');
}
for (const value of ['', ' bing ', 'bing', null, 1, {}, []]) {
  const input = base(); input.platform = value;
  reject(() => prepareConversion(input), 'invalid platform');
}
for (const field of ['subject_source_system', 'subject_source_scope', 'subject_key']) {
  for (const value of ['partial', '', ' padded ', 12, false]) {
    const input = base(); input.conversion[field] = value;
    reject(() => prepareConversion(input), 'incomplete or malformed subject qualification');
  }
}

const badTimes = [
  '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2100-02-29T00:00:00Z',
  '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z',
  '2026-01-00T00:00:00Z', '2026-01-02T24:00:00Z', '2026-01-02T00:60:00Z',
  '2026-01-02T00:00:60Z', '2026-01-02T00:00:00+14:01', '2026-01-02T00:00:00-14:01',
  '2026-01-02T00:00:00+15:00', '2026-01-02T00:00:00+13:60',
  '2026-01-02T00:00:00', '2026-01-02T00:00:00.Z', '2026-01-02T00:00:00.1234567890Z',
  ' 2026-01-02T00:00:00Z', '2026-01-02', null, 123, undefined,
];
for (const time of badTimes) {
  if (time !== null) reject(() => conversionFromStage({ ...stage(), achieved: false, stage_entered_at: time }), 'invalid stage calendar');
  for (const target of ['conversion', 'policy', 'click']) {
    const input = base();
    if (target === 'conversion') input.conversion.occurred_at = time;
    else if (target === 'policy') input.policy.as_of = time;
    else { input.click_observations[0].occurred_at = time; input.click_observations[0].conversion_key = 'unrelated'; }
    reject(() => prepareConversion(input), 'invalid calendar in all timestamp positions');
  }
}
for (const time of ['2024-02-29T23:59:59.123456789Z', '2000-02-29T00:00:00Z', '2026-01-02T14:00:00+14:00', '2026-01-01T10:00:00-14:00', '2026-01-02T00:00:00.1Z']) {
  const input = base(); input.conversion.occurred_at = time; input.policy.as_of = time; input.click_observations = [];
  equal(prepareConversion(input).status, 'ready', 'valid leap offset and fraction timestamps');
}
const equivalentOffset = base(); equivalentOffset.conversion.occurred_at = '2026-01-02T14:00:00.123456789+14:00'; equivalentOffset.policy.as_of = '2026-01-02T00:00:00.123456789Z';
equal(prepareConversion(equivalentOffset).status, 'ready', 'equivalent instants retain nanoseconds across offsets');
for (const [asOf, status] of [
  ['2026-01-09T00:00:00.123455789Z', 'ready'],
  ['2026-01-09T00:00:00.123456790Z', 'ineligible'],
  ['2026-01-02T00:00:00.123456788Z', 'ineligible'],
  ['2026-01-02T00:00:00.123456789Z', 'ready'],
]) {
  const input = base(); input.policy.as_of = asOf;
  equal(prepareConversion(input).status, status, 'event inclusive nanosecond boundary');
}
for (const field of ['max_event_age_days', 'click_lookback_days']) {
  for (const value of [0, -1, NaN, Infinity, -Infinity, '7', null, undefined, true, {}]) {
    const input = base(); input.policy[field] = value;
    reject(() => prepareConversion(input), 'invalid policy day limit');
  }
}
for (const [asOf, status] of [['2026-01-02T00:00:00.000008640Z', 'ready'], ['2026-01-02T00:00:00.000008641Z', 'ineligible']]) {
  const input = base(); input.conversion.occurred_at = '2026-01-02T00:00:00Z'; input.policy.as_of = asOf; input.policy.max_event_age_days = 1e-10;
  equal(prepareConversion(input).status, status, 'scientific fractional policy compared without rounding');
}
const giantPolicy = base(); giantPolicy.policy.max_event_age_days = Number.MAX_VALUE;
equal(prepareConversion(giantPolicy).status, 'ready', 'finite huge policy never overflows');
for (const [time, status] of [['2026-01-02T00:00:00.123456789Z', 'ready'], ['2026-01-02T00:00:00.123456790Z', 'ineligible']]) {
  const input = base(); input.policy.max_event_age_days = Number.MIN_VALUE; input.policy.as_of = time;
  equal(prepareConversion(input).status, status, 'subnanosecond policy retained as rational');
}

for (const value of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), Infinity, NaN, true, {}, [], '', '01', '+1', '1e3', '1.', '.1', ' 1', '1 ', '1.1234567890', '123456789012345678901234567890']) {
  const input = base(); input.conversion.value = value;
  reject(() => prepareConversion(input), 'invalid known amount');
}
for (const value of [0, -0, -123.5, 1e-20, Number.MAX_SAFE_INTEGER, '0', '-0.000', '1.230000000', '-12345678901234567890123456789.123456789']) {
  const input = base(); input.conversion.value = value;
  equal(prepareConversion(input).conversion.value, value, 'finite known amount preserved exactly');
}
for (const patch of [
  { currency: null }, { currency: 'usd' }, { currency: 'USDD' }, { value_status: 'other' },
  { value_status: 'unknown', value: 0, currency: null },
  { value_status: 'unknown', value: null, currency: 'usd' },
  { value_status: 'mixed_currency', value: null, currency: 'USD' },
  { value_status: 'mixed_currency', value: 0, currency: null },
]) {
  const input = base(); Object.assign(input.conversion, patch);
  reject(() => prepareConversion(input), 'money status and currency semantics enforced');
}

for (const field of ['conversion_source_system', 'conversion_source_scope', 'click_source_system', 'click_source_scope']) {
  for (const operation of ['missing', 'whitespace']) {
    const input = base();
    if (operation === 'missing') delete input.policy.click_scope_bindings[0][field];
    else input.policy.click_scope_bindings[0][field] = ' bad ';
    reject(() => prepareConversion(input), 'binding requires all exact fields');
  }
}
const extraBinding = base(); extraBinding.policy.click_scope_bindings[0].wildcard = true;
reject(() => prepareConversion(extraBinding), 'extra binding fields rejected');
for (const value of [null, undefined, {}, 'all']) {
  const input = base(); input.policy.click_scope_bindings = value;
  reject(() => prepareConversion(input), 'binding array required');
}
for (const field of ['source_system', 'source_scope', 'click_key', 'conversion_source_system', 'conversion_source_scope', 'conversion_key']) {
  for (const value of ['', ' padded ', null, 1]) {
    const input = base(); input.click_observations[0][field] = value;
    reject(() => prepareConversion(input), 'all click identity keys validated');
  }
}
for (const value of ['', ' padded ', 'internal space', 'a\tb', 'null', 'UNDEFINED', '[object Object]', 'n/a', 'none', 'a\x00b', null, 123, {}]) {
  const input = base(); input.click_observations[0].value = value; input.click_observations[0].conversion_key = 'unrelated';
  reject(() => prepareConversion(input), 'invalid unused click value rejected');
}
for (const kind of ['FBCLID', 'unknown', '', null, {}]) {
  const input = base(); input.click_observations[0].kind = kind;
  reject(() => prepareConversion(input), 'canonical click kind vocabulary required');
}
for (const value of [null, undefined, {}, 'clicks']) {
  const input = base(); input.click_observations = value;
  reject(() => prepareConversion(input), 'click array required');
}
for (const [field, value] of [['occurred_at', '2026-01-01T01:00:00Z'], ['kind', 'gclid'], ['value', 'different'], ['conversion_source_system', 'other'], ['conversion_source_scope', 'other'], ['conversion_key', 'other']]) {
  const input = base(); input.click_observations.push({ ...input.click_observations[0], [field]: value });
  reject(() => prepareConversion(input), 'conflicting qualified click key rejected');
}
const duplicateExtras = base(); duplicateExtras.click_observations.push({ ...duplicateExtras.click_observations[0], email: 'different@example.invalid' });
equal(prepareConversion(duplicateExtras).click_diagnostics.duplicate_count, 1, 'duplicates compared only on declared fields');
for (const field of ['source_system', 'source_scope', 'click_key']) {
  const input = base(); input.click_observations.push({ ...input.click_observations[0], [field]: 'other' });
  equal(prepareConversion(input).click_diagnostics.unique_count, 2, 'click duplicate identity is fully qualified');
}
const tieFixture = byId('prepare-latest-qualified-tie-dedup');
function* permutations(values) {
  if (values.length === 0) { yield []; return; }
  for (let index = 0; index < values.length; index += 1) {
    for (const rest of permutations(values.filter((_, i) => i !== index))) yield [values[index], ...rest];
  }
}
let permutationCount = 0;
for (const rows of permutations(tieFixture.input.click_observations)) {
  const input = clone(tieFixture.input); input.click_observations = rows;
  equal(prepareConversion(input), tieFixture.expected, 'complete output invariant to click permutation');
  permutationCount += 1;
}
const unicodeTie = base(); unicodeTie.click_observations = ['😀', '\ue000'].map((key) => ({ ...unicodeTie.click_observations[0], click_key: key }));
equal(prepareConversion(unicodeTie).selected_clicks[0].click_key, '\ue000', 'UTF-8 byte order differs from UTF-16 or locale order');
const neverDecode = base(); neverDecode.click_observations[0].value = 'Ab+C%252B%20';
equal(prepareConversion(neverDecode).selected_clicks[0].value, 'Ab+C%252B%20', 'canonical opaque click never decoded a second time');

// Runtime data attacks: no JSON-stringify coercion, inherited records, getters,
// nonfinite unused fields, or cyclic payloads may bypass validation.
class Row { constructor() { Object.assign(this, idBase.input); } }
for (const bad of [null, undefined, [], new Date(), new Map(), new Set(), new Row(), 'row', 1]) {
  for (const fn of Object.values(operations)) reject(() => fn(bad), 'nonplain top-level input rejected');
}
for (const target of ['conversion', 'policy', 'click']) {
  const input = base();
  if (target === 'click') input.click_observations[0] = new Date();
  else input[target] = new Date();
  reject(() => prepareConversion(input), 'nonplain nested input rejected');
}
const cyclic = base(); cyclic.extra = cyclic;
reject(() => prepareConversion(cyclic), 'cyclic extra data rejected');
for (const extra of [Infinity, NaN, 1n, () => {}, Symbol('private')]) {
  const input = base(); input.extra = extra;
  reject(() => prepareConversion(input), 'invalid unused data rejected');
}
let getterRead = false;
const accessor = base(); Object.defineProperty(accessor.conversion, 'email', { enumerable: true, get() { getterRead = true; return 'private'; } });
reject(() => prepareConversion(accessor), 'accessor rejected without execution');
check(!getterRead, 'private accessor never evaluated');
const sparse = base(); sparse.click_observations = new Array(1);
reject(() => prepareConversion(sparse), 'sparse array rejected');
const sparseExtra = base(); sparseExtra.extra = new Array(1); sparseExtra.extra.foo = 1;
reject(() => prepareConversion(sparseExtra), 'sparse array cannot substitute an extra property for an index');
const arrayExtra = base(); arrayExtra.extra = [1]; arrayExtra.extra.foo = 1;
reject(() => prepareConversion(arrayExtra), 'dense array with extra property rejected');
const inputFrozen = freeze(base()); const beforeFrozen = clone(inputFrozen);
prepareConversion(inputFrozen); equal(inputFrozen, beforeFrozen, 'deep-frozen input remains unchanged');
const redacted = prepareConversion(base());
check(!JSON.stringify(redacted).includes('synthetic@example.invalid') && !JSON.stringify(redacted).includes('192.0.2.') && !JSON.stringify(redacted).includes('+15554441234'), 'extra personal data never emitted');
check(redacted.click_diagnostics.excluded.every((row) => !Object.hasOwn(row, 'value')), 'excluded diagnostics contain no raw click values');

// Full-output mutation guards target realistic regressions rather than only status.
detected(byId('stage-nonprimary-zero'), () => ({ status: 'not_achieved', conversion: null, business_conversion_id: null }));
detected(byId('stage-undated'), () => ({ status: 'eligible', conversion: {}, business_conversion_id: 'invented' }));
detected(byId('prepare-event-age-plus-microsecond'), (input) => ({ ...prepareConversion(input), status: 'ready', reasons: [] }));
detected(byId('prepare-browser-override-zero-projection'), (input) => { const r = prepareConversion(input); r.event_id = r.business_conversion_id; return r; });
detected(byId('prepare-explicit-subject-decimal'), (input) => { const r = prepareConversion(input); r.conversion.value = Number(r.conversion.value); return r; });
detected(byId('prepare-no-implicit-binding'), (input) => { const r = prepareConversion(input); r.click_diagnostics.excluded = []; return r; });
detected(tieFixture, (input) => { const r = prepareConversion(input); r.selected_clicks[0].click_key = 'older'; return r; });
for (const platform of ['meta', 'google', 'tiktok', 'linkedin', 'reddit']) {
  detected(byId(`prepare-allowlist-${platform}`), (input) => { const r = prepareConversion(input); r.selected_clicks = []; return r; });
}
console.log(`PASS ${fixtures.cases.length} full-output goldens, ${adversarialCases} rejected adversarial cases, ${permutationCount} complete-output permutations, ${mutations} detected mutations, ${assertions} assertions. No external calls or raw identity logging.`);

import assert from 'node:assert/strict';
import { extractRawTrackingEvidence, classifyChannel, TAXONOMY_VERSION } from './channel-taxonomy.mjs';

const names = ['dclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'rdt_cid', 'li_fat_id', 'twclid', 'epik', 'sccid', 'srsltid'];
const golden = (utm = {}, clicks = {}) => ({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, ...utm, click_ids: Object.fromEntries(names.map((name) => [name, clicks[name] ?? null])) });
const cases = [
  ['absent', {}, golden()],
  ['URL only', { landing_url: 'https://example.com/?utm_source=Google&utm_medium=CPC&utm_campaign=A&utm_content=B&utm_term=C&gclid=One' }, golden({ utm_source: 'Google', utm_medium: 'CPC', utm_campaign: 'A', utm_content: 'B', utm_term: 'C' }, { gclid: 'One' })],
  ['encoded keys', { landing_url: 'https://example.com/?%2567clid=ABC&utm%255Fcampaign=A' }, golden({ utm_campaign: 'A' }, { gclid: 'ABC' })],
  ['invalid host', { landing_url: 'javascript:alert(1)?gclid=ABC&utm_source=google' }, golden()],
  ['invalid hostname whitespace', { landing_url: 'https://bad host/?gclid=ABC' }, golden()],
  ['fragment excluded', { landing_url: 'https://example.com/#?gclid=ABC&utm_source=google' }, golden()],
  ['query before fragment', { landing_url: 'https://example.com/?gclid=One#?gclid=Two' }, golden({}, { gclid: 'One' })],
  ['first repeated parameter wins', { landing_url: 'https://example.com/?gclid=One&gclid=Two&utm_campaign=A&utm_campaign=B' }, golden({ utm_campaign: 'A' }, { gclid: 'One' })],
  ['invalid first repeated click remains absent', { landing_url: 'https://example.com/?gclid=NULL&gclid=Two' }, golden()],
  ['payload wins without trimming output', { utm_campaign: ' Payload%2520+Case ', click_ids: { gclid: ' Raw%252BCase+ ' }, landing_url: 'https://example.com/?utm_campaign=URL&gclid=URL' }, golden({ utm_campaign: ' Payload%2520+Case ' }, { gclid: ' Raw%252BCase+ ' })],
  ['placeholder payload falls back', { utm_campaign: ' ', click_ids: { gclid: '%254EULL', fbclid: '[object object]' }, landing_url: 'https://example.com/?utm_campaign=URL&gclid=Raw%252BCase&fbclid=Social' }, golden({ utm_campaign: 'URL' }, { gclid: 'Raw%252BCase', fbclid: 'Social' })],
  ['deep encoded values remain raw', { utm_campaign: '%252525252541', click_ids: { gclid: '%252525252541' } }, golden({ utm_campaign: '%252525252541' }, { gclid: '%252525252541' })],
  ['URL plus semantics', { landing_url: 'https://example.com/?gclid=A+B&fbclid=A%2BB&utm_campaign=A+B' }, golden({ utm_campaign: 'A B' }, { gclid: 'A B', fbclid: 'A%2BB' })],
  ['literal payload plus retained', { click_ids: { gclid: 'A+B' }, landing_url: 'https://example.com/?gclid=ignored' }, golden({}, { gclid: 'A+B' })],
  ['array first valid named entry', { click_ids: [{ name: ' GCLID ', value: 'null' }, { name: '%67clid', value: ' First%252B ' }, { name: 'gclid', value: 'Second' }], landing_url: 'https://example.com/?gclid=URL' }, golden({}, { gclid: ' First%252B ' })],
  ['invalid objects and arbitrary URL data excluded', { utm_source: { email: 'private@example.com' }, click_ids: { gclid: { email: 'private@example.com' } }, landing_url: 'https://example.com/?private=private@example.com&utm_medium=email' }, golden({ utm_medium: 'email' })],
  ['srsltid raw opaque evidence', { landing_url: 'https://example.com/?srsltid=Organic%252BCase' }, golden({}, { srsltid: 'Organic%252BCase' })],
  ['srsltid placeholder removed', { click_ids: { srsltid: '%254EULL' } }, golden()],
];
let assertions = 0;
const check = (method, ...args) => { assertions += 1; return assert[method](...args); };
for (const [name, input, expected] of cases) {
  const before = structuredClone(input);
  check('deepEqual', extractRawTrackingEvidence(input), expected, name);
  check('deepEqual', input, before, `${name}: whole input immutability`);
  check('deepEqual', extractRawTrackingEvidence(Object.fromEntries(Object.entries(input).reverse())), expected, `${name}: property ordering`);
}
check('equal', TAXONOMY_VERSION, '0.1.0', 'additive helper does not change taxonomy version');
check('equal', classifyChannel({ landing_url: 'https://example.com/?srsltid=Organic' }), 'Direct', 'srsltid does not establish paid classification');
const mutation = structuredClone(cases[1][2]); mutation.click_ids.gclid = 'wrong';
check('throws', () => assert.deepEqual(extractRawTrackingEvidence(cases[1][1]), mutation), assert.AssertionError, 'full golden detects changed raw evidence');
console.log(`PASS raw tracking helper: ${cases.length} complete goldens; ${assertions} assertions; raw encoding/URL precedence and immutable inputs verified`);

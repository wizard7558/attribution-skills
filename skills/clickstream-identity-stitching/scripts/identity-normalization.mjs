// Portable identity normalization authority. No runtime imports or I/O.
// The pixel collector receives a byte-exact generated copy; edit this source only.
export const IDENTITY_NORMALIZATION_VERSION = '0.1.0';

export const CLICK_ID_NAMES = ['dclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'rdt_cid', 'li_fat_id', 'twclid', 'epik', 'sccid', 'srsltid'];

export function canonicalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  if (!result || (result.match(/@/g) || []).length !== 1) return null;
  const [local, domain] = result.split('@');
  if (!local || !domain || /\s/.test(result) || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  return result;
}

export function canonicalizePhone(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input.startsWith('+')) return null;
  const withoutExtension = input.replace(/(?:,|;|\s+(?:ext\.?|x)\s*|x)\s*\d+\s*$/i, '');
  const digits = withoutExtension.slice(1).replace(/[\s().-]/g, '');
  if (!/^\d+$/.test(digits) || digits.length < 8 || digits.length > 15 || digits[0] === '0') return null;
  return `+${digits}`;
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function decode(value) {
  let out = text(value);
  for (let i = 0; i < 5; i += 1) {
    let next;
    try { next = decodeURIComponent(out); } catch { break; }
    if (next === out) break;
    out = next;
  }
  return out;
}
function validClick(value) {
  const out = decode(value).trim();
  return out && !/^(?:null|undefined|\[object object\])$/i.test(out) ? out : null;
}
function clickMap(touch) {
  const source = touch?.click_ids && typeof touch.click_ids === 'object' ? touch.click_ids : {};
  return Object.fromEntries(CLICK_ID_NAMES.map((name) => [name, validClick(source[name])]));
}
function normalizedCampaign(value) { return decode(value).replace(/\+/g, ' ').trim().toLowerCase() || null; }
export function touchSignature(touch) {
  const clicks = clickMap(touch);
  return JSON.stringify([touch.channel, normalizedCampaign(touch.utm_campaign), CLICK_ID_NAMES.map((name) => [name, clicks[name]]).filter(([, value]) => value !== null)]);
}

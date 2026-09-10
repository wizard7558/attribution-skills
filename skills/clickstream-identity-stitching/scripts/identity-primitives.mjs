import { createHash } from 'node:crypto';
import { canonicalizeEmail, canonicalizePhone, touchSignature } from './identity-normalization.mjs';
export { canonicalizeEmail, canonicalizePhone, CLICK_ID_NAMES } from './identity-normalization.mjs';

export const TAXONOMY_VERSION = '0.1.0';
export const CHANNELS = ['Paid Search', 'Paid Social', 'Paid Other', 'Organic Search', 'Organic Social', 'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other'];

export function hashIdentity(kind, value) {
  const canonical = kind === 'email' ? canonicalizeEmail(value) : kind === 'phone' ? canonicalizePhone(value) : null;
  return canonical ? createHash('sha256').update(canonical, 'utf8').digest('hex') : null;
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fullKey(touch) { return JSON.stringify([touch.source_system, touch.source_scope, touch.visitor_key, touch.touch_key]); }
function scopeKey(touch) { return JSON.stringify([touch.source_system, touch.source_scope, touch.visitor_key]); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function sameTouch(left, right) { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); }

function occurredAtNs(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value) return null;
  const [, ys, ms, ds, hs, mins, ss, fraction = '', zone] = match;
  const y = Number(ys), m = Number(ms), d = Number(ds), h = Number(hs), min = Number(mins), sec = Number(ss);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || min > 59 || sec > 59) return null;
  if (zone !== 'Z') {
    const [oh, om] = zone.slice(1).split(':').map(Number);
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
  }
  const epochMs = Date.parse(`${ys}-${ms}-${ds}T${hs}:${mins}:${ss}${zone}`);
  if (!Number.isSafeInteger(epochMs)) return null;
  return BigInt(epochMs) * 1000000n + BigInt(fraction.padEnd(9, '0'));
}
function validateTouch(touch, label) {
  if (!touch || typeof touch !== 'object') throw new TypeError(`${label} must be an object`);
  for (const key of ['source_system', 'source_scope', 'visitor_key', 'touch_key']) if (!text(touch[key])) throw new TypeError(`${label}.${key} is required`);
  if (!CHANNELS.includes(touch.channel)) throw new TypeError(`${label}.channel is invalid`);
  if (touch.taxonomy_version !== TAXONOMY_VERSION) throw new TypeError(`${label}.taxonomy_version must be ${TAXONOMY_VERSION}`);
  if (occurredAtNs(touch.occurred_at) === null) throw new TypeError(`${label}.occurred_at is invalid`);
  if (touch.utm_campaign !== undefined && touch.utm_campaign !== null && typeof touch.utm_campaign !== 'string') throw new TypeError(`${label}.utm_campaign is invalid`);
  if (touch.click_ids !== undefined && (!touch.click_ids || typeof touch.click_ids !== 'object' || Array.isArray(touch.click_ids))) throw new TypeError(`${label}.click_ids is invalid`);
}
function compare(a, b) {
  const left = occurredAtNs(a.occurred_at), right = occurredAtNs(b.occurred_at);
  return left < right ? -1 : left > right ? 1 : fullKey(a).localeCompare(fullKey(b));
}
function descriptor(touch, reason) { return { source_system: touch.source_system, source_scope: touch.source_scope, visitor_key: touch.visitor_key, touch_key: touch.touch_key, reason }; }

export function dedupeTouches(touches, { existing_touches = [] } = {}) {
  if (!Array.isArray(touches) || !Array.isArray(existing_touches)) throw new TypeError('touches and existing_touches must be arrays');
  existing_touches.forEach((touch, i) => validateTouch(touch, `existing_touches[${i}]`));
  touches.forEach((touch, i) => validateTouch(touch, `touches[${i}]`));
  const existing = [...existing_touches].sort(compare);
  const existingByKey = new Map();
  for (const touch of existing) {
    const key = fullKey(touch);
    const previous = existingByKey.get(key);
    if (previous && !sameTouch(previous, touch)) throw new TypeError(`conflicting duplicate touch_key ${touch.touch_key}`);
    if (!previous) existingByKey.set(key, touch);
  }
  const latestByScope = new Map();
  for (const touch of existing) {
    const scope = scopeKey(touch);
    const previous = latestByScope.get(scope);
    if (!previous || compare(previous, touch) <= 0) latestByScope.set(scope, touch);
  }
  const incomingByKey = new Map();
  for (const touch of touches) {
    const key = fullKey(touch);
    const previous = incomingByKey.get(key) || existingByKey.get(key);
    if (previous && !sameTouch(previous, touch)) throw new TypeError(`conflicting duplicate touch_key ${touch.touch_key}`);
    incomingByKey.set(key, touch);
    if (existingByKey.has(key)) continue;
    const scope = scopeKey(touch);
    const priorLatest = latestByScope.get(scope);
    if (priorLatest && occurredAtNs(touch.occurred_at) < occurredAtNs(priorLatest.occurred_at)) throw new RangeError('new touch is older than existing latest; full replay is required');
  }
  const acceptedByScope = new Map();
  const acceptedAnyByScope = new Set();
  for (const touch of existing) {
    acceptedByScope.set(scopeKey(touch), { ...touch });
    acceptedAnyByScope.add(scopeKey(touch));
  }
  const seen = new Map(existingByKey);
  const kept = [];
  const suppressed = [];
  for (const touch of [...touches].sort(compare)) {
    const key = fullKey(touch);
    const duplicate = seen.get(key);
    if (duplicate) {
      if (!sameTouch(duplicate, touch)) throw new TypeError(`conflicting duplicate touch_key ${touch.touch_key}`);
      suppressed.push(descriptor(touch, 'duplicate_idempotent'));
      continue;
    }
    seen.set(key, touch);
    const scope = scopeKey(touch);
    const prior = acceptedByScope.get(scope);
    if (touch.channel === 'Direct' && acceptedAnyByScope.has(scope)) {
      suppressed.push(descriptor(touch, 'direct_first_touch_only'));
      continue;
    }
    if (prior && prior.channel === touch.channel && touchSignature(prior) === touchSignature(touch) && occurredAtNs(touch.occurred_at) - occurredAtNs(prior.occurred_at) < 1800n * 1000000000n) {
      suppressed.push(descriptor(touch, 'consecutive_duplicate_within_30_minutes'));
      continue;
    }
    kept.push(structuredClone(touch));
    acceptedByScope.set(scope, touch);
    acceptedAnyByScope.add(scope);
  }
  return { touches: kept.sort(compare), suppressed };
}

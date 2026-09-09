import { canonicalizeEmail, canonicalizePhone, hashIdentity, CHANNELS, TAXONOMY_VERSION } from './identity-primitives.mjs';

const DAY_NS = 86_400_000_000_000n;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
function assertJson(value, path = '$', ancestors = new Set()) {
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value) || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') throw new TypeError(`${path} is not JSON-compatible`);
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw new TypeError(`${path} is cyclic`);
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError(`${path} must be a plain object`);
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} has non-JSON symbol keys`);
    ancestors.add(value);
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && name === 'length') continue;
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError(`${path}.${name} is not a JSON data property`);
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(name)) throw new TypeError(`${path}.${name} is not a JSON array index`);
      assertJson(descriptor.value, `${path}.${name}`, ancestors);
    }
    if (Array.isArray(value)) for (let i = 0; i < value.length; i += 1) if (!Object.prototype.hasOwnProperty.call(value, i)) throw new TypeError(`${path}[${i}] is sparse`);
    ancestors.delete(value);
  }
}
// Parse calendar-valid timestamps to exact nanoseconds. Explicit calendar math
// avoids Date.UTC's special remapping of years 00..99 into 1900..1999.
function timestampNs(value) {
  if (typeof value !== 'string') return null;
  const m = ISO.exec(value); if (!m) return null;
  const [, y, mo, d, h, mi, s, fraction = '', zone] = m;
  const year = Number(y);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > days[Number(mo) - 1]
    || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  if (zone !== 'Z') {
    const [oh, om] = zone.slice(1).split(':').map(Number);
    if (oh > 14 || om > 59 || oh === 14 && om !== 0) return null;
  }
  const wholeSecondMs = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  if (!Number.isSafeInteger(wholeSecondMs)) return null;
  return BigInt(wholeSecondMs) * 1_000_000n + BigInt(fraction.padEnd(9, '0'));
}
function validTime(value) { return timestampNs(value) !== null; }

// The caller's finite Number has an exact standard decimal spelling. Keep its
// day duration rational, including exponent notation, without rounding to ns.
function lookbackRational(days) {
  const [mantissa, exponentText = '0'] = days.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const coefficient = BigInt(whole + fraction);
  const exponent = Number(exponentText) - fraction.length;
  return exponent >= 0
    ? { numerator: coefficient * (10n ** BigInt(exponent)) * DAY_NS, denominator: 1n }
    : { numerator: coefficient * DAY_NS, denominator: 10n ** BigInt(-exponent) };
}
function req(value, path) { if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${path} must be a nonempty exact string`); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])); return value; }
function equal(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function key(...parts) { return JSON.stringify(parts); }
function qualified(system, scope, contact) { return { source_system: system, source_scope: scope, contact_key: contact }; }
function validateIdentity(value, path, required = false, format = 'raw') {
  if (format === 'canonical_sha256_v1') {
    if (value.email != null || value.phone != null) throw new TypeError(`${path} cannot mix raw identities with canonical hashes`);
    const email_hash = value.email_hash ?? null;
    const phone_hash = value.phone_hash ?? null;
    for (const [kind, hash] of [['email_hash', email_hash], ['phone_hash', phone_hash]]) {
      if (hash !== null && (typeof hash !== 'string' || hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash))) throw new TypeError(`${path}.${kind} must be lowercase SHA-256 hex`);
    }
    if (required && !email_hash && !phone_hash) throw new TypeError(`${path} requires valid email_hash or phone_hash`);
    return { email: null, phone: null, email_hash, phone_hash };
  }
  if (value.email_hash != null || value.phone_hash != null) throw new TypeError(`${path} cannot mix canonical hashes with raw identities`);
  const email = value.email === undefined ? null : canonicalizeEmail(value.email);
  const phone = value.phone === undefined ? null : canonicalizePhone(value.phone);
  if (value.email !== undefined && value.email !== null && !email) throw new TypeError(`${path}.email is invalid`);
  if (value.phone !== undefined && value.phone !== null && !phone) throw new TypeError(`${path}.phone is invalid`);
  if (required && !email && !phone) throw new TypeError(`${path} requires valid email or phone`);
  return { email, phone, email_hash: email ? hashIdentity('email', email) : null, phone_hash: phone ? hashIdentity('phone', phone) : null };
}
function validateContact(contact, i, format) {
  for (const f of ['source_system', 'source_scope', 'contact_key']) req(contact[f], `contacts[${i}].${f}`);
  return { ...contact, ...validateIdentity(contact, `contacts[${i}]`, false, format) };
}
function validateIdentify(observation, i, format) {
  for (const f of ['source_system', 'source_scope', 'visitor_key', 'observation_key']) req(observation[f], `identifies[${i}].${f}`);
  if (!validTime(observation.occurred_at)) throw new TypeError(`identifies[${i}].occurred_at is invalid`);
  return { ...observation, ...validateIdentity(observation, `identifies[${i}]`, true, format) };
}
function validateTouch(touch, i) {
  for (const f of ['source_system', 'source_scope', 'visitor_key', 'touch_key']) req(touch[f], `touches[${i}].${f}`);
  if (!validTime(touch.occurred_at)) throw new TypeError(`touches[${i}].occurred_at is invalid`);
  if (!CHANNELS.includes(touch.channel) || touch.taxonomy_version !== TAXONOMY_VERSION) throw new TypeError(`touches[${i}] taxonomy or channel is invalid`);
}
function dedupeRows(rows, rowKey, label) {
  const map = new Map();
  for (const row of rows) { const k = rowKey(row); const prior = map.get(k); if (prior && !equal(prior, row)) throw new TypeError(`conflicting duplicate ${label}`); if (!prior) map.set(k, row); }
  return [...map.values()];
}
function sortJson(rows) { return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }

export function buildIdentityGraph(input) {
  assertJson(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('graph input must be a plain object');
  const { contacts = [], identifies = [], touches = [], identity_scope_bindings = [], as_of, lookback_days, identity_input_format = 'raw' } = input;
  if (!['raw', 'canonical_sha256_v1'].includes(identity_input_format)) throw new TypeError('identity_input_format is invalid');
  if (!validTime(as_of)) throw new TypeError('as_of is invalid');
  if (!Number.isFinite(lookback_days) || lookback_days <= 0) throw new TypeError('lookback_days must be positive finite');
  if (!Array.isArray(contacts) || !Array.isArray(identifies) || !Array.isArray(touches) || !Array.isArray(identity_scope_bindings)) throw new TypeError('graph inputs must be arrays');
  const contactRows = dedupeRows(contacts.map((row, i) => validateContact(row, i, identity_input_format)), (row) => key(row.source_system, row.source_scope, row.contact_key), 'contact');
  const identifyRows = dedupeRows(identifies.map((row, i) => validateIdentify(row, i, identity_input_format)), (row) => key(row.source_system, row.source_scope, row.visitor_key, row.observation_key), 'observation');
  const touchRows = dedupeRows(touches.map((row, i) => { validateTouch(row, i); return row; }), (row) => key(row.source_system, row.source_scope, row.visitor_key, row.touch_key), 'touch');
  const bindings = identity_scope_bindings.map((binding, i) => {
    for (const f of ['source_system', 'source_scope', 'contact_source_system', 'contact_source_scope']) req(binding[f], `identity_scope_bindings[${i}].${f}`);
    return binding;
  });
  const asOfNs = timestampNs(as_of);
  const lookback = lookbackRational(lookback_days);
  const authorized = (observation, contact) => bindings.some((binding) => binding.source_system === observation.source_system && binding.source_scope === observation.source_scope && binding.contact_source_system === contact.source_system && binding.contact_source_scope === contact.source_scope);
  const contactsByIdentity = contactRows.flatMap((contact) => [{ kind: 'email_hash', value: contact.email_hash }, { kind: 'phone_hash', value: contact.phone_hash }].filter((identity) => identity.value).map((identity) => ({ ...identity, contact })));
  const edges = [];
  const observations = [];
  const future = { identifies: 0, touches: 0 };
  for (const observation of identifyRows) {
    const occurred = timestampNs(observation.occurred_at);
    if (occurred > asOfNs) { future.identifies += 1; continue; }
    const candidates = new Map();
    for (const identity of [{ kind: 'email_hash', value: observation.email_hash }, { kind: 'phone_hash', value: observation.phone_hash }].filter((item) => item.value)) {
      for (const match of contactsByIdentity.filter((item) => item.kind === identity.kind && item.value === identity.value && authorized(observation, item.contact))) candidates.set(key(match.contact.source_system, match.contact.source_scope, match.contact.contact_key), match.contact);
    }
    const candidateList = sortJson([...candidates.values()].map((contact) => qualified(contact.source_system, contact.source_scope, contact.contact_key)));
    const status = candidateList.length === 1 ? 'matched' : candidateList.length === 0 ? 'unresolved' : 'ambiguous';
    observations.push({ status, source_system: observation.source_system, source_scope: observation.source_scope, visitor_key: observation.visitor_key, observation_key: observation.observation_key, occurred_at: observation.occurred_at, candidates: candidateList });
    if (status === 'matched') {
      const contact = candidateList[0];
      edges.push({ edge_key: key(observation.source_system, observation.source_scope, observation.visitor_key, observation.observation_key), occurred_at: observation.occurred_at, source_system: observation.source_system, source_scope: observation.source_scope, visitor_key: observation.visitor_key, contact: contact, evidence: { email_hash: observation.email_hash, phone_hash: observation.phone_hash } });
    }
  }
  const sortedEdges = sortJson(edges);
  const visitorGroups = new Map();
  for (const edge of sortedEdges) { const visitor = key(edge.source_system, edge.source_scope, edge.visitor_key); const group = visitorGroups.get(visitor) || new Map(); group.set(key(edge.contact.source_system, edge.contact.source_scope, edge.contact.contact_key), edge.contact); visitorGroups.set(visitor, group); }
  const touch_links = [];
  for (const touch of touchRows) {
    const touchTime = timestampNs(touch.occurred_at);
    if (touchTime > asOfNs) { future.touches += 1; continue; }
    const candidates = sortedEdges.filter((edge) => edge.source_system === touch.source_system && edge.source_scope === touch.source_scope && edge.visitor_key === touch.visitor_key && (timestampNs(edge.occurred_at) - touchTime) * lookback.denominator <= lookback.numerator && touchTime <= asOfNs && timestampNs(edge.occurred_at) <= asOfNs);
    // Global matched contacts are ambiguity context, while evidence keys remain touch-eligible only.
    const visitorContacts = visitorGroups.get(key(touch.source_system, touch.source_scope, touch.visitor_key));
    const contactsOut = candidates.length ? sortJson([...visitorContacts.values()]) : [];
    touch_links.push({ source_system: touch.source_system, source_scope: touch.source_scope, visitor_key: touch.visitor_key, touch_key: touch.touch_key, occurred_at: touch.occurred_at, status: contactsOut.length === 1 ? 'matched' : contactsOut.length > 1 ? 'ambiguous' : 'unresolved', ...(contactsOut.length > 1 ? { reason: 'shared_device' } : {}), contacts: contactsOut, edge_evidence_keys: sortJson(candidates.map((edge) => edge.edge_key)) });
  }
  const shared_devices = sortJson([...visitorGroups.entries()].filter(([, contacts]) => contacts.size > 1).map(([visitor, contacts]) => { const [source_system, source_scope, visitor_key] = JSON.parse(visitor); return { source_system, source_scope, visitor_key, contacts: sortJson([...contacts.values()]) }; }));
  return { edges: sortedEdges, observations: sortJson(observations), touch_links: sortJson(touch_links), diagnostics: { as_of, lookback_days, future_excluded: future, shared_devices, retrospective_edge_use: true, no_ip_inference: true } };
}

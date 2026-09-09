import { createHash } from 'node:crypto';
import { canonicalizeEmail, canonicalizePhone, hashIdentity } from './identity-primitives.mjs';

const METHODS = ['visitor_field', 'page_rule', 'recent_visitor', 'new_visitor'];
const HASH = /^[a-f0-9]{64}$/;
const SIMPLE_DIAGNOSTICS = ['visitor_field_unknown', 'page_rule_not_found', 'page_rule_out_of_window', 'page_rule_unknown_visitor', 'recent_visitor_no_match', 'identity_unavailable'];
const jsonKey = (...parts) => JSON.stringify(parts);
const digest = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const qualified = (row) => ({ source_system: row.source_system, source_scope: row.source_scope, visitor_key: row.visitor_key });
const visitorKey = (row) => jsonKey(row.source_system, row.source_scope, row.visitor_key);
const sameScope = (a, b) => a.source_system === b.source_system && a.source_scope === b.source_scope;
const sorted = (rows) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
function assertJson(value, path = '$', ancestors = new Set()) {
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value) || ['bigint', 'function', 'symbol'].includes(typeof value)) throw new TypeError(`${path} is not JSON-compatible`);
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new TypeError(`${path} is cyclic`);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} has non-JSON symbol keys`);
  ancestors.add(value);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && name === 'length') continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path}.${name} is not a JSON data property`);
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(name)) throw new TypeError(`${path}.${name} is not a JSON array index`);
    assertJson(descriptor.value, `${path}.${name}`, ancestors);
  }
  if (Array.isArray(value)) for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) throw new TypeError(`${path}[${i}] is sparse`);
  ancestors.delete(value);
}
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); }
function exactFields(value, fields, label) {
  object(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) throw new TypeError(`${label} has missing or unknown fields`);
}
function exactString(value, label) { if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${label} must be a nonempty exact string`); }
function scope(row, label, withVisitor = true) {
  object(row, label);
  for (const field of ['source_system', 'source_scope', ...(withVisitor ? ['visitor_key'] : [])]) exactString(row[field], `${label}.${field}`);
}
function timestamp(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an ISO timestamp`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new TypeError(`${label} must be an ISO timestamp`);
  const [, y, mo, d, h, mi, s, zone] = match;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate() || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) throw new TypeError(`${label} is invalid`);
  if (zone !== 'Z') { const [oh, om] = zone.slice(1).split(':').map(Number); if (oh > 14 || om > 59 || oh === 14 && om !== 0) throw new TypeError(`${label} is invalid`); }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} is invalid`);
  return ms;
}
function unique(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (map.has(k) && JSON.stringify(stable(map.get(k))) !== JSON.stringify(stable(row))) throw new TypeError(`conflicting duplicate ${label}`);
    if (!map.has(k)) map.set(k, row);
  }
  return [...map.values()];
}
function validateReceipt(receipt) {
  exactFields(receipt, ['receipt_key', 'payload_sha256', 'resolution'], 'receipt');
  if (typeof receipt.payload_sha256 !== 'string' || !HASH.test(receipt.payload_sha256)) throw new TypeError('receipt.payload_sha256 is invalid');
  let parts;
  try { parts = JSON.parse(receipt.receipt_key); } catch { throw new TypeError('receipt.receipt_key is invalid'); }
  if (!Array.isArray(parts) || parts.length !== 4 || JSON.stringify(parts) !== receipt.receipt_key) throw new TypeError('receipt.receipt_key is invalid');
  parts.forEach((part) => exactString(part, 'receipt.receipt_key component'));
  const resolution = receipt.resolution;
  exactFields(resolution, ['status', 'visitor', 'method', 'confidence', 'diagnostics'], 'receipt.resolution');
  exactFields(resolution.visitor, ['source_system', 'source_scope', 'visitor_key'], 'receipt visitor');
  scope(resolution.visitor, 'receipt visitor');
  if (resolution.visitor.source_system !== parts[0] || resolution.visitor.source_scope !== parts[1]) throw new TypeError('receipt visitor scope conflicts with receipt key');
  if (!METHODS.includes(resolution.method) || resolution.status !== (resolution.method === 'new_visitor' ? 'created' : 'matched')) throw new TypeError('receipt resolution method/status is invalid');
  if (!Number.isFinite(resolution.confidence) || resolution.confidence < 0 || resolution.confidence > 1) throw new TypeError('receipt confidence is invalid');
  if (resolution.method === 'new_visitor' && resolution.visitor.visitor_key !== `webhook_${digest(parts)}`) throw new TypeError('receipt new visitor key is invalid');
  if (!Array.isArray(resolution.diagnostics)) throw new TypeError('receipt diagnostics must be an array');
  for (const item of resolution.diagnostics) {
    object(item, 'receipt diagnostic');
    if (item.code === 'recent_visitor_ambiguous') {
      exactFields(item, ['code', 'candidates'], 'receipt diagnostic');
      if (!Array.isArray(item.candidates) || item.candidates.length < 2) throw new TypeError('receipt ambiguity candidates are invalid');
      for (const candidate of item.candidates) {
        exactFields(candidate, ['source_system', 'source_scope', 'visitor_key'], 'receipt candidate');
        scope(candidate, 'receipt candidate');
        if (!sameScope(candidate, resolution.visitor)) throw new TypeError('receipt candidate scope is invalid');
      }
      if (new Set(item.candidates.map(visitorKey)).size !== item.candidates.length || JSON.stringify(item.candidates) !== JSON.stringify(sorted([...item.candidates]))) throw new TypeError('receipt candidates must be unique and sorted');
      if (resolution.method !== 'new_visitor') throw new TypeError('receipt ambiguity must fall through to a new visitor');
    } else {
      exactFields(item, ['code'], 'receipt diagnostic');
      if (!SIMPLE_DIAGNOSTICS.includes(item.code)) throw new TypeError('receipt diagnostic code is invalid');
    }
  }
  return {
    receipt_key: receipt.receipt_key, payload_sha256: receipt.payload_sha256,
    resolution: {
      status: resolution.status, visitor: qualified(resolution.visitor), method: resolution.method, confidence: resolution.confidence,
      diagnostics: resolution.diagnostics.map((item) => item.code === 'recent_visitor_ambiguous' ? { code: item.code, candidates: sorted(item.candidates.map(qualified)) } : { code: item.code }),
    },
  };
}

export function resolveWebhookStitch(input) {
  assertJson(input);
  object(input, 'input');
  const { submission, visitors = [], page_rule_events = [], recent_identity_edges = [], receipts = [], policy } = input;
  scope(submission, 'submission', false);
  for (const field of ['provider', 'submission_key']) exactString(submission[field], `submission.${field}`);
  for (const field of ['visitor_key', 'page_rule_event_key']) if (submission[field] !== undefined && submission[field] !== null) exactString(submission[field], `submission.${field}`);
  const submittedAt = timestamp(submission.occurred_at, 'submission.occurred_at');
  const identities = {};
  for (const [kind, canonicalize] of [['email', canonicalizeEmail], ['phone', canonicalizePhone]]) {
    const value = submission[kind];
    const canonical = value == null ? null : canonicalize(value);
    if (value != null && !canonical) throw new TypeError(`submission.${kind} is invalid`);
    identities[`${kind}_hash`] = canonical ? hashIdentity(kind, canonical) : null;
  }
  exactFields(policy, ['page_rule_window_minutes', 'recent_visitor_window_minutes', 'confidence'], 'policy');
  for (const field of ['page_rule_window_minutes', 'recent_visitor_window_minutes']) if (!Number.isFinite(policy[field]) || policy[field] < 0) throw new TypeError(`policy.${field} must be finite and nonnegative`);
  exactFields(policy.confidence, METHODS, 'policy.confidence');
  for (const method of METHODS) if (!Number.isFinite(policy.confidence[method]) || policy.confidence[method] < 0 || policy.confidence[method] > 1) throw new TypeError(`policy.confidence.${method} must be between 0 and 1`);
  for (const [label, rows] of Object.entries({ visitors, page_rule_events, recent_identity_edges, receipts })) if (!Array.isArray(rows)) throw new TypeError(`${label} must be an array`);
  const visitorRows = unique(visitors.map((row) => { scope(row, 'visitor'); timestamp(row.last_seen_at, 'visitor.last_seen_at'); return row; }), visitorKey, 'visitor');
  const visitorMap = new Map(visitorRows.map((row) => [visitorKey(row), row]));
  const events = unique(page_rule_events.map((row) => {
    scope(row, 'page_rule_event'); exactString(row.page_rule_event_key, 'page_rule_event.page_rule_event_key'); timestamp(row.event_at, 'page_rule_event.event_at'); return row;
  }), (row) => jsonKey(row.source_system, row.source_scope, row.page_rule_event_key), 'page rule event');
  const edges = unique(recent_identity_edges.map((row) => {
    scope(row, 'recent_identity_edge'); exactString(row.evidence_key, 'recent_identity_edge.evidence_key'); timestamp(row.evidence_at, 'recent_identity_edge.evidence_at');
    let count = 0;
    for (const kind of ['email_hash', 'phone_hash']) if (row[kind] != null) { if (typeof row[kind] !== 'string' || !HASH.test(row[kind])) throw new TypeError(`recent_identity_edge.${kind} is invalid`); count += 1; }
    if (!count) throw new TypeError('recent_identity_edge requires explicit identity hash evidence');
    return row;
  }), (row) => jsonKey(row.source_system, row.source_scope, row.visitor_key, row.evidence_key), 'identity evidence');
  const receiptRows = unique(receipts.map(validateReceipt), (row) => row.receipt_key, 'receipt');
  const receiptParts = [submission.source_system, submission.source_scope, submission.provider, submission.submission_key];
  const receipt_key = JSON.stringify(receiptParts);
  // Only normalized semantic submission + policy affect retry identity. Candidate
  // snapshots may evolve after the original receipt was durably committed.
  const payload_sha256 = digest(stable({
    source_system: submission.source_system, source_scope: submission.source_scope, provider: submission.provider, submission_key: submission.submission_key,
    occurred_at: new Date(submittedAt).toISOString(), visitor_key: submission.visitor_key ?? null, page_rule_event_key: submission.page_rule_event_key ?? null,
    ...identities, policy,
  }));
  const previous = receiptRows.find((row) => row.receipt_key === receipt_key);
  if (previous) {
    if (previous.payload_sha256 !== payload_sha256) throw new TypeError('conflicting receipt payload');
    if (previous.resolution.confidence !== policy.confidence[previous.resolution.method]) throw new TypeError('receipt confidence conflicts with policy');
    if (previous.resolution.method === 'visitor_field' && previous.resolution.visitor.visitor_key !== submission.visitor_key) throw new TypeError('receipt visitor field conflicts with submission');
    if (previous.resolution.method === 'page_rule' && submission.page_rule_event_key == null) throw new TypeError('receipt page rule conflicts with submission');
    if (previous.resolution.method === 'recent_visitor' && !identities.email_hash && !identities.phone_hash) throw new TypeError('receipt identity evidence conflicts with submission');
    const receipt = structuredClone(previous);
    return { receipt_key, payload_sha256, replayed: true, resolution: structuredClone(receipt.resolution), receipt };
  }
  const diagnostics = [];
  const finish = (visitor, method) => {
    const resolution = { status: method === 'new_visitor' ? 'created' : 'matched', visitor: qualified(visitor), method, confidence: policy.confidence[method], diagnostics };
    return { receipt_key, payload_sha256, replayed: false, resolution, receipt: { receipt_key, payload_sha256, resolution: structuredClone(resolution) } };
  };
  if (submission.visitor_key != null) {
    const visitor = visitorMap.get(visitorKey(submission));
    if (visitor) return finish(visitor, 'visitor_field');
    diagnostics.push({ code: 'visitor_field_unknown' });
  }
  if (submission.page_rule_event_key != null) {
    const event = events.find((row) => sameScope(row, submission) && row.page_rule_event_key === submission.page_rule_event_key);
    if (!event) diagnostics.push({ code: 'page_rule_not_found' });
    else if (Date.parse(event.event_at) < submittedAt - policy.page_rule_window_minutes * 60_000 || Date.parse(event.event_at) > submittedAt) diagnostics.push({ code: 'page_rule_out_of_window' });
    else {
      const visitor = visitorMap.get(visitorKey(event));
      if (visitor) return finish(visitor, 'page_rule');
      diagnostics.push({ code: 'page_rule_unknown_visitor' });
    }
  }
  if (identities.email_hash || identities.phone_hash) {
    const start = submittedAt - policy.recent_visitor_window_minutes * 60_000;
    const candidates = new Map();
    for (const edge of edges) {
      if (!sameScope(edge, submission) || !['email_hash', 'phone_hash'].some((kind) => identities[kind] && identities[kind] === edge[kind])) continue;
      const visitor = visitorMap.get(visitorKey(edge));
      if (!visitor) continue;
      const evidenceAt = Date.parse(edge.evidence_at), lastSeen = Date.parse(visitor.last_seen_at);
      if (evidenceAt >= start && evidenceAt <= submittedAt && lastSeen >= start && lastSeen <= submittedAt) candidates.set(visitorKey(visitor), qualified(visitor));
    }
    if (candidates.size === 1) return finish([...candidates.values()][0], 'recent_visitor');
    if (candidates.size > 1) diagnostics.push({ code: 'recent_visitor_ambiguous', candidates: sorted([...candidates.values()]) });
    else diagnostics.push({ code: 'recent_visitor_no_match' });
  } else diagnostics.push({ code: 'identity_unavailable' });
  return finish({ ...qualified(submission), visitor_key: `webhook_${digest(receiptParts)}` }, 'new_visitor');
}

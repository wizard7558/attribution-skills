/** Dependency-free CRM attribution profiler; outputs never contain raw row values. */
export const SHAPES = ['meta_id', 'gclid', 'fbclid', 'sf_record_id', 'short_label', 'free_text'];
export const VERDICTS = ['propose', 'corroborate', 'reject', 'capture_missing', 'pre_window'];
export const CONFIDENCE = ['high', 'medium', 'low', 'rejected'];
export const CANDIDATE_FIELD_RE = /(utm_|gclid|fbclid|ttclid|msclkid|click|referr|source|medium|campaign|content|term|channel|keyword|adgroup|ad_group|creative|matchtype|lead_source|hs_analytics_)/i;
const PAID_CAPTURE_RE = /(utm_|gclid|fbclid|ttclid|msclkid|hs_.*click_id)/i;
const SF_NON_AD_PREFIXES = new Set(['701', '001', '003', '00Q', '006', '00v', '005']);
const EXCLUDED_LABELS = new Set(['apollo', 'apollo.io', 'outreach', 'outreach.io', 'salesloft', 'zoominfo', 'cognism', 'lusha', 'seamless', 'seamless.ai', 'clay', 'instantly', 'lemlist', 'smartlead', 'gong', '6sense', '6 sense']);
const KINDS = ['id', 'name', 'presence', 'enum'];
export function isCandidateField(name) { return CANDIDATE_FIELD_RE.test(String(name ?? '')); }
export function logicalFieldName(name) { return String(name ?? '').replace(/^property_/i, ''); }
function decodeFive(raw) {
  let value = String(raw ?? '');
  for (let i = 0; i < 5; i += 1) {
    if (!value.includes('%')) break;
    let next;
    try { next = decodeURIComponent(value); } catch { break; }
    if (next === value) break;
    value = next;
  }
  return value;
}
export function normalizeJoinValue(raw, keyKind = 'name') {
  const value = decodeFive(raw).trim();
  return keyKind === 'id' ? value : value.replaceAll('+', ' ').trim().toLowerCase();
}
export function classifyShape(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { bucket: 'free_text' };
  if (/^(Cj0|CjwKCA|EAIa)/.test(value) && value.length > 40) return { bucket: 'gclid' };
  if (/^(IwZXh|IwAR|fb\.1|PAZXh)/.test(value)) return { bucket: 'fbclid' };
  if (/^\d{15,20}$/.test(value)) return { bucket: 'meta_id' };
  if (/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value) && /[A-Za-z]/.test(value)) return { bucket: 'sf_record_id', sfPrefix: value.slice(0, 3) };
  if (value.length <= 40 && !/\s/.test(value)) return { bucket: 'short_label' };
  return { bucket: 'free_text' };
}
export function isSfNonAdRecordId(shape) { return shape?.bucket === 'sf_record_id' && SF_NON_AD_PREFIXES.has(shape.sfPrefix); }
export function shapeDistribution(values) {
  const result = Object.fromEntries(SHAPES.map((shape) => [shape, 0]));
  for (const value of values) result[classifyShape(value).bucket] += 1;
  return result;
}
export function isExcludedLabelValue(value) { return EXCLUDED_LABELS.has(normalizeJoinValue(value)); }
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
}
function resolveConfig(config) {
  const t = config?.thresholds;
  if (!t || typeof t !== 'object') throw new TypeError('config.thresholds is required');
  const required = ['populationPctFloor', 'populationRowFloor', 'proposeWeighted', 'proposeDistinct', 'rejectExactFloor', 'preWindowDistinct', 'highWeighted', 'highDistinct', 'outboundDominanceFloor'];
  for (const key of required) if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) throw new TypeError(`config.thresholds.${key} is required and numeric`);
  if (t.populationPctFloor < 0 || t.populationPctFloor > 100) throw new TypeError('thresholds.populationPctFloor must be between 0 and 100');
  for (const key of required.slice(2)) if (t[key] < 0 || t[key] > 1) throw new TypeError(`thresholds.${key} must be a rate between 0 and 1`);
  if (t.populationRowFloor < 0 || !Number.isInteger(t.populationRowFloor)) throw new TypeError('thresholds.populationRowFloor must be a non-negative integer');
  const labels = config.excludedLabelValues ?? [...EXCLUDED_LABELS];
  const prefixes = config.sfNonAdPrefixes ?? [...SF_NON_AD_PREFIXES];
  if (!Array.isArray(labels) || labels.some((v) => typeof v !== 'string' || !v.trim())) throw new TypeError('config.excludedLabelValues must be nonempty strings in an array');
  if (!Array.isArray(prefixes) || prefixes.some((v) => typeof v !== 'string' || !/^[A-Za-z0-9]{3}$/.test(v))) throw new TypeError('config.sfNonAdPrefixes must be three-character alphanumeric strings in an array');
  return { thresholds: { ...t }, excludedLabels: new Set(labels.map((v) => normalizeJoinValue(v))), sfPrefixes: new Set(prefixes) };
}
function validTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim() || /^[+-]/.test(timezone)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); return true; } catch { return false; }
}
function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return NaN;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return NaN;
  if (m[7] !== 'Z' && (Number(m[7].slice(1, 3)) > 23 || Number(m[7].slice(4)) > 59)) return NaN;
  return Date.parse(value);
}
function dateWindow(window, name = 'window') {
  if (!window || !validTimezone(window.timezone)) throw new TypeError(`${name}.timezone must be an explicit valid IANA timezone`);
  const startMs = timestamp(window.startInclusive); const endMs = timestamp(window.endExclusive);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) throw new TypeError(`${name} requires valid calendar ISO timestamps with offset/Z and start < end`);
  return { ...window, startMs, endMs };
}
function inWindow(value, window) { return value >= window.startMs && value < window.endMs; }
function nonblank(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function usable(value, kind) { return typeof value === 'string' ? normalizeJoinValue(value, kind).length > 0 : kind === 'id' && Number.isSafeInteger(value); }
function inferKind(field) {
  const name = logicalFieldName(field).toLowerCase();
  if (/^(gclid|fbclid|ttclid|msclkid|.*click.*id|.*_id)$/.test(name)) return 'id';
  if (/^(source|medium|channel|lead_source|.*type)$/.test(name)) return 'enum';
  return 'name';
}
function diagnostic(code, details = {}) { return { code, ...details }; }
function bindingFor(bindings, candidate) {
  return bindings.filter((b) => b.platform === candidate.platform && b.entity_type === candidate.entity_type && b.crm_source_system === candidate.crm_source_system && b.crm_source_scope === candidate.crm_source_scope);
}
function exclusions(value, config) {
  const shape = classifyShape(normalizeJoinValue(value, 'id'));
  return { sf: shape.bucket === 'sf_record_id' && config.sfPrefixes.has(shape.sfPrefix), outbound: config.excludedLabels.has(normalizeJoinValue(value)) };
}
function measure(rows, ads, candidate, bindings, window, config) {
  const allowed = bindingFor(bindings, candidate);
  const keys = new Set(ads.filter((ad) => inWindow(ad.timeMs, window) && ad.key_kind === candidate.kind && usable(ad.value, ad.key_kind) && allowed.some((b) => ad.source_system === b.ad_source_system && ad.source_scope === b.ad_source_scope && ad.platform === b.platform && ad.entity_type === b.entity_type)).map((ad) => normalizeJoinValue(ad.value, candidate.kind)));
  const windowRows = rows.filter((row) => inWindow(row.timeMs, window));
  const values = windowRows.filter((row) => usable(row.value, candidate.kind));
  const invalidValueCount = windowRows.filter((row) => nonblank(row.value) && !usable(row.value, candidate.kind)).length;
  const observations = values.map(({ value }) => ({ key: normalizeJoinValue(value, candidate.kind), ...exclusions(value, config) }));
  const matched = observations.filter((v) => !v.sf && !v.outbound && keys.has(v.key));
  const distinct = new Set(observations.map((v) => v.key)); const matchedDistinct = new Set(matched.map((v) => v.key));
  return { invalidValueCount, weightedRate: values.length ? matched.length / values.length : 0, distinctRate: distinct.size ? matchedDistinct.size / distinct.size : 0, populatedCount: values.length, populatedPct: windowRows.length ? values.length / windowRows.length * 100 : 0, distinctCount: distinct.size, matchedCount: matched.length, matchedDistinctCount: matchedDistinct.size, excludedCount: observations.filter((v) => v.sf || v.outbound).length, sfInternalFkCount: observations.filter((v) => v.sf).length, outboundLabelExcludedCount: observations.filter((v) => v.outbound).length, keyKind: candidate.kind };
}
function verdict(r, t) {
  if (r.keyKind === 'presence' || r.keyKind === 'enum') return { verdict: 'corroborate', confidence: 'medium' };
  if ((r.weightedRate > 0 || r.distinctRate > 0) && (r.weightedRate >= t.proposeWeighted || r.distinctRate >= t.proposeDistinct)) return { verdict: 'propose', confidence: r.weightedRate >= t.highWeighted || r.distinctRate >= t.highDistinct ? 'high' : 'medium' };
  if (r.recentDistinctRate > 0 && r.recentDistinctRate >= t.preWindowDistinct) return { verdict: 'pre_window', confidence: 'low' };
  return { verdict: 'reject', confidence: 'rejected', fuzzyCeiling: r.distinctRate < t.rejectExactFloor };
}
function validateStructure(input) {
  if (!input || !input.source || !Array.isArray(input.source.rows) || !Array.isArray(input.adHistory) || !Array.isArray(input.ad_scope_bindings)) throw new TypeError('source.rows, adHistory, and ad_scope_bindings are required arrays');
  for (const key of ['source_system', 'source_scope', 'timestampField']) requireText(input.source[key], `source.${key}`);
  for (const row of input.source.rows) if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('source.rows entries must be objects');
  for (const ad of input.adHistory) {
    for (const key of ['source_system', 'source_scope', 'platform', 'entity_type', 'key_kind']) requireText(ad?.[key], `adHistory.${key}`);
    if (!['id', 'name'].includes(ad.key_kind)) throw new TypeError('adHistory.key_kind must be id or name');
  }
  for (const b of input.ad_scope_bindings) for (const key of ['crm_source_system', 'crm_source_scope', 'ad_source_system', 'ad_source_scope', 'platform', 'entity_type']) requireText(b?.[key], `ad_scope_bindings.${key}`);
  if (input.candidates !== undefined && !Array.isArray(input.candidates)) throw new TypeError('candidates must be an array');
  for (const c of input.candidates ?? []) {
    for (const key of ['rawField', 'kind', 'platform', 'entity_type']) requireText(c?.[key], `candidates.${key}`);
    if (!KINDS.includes(c.kind)) throw new TypeError('unsupported candidate kind');
  }
}
export function profileCrmAttribution(input) {
  validateStructure(input);
  const config = resolveConfig(input.config); const window = dateWindow(input.window); const recent = input.recentWindow === undefined ? null : dateWindow(input.recentWindow, 'recentWindow');
  if (recent && (recent.startMs < window.startMs || recent.endMs > window.endMs || recent.timezone !== window.timezone)) throw new TypeError('recentWindow must be contained in window and use the same timezone');
  const rows = input.source.rows; const timestampField = input.source.timestampField;
  const timedRows = rows.map((row) => ({ row, timeMs: timestamp(row[timestampField]) }));
  const validRows = timedRows.filter(({ timeMs }) => Number.isFinite(timeMs));
  const windowRows = validRows.filter(({ timeMs }) => inWindow(timeMs, window));
  const timedAds = input.adHistory.map((ad) => ({ ...ad, timeMs: timestamp(ad.observed_at) }));
  const ads = timedAds.filter((ad) => Number.isFinite(ad.timeMs));
  const diagnostics = [];
  const invalidAdValues = input.adHistory.filter((ad) => nonblank(ad.value) && !usable(ad.value, ad.key_kind)).length;
  if (invalidAdValues) diagnostics.push(diagnostic('invalid_join_value', { source: 'ad', count: invalidAdValues }));
  const malformedCrm = timedRows.length - validRows.length; const malformedAds = timedAds.length - ads.length;
  if (malformedCrm) diagnostics.push(diagnostic('malformed_timestamp', { source: 'crm', count: malformedCrm }));
  if (malformedAds) diagnostics.push(diagnostic('malformed_timestamp', { source: 'ad', count: malformedAds }));
  if (validRows.length > windowRows.length) diagnostics.push(diagnostic('outside_window', { source: 'crm', count: validRows.length - windowRows.length }));
  const adOutsideCount = ads.filter((ad) => !inWindow(ad.timeMs, window)).length;
  if (adOutsideCount) diagnostics.push(diagnostic('outside_window', { source: 'ad', count: adOutsideCount }));
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row).filter((field) => field !== timestampField && isCandidateField(field))))].sort();
  const descriptors = input.candidates ?? fields.map((rawField) => ({ rawField, kind: inferKind(rawField), platform: 'unknown', entity_type: 'unknown' }));
  let anyPaidCapturePopulated = false; let outboundTotal = 0; let outboundExcluded = 0;
  for (const { row } of windowRows) for (const field of fields) {
    if (!usable(row[field], inferKind(field))) continue;
    const logical = logicalFieldName(field);
    if (PAID_CAPTURE_RE.test(logical)) anyPaidCapturePopulated = true;
    if (/source/i.test(logical)) { outboundTotal += 1; if (config.excludedLabels.has(normalizeJoinValue(row[field]))) outboundExcluded += 1; }
  }
  const results = descriptors.map((descriptor) => {
    const rawField = descriptor.rawField; const candidate = { ...descriptor, crm_source_system: input.source.source_system, crm_source_scope: input.source.source_scope, logicalField: logicalFieldName(rawField) };
    const fieldRows = windowRows.map(({ row, timeMs }) => ({ value: row[rawField], timeMs }));
    const measured = measure(fieldRows, ads, candidate, input.ad_scope_bindings, window, config);
    if (recent) {
      const recentMeasured = measure(fieldRows, ads, candidate, input.ad_scope_bindings, recent, config);
      measured.recentDistinctRate = recentMeasured.distinctRate;
      measured.recentWeightedRate = recentMeasured.weightedRate;
      measured.recentPopulatedCount = recentMeasured.populatedCount;
      measured.recentPopulatedPct = recentMeasured.populatedPct;
      measured.recentMatchedDistinctCount = recentMeasured.matchedDistinctCount;
    }
    const population = fieldRows.filter(({ value }) => usable(value, candidate.kind));
    const tooEmpty = !population.length || (measured.populatedPct < config.thresholds.populationPctFloor && population.length < config.thresholds.populationRowFloor);
    const itemDiagnostics = [];
    if (measured.invalidValueCount) itemDiagnostics.push(diagnostic('invalid_join_value', { count: measured.invalidValueCount }));
    if (measured.sfInternalFkCount) itemDiagnostics.push(diagnostic('sf_internal_fk', { count: measured.sfInternalFkCount }));
    if (measured.outboundLabelExcludedCount) itemDiagnostics.push(diagnostic('outbound_label_excluded', { count: measured.outboundLabelExcludedCount }));
    let result;
    if (tooEmpty) {
      result = { verdict: PAID_CAPTURE_RE.test(candidate.logicalField) ? 'capture_missing' : 'reject', confidence: 'rejected' };
      itemDiagnostics.push(diagnostic('population_below_threshold'));
    } else if (candidate.kind !== 'presence' && candidate.kind !== 'enum' && !bindingFor(input.ad_scope_bindings, candidate).length) {
      itemDiagnostics.push(diagnostic('source_scope_mismatch')); result = { verdict: 'reject', confidence: 'rejected', fuzzyCeiling: true };
    } else {
      result = verdict(measured, config.thresholds);
      if (result.verdict === 'pre_window') itemDiagnostics.push(diagnostic('ad_value_outside_window'));
      if (result.fuzzyCeiling) itemDiagnostics.push(diagnostic('fuzzy_match_not_used'));
    }
    return { crmField: rawField, logicalField: candidate.logicalField, kind: candidate.kind, platform: candidate.platform, entityType: candidate.entity_type, population: { populatedCount: population.length, populatedPct: measured.populatedPct }, shapeDistribution: shapeDistribution(population.map(({ value }) => value)), joinRates: measured, ...result, diagnostics: itemDiagnostics };
  });
  const outboundDominance = outboundTotal ? outboundExcluded / outboundTotal : 0;
  const archetype = !anyPaidCapturePopulated && outboundExcluded > 0 && outboundDominance >= config.thresholds.outboundDominanceFloor ? 'outbound_bd' : null;
  return { candidates: results, archetype, archetypeEvidence: { anyPaidCapturePopulated, outboundObservationCount: outboundTotal, outboundExcludedCount: outboundExcluded, outboundDominance }, rowCounts: { input: rows.length, validInWindow: windowRows.length, malformedTimestamp: malformedCrm, outsideWindow: validRows.length - windowRows.length }, diagnostics, window: { startInclusive: input.window.startInclusive, endExclusive: input.window.endExclusive, timezone: input.window.timezone }, config: { thresholds: { ...config.thresholds } } };
}
export function decideVerdict(r, thresholds) { return verdict(r, thresholds); }

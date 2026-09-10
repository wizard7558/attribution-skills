import { classify, CHANNELS, TAXONOMY_VERSION } from './channel-taxonomy.mjs';

const CLICK_ORDER = [
  ['dclid', 'google_display'], ['gclid', 'google_ads'], ['gbraid', 'google_ads'],
  ['wbraid', 'google_ads'], ['msclkid', 'bingads'], ['fbclid', 'facebook_ads'],
  ['ttclid', 'tiktok_ads'], ['rdt_cid', 'reddit_ads'], ['li_fat_id', 'linkedin_ads'],
  ['twclid', 'twitter_ads'], ['epik', 'pinterest_ads'], ['sccid', 'snapchat_ads']
];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const CLICK_KEYS = [...CLICK_ORDER.map(([field]) => field), 'srsltid'];
function stringValue(value) { return typeof value === 'string' ? value.trim() : ''; }
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
  return value.trim();
}
function requireIdentity(value, label) {
  const text = requireText(value, label);
  if (text !== value) throw new TypeError(`${label} cannot have surrounding whitespace`);
  return value;
}
function optionalText(value, label) {
  return value === undefined || value === null ? null : requireText(value, label);
}
function decodeOpaque(value) {
  let result = stringValue(value);
  for (let pass = 0; pass < 5; pass += 1) {
    let decoded;
    try { decoded = decodeURIComponent(result); } catch { break; }
    if (decoded === result) break;
    result = decoded;
  }
  return result.trim();
}
function normalizeUtm(value) { return decodeOpaque(value).replaceAll('+', ' ').trim().toLowerCase(); }
function cleanClick(value) {
  const decoded = decodeOpaque(value);
  return !decoded || /^(?:null|undefined|\[object object\])$/i.test(decoded) ? '' : decoded;
}
function normalizeUtmSet(value) {
  return Object.fromEntries(UTM_KEYS.map((key) => [key, normalizeUtm(value?.[key])]));
}
function hasUtm(utm) { return UTM_KEYS.some((key) => Boolean(utm[key])); }
function rawValues(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, typeof source?.[key] === 'string' ? source[key] : null]));
}
function rawTracking(lead) {
  return { click_ids: rawValues(lead.click_ids, CLICK_KEYS), current_utm: rawValues(lead, UTM_KEYS), first_touch_utm: rawValues(lead.first_touch, UTM_KEYS), first_touch_click_ids: rawValues(lead.first_touch?.click_ids, CLICK_KEYS), native_channel: typeof lead.native_channel === 'string' ? lead.native_channel : null };
}
function arrayOption(options, key) {
  if (options[key] === undefined) return [];
  if (!Array.isArray(options[key])) throw new TypeError(`${key} must be an array`);
  return options[key];
}
function mappingMetadata(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`${label} must be an object`);
  if (!CHANNELS.includes(row.channel)) throw new TypeError(`${label}.channel must be a canonical channel`);
  return { channel: row.channel, network_id: row.network_id === undefined || row.network_id === null ? null : requireIdentity(row.network_id, `${label}.network_id`), campaign_key: optionalText(row.campaign_key, `${label}.campaign_key`) };
}
function addUnique(map, key, value, label) {
  if (map.has(key) && JSON.stringify(map.get(key)) !== JSON.stringify(value)) throw new TypeError(`conflicting ${label}`);
  map.set(key, value);
}
function compileConfig(sourceMap = [], sourcePatterns = []) {
  const exact = new Map(); const patterns = new Map();
  for (const row of sourceMap) {
    const metadata = mappingMetadata(row, 'source_map');
    const source = normalizeUtm(requireText(row.utm_source ?? row.source, 'source_map.source'));
    const mediumRaw = row.utm_medium ?? row.medium;
    if (mediumRaw !== undefined && mediumRaw !== null && typeof mediumRaw !== 'string') throw new TypeError('source_map.medium must be a string');
    const medium = normalizeUtm(mediumRaw);
    if (!source) throw new TypeError('source_map.source must normalize to a nonempty string');
    addUnique(exact, JSON.stringify([source, medium]), { source, medium, ...metadata }, 'source_map entries');
  }
  for (const row of sourcePatterns) {
    const metadata = mappingMetadata(row, 'source_patterns');
    const id = requireText(row.id, 'source_patterns.id');
    if (typeof row.priority !== 'number' || !Number.isFinite(row.priority)) throw new TypeError('source_patterns.priority must be a finite number');
    const source = requireText(row.source_regex, 'source_patterns.source_regex');
    const medium = optionalText(row.medium_regex, 'source_patterns.medium_regex');
    try { new RegExp(source, 'i'); if (medium) new RegExp(medium, 'i'); } catch { throw new TypeError('invalid source pattern regex'); }
    addUnique(patterns, id, { id, priority: row.priority, source, medium, ...metadata }, 'source_patterns IDs');
  }
  return { exact: [...exact.values()], patterns: [...patterns.values()].sort((a, b) => a.priority - b.priority || compareText(a.id, b.id)).map((row) => ({ ...row, sourceRegex: new RegExp(row.source, 'i'), mediumRegex: row.medium ? new RegExp(row.medium, 'i') : null })) };
}
function sourceMatch(utm, config) {
  const exact = config.exact.filter((row) => row.source === utm.utm_source && (!row.medium || row.medium === utm.utm_medium)).sort((a, b) => Number(Boolean(b.medium)) - Number(Boolean(a.medium)));
  return exact[0] ?? config.patterns.find((row) => row.sourceRegex.test(utm.utm_source) && (!row.mediumRegex || row.mediumRegex.test(utm.utm_medium))) ?? null;
}
function resolveUtm(utm, config, rawUtm) {
  const mapping = sourceMatch(utm, config);
  // The canonical classifier receives raw evidence and owns its five decoding passes.
  const classification = mapping ? classify({ native_channel: mapping.channel }) : classify(Object.fromEntries(UTM_KEYS.map((key) => [key, rawUtm?.[key]])));
  return { classification, network_id: mapping?.network_id ?? '', campaign_key: mapping?.campaign_key ?? '', known: Boolean(mapping) || classification.rule_id !== 'fallback_other' };
}
function selectedClick(raw, selected, prefix) {
  for (const [field, network_id] of CLICK_ORDER) {
    const matchValue = cleanClick(raw?.click_ids?.[field]);
    if (!matchValue) continue;
    const classification = classify({ click_ids: { [field]: raw.click_ids[field] } });
    return { classification, channel: classification.channel, basisKey: `${prefix}:${field}`, matchKey: field, matchValue, network_id, campaign_key: '', selected, selected_raw: raw, quality_status: 'matched', confidence: prefix === 'click' ? 'HIGH' : 'LOW' };
  }
  return null;
}
function resolveAttribution(lead, config) {
  const current = normalizeUtmSet(lead); const first = normalizeUtmSet(lead.first_touch);
  const click = selectedClick(lead, current, 'click');
  if (click) return click;
  if (hasUtm(current)) {
    const resolved = resolveUtm(current, config, lead);
    return { ...resolved, channel: resolved.classification.channel, basisKey: 'utm:current', matchKey: 'utm_source', matchValue: current.utm_source || current.utm_medium, selected: current, selected_raw: lead, quality_status: resolved.known ? 'matched' : 'unmapped', confidence: resolved.known ? 'MEDIUM' : 'UNMATCHED' };
  }
  const firstClick = selectedClick(lead.first_touch, first, 'first_touch_click');
  if (firstClick) return firstClick;
  if (hasUtm(first)) {
    const resolved = resolveUtm(first, config, lead.first_touch);
    return { ...resolved, channel: resolved.classification.channel, basisKey: 'utm:first_touch', matchKey: 'first_touch_utm_source', matchValue: first.utm_source || first.utm_medium, selected: first, selected_raw: lead.first_touch, quality_status: resolved.known ? 'matched' : 'unmapped', confidence: resolved.known ? 'LOW' : 'UNMATCHED' };
  }
  return { classification: classify({}), channel: 'Other', basisKey: 'none', matchKey: 'none', matchValue: '', network_id: '', campaign_key: '', selected: current, selected_raw: lead, quality_status: 'unattributed', confidence: 'UNMATCHED' };
}
function prepareAds(options) {
  const entities = new Map();
  for (const row of arrayOption(options, 'ad_catalog')) {
    const entity = {};
    for (const key of ['source_system', 'source_scope', 'network_id', 'ad_key']) entity[key] = key === 'ad_key' ? requireText(row?.[key], `ad_catalog.${key}`) : requireIdentity(row?.[key], `ad_catalog.${key}`);
    entity.campaign_key = optionalText(row.campaign_key, 'ad_catalog.campaign_key');
    entity.ad_name = optionalText(row.ad_name, 'ad_catalog.ad_name');
    const key = JSON.stringify([entity.source_system, entity.source_scope, entity.network_id, entity.ad_key]);
    addUnique(entities, key, entity, 'ad_catalog entity metadata');
  }
  const bindings = arrayOption(options, 'ad_scope_bindings').map((row) => Object.fromEntries(['crm_source_system', 'crm_source_scope', 'ad_source_system', 'ad_source_scope', 'platform', 'entity_type'].map((key) => [key, requireIdentity(row?.[key], `ad_scope_bindings.${key}`)])));
  return { catalog: [...entities.values()], bindings };
}
function candidateIdentity(row) {
  return { source_system: row.source_system, source_scope: row.source_scope, ad_key: row.ad_key, campaign_key: row.campaign_key };
}
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function sortedCandidates(rows) {
  return rows.map(candidateIdentity).sort((a, b) => compareText(JSON.stringify([a.source_system, a.source_scope, a.ad_key, a.campaign_key]), JSON.stringify([b.source_system, b.source_scope, b.ad_key, b.campaign_key])));
}
function adResult(rows = [], method = 'none', scopeMethod = 'none', confidence = 'UNMATCHED') {
  const candidates = sortedCandidates(rows); const match = method === 'exact_ad_key' || method === 'normalized_ad_name' ? candidates[0] : null;
  return { ad_source_system: match?.source_system ?? null, ad_source_scope: match?.source_scope ?? null, ad_key: match?.ad_key ?? null, campaign_key: match?.campaign_key ?? null, ad_match_method: method, ad_scope_method: scopeMethod, ad_confidence: confidence, ad_match_status: match ? 'matched' : method === 'ambiguous' ? 'ambiguous' : 'unmatched', candidate_ads: candidates, candidate_ad_keys: candidates.map((row) => `${row.source_system}:${row.source_scope}:${row.ad_key}`) };
}
function adMatch(lead, attribution, ads) {
  const network = attribution.network_id;
  const rawContent = attribution.selected_raw?.utm_content;
  const contentId = decodeOpaque(rawContent); const contentName = normalizeUtm(rawContent);
  if (!network || !contentId) return adResult();
  let candidates = ads.catalog.filter((row) => row.network_id === network);
  let scopeMethod;
  if (ads.bindings.length) {
    const allowed = ads.bindings.filter((row) => row.crm_source_system === lead.source_system && row.crm_source_scope === lead.source_scope && row.platform === network && row.entity_type === 'ad');
    if (!allowed.length) return adResult([], 'none', 'binding_not_authorized');
    scopeMethod = 'explicit_binding';
    candidates = candidates.filter((row) => allowed.some((binding) => row.source_system === binding.ad_source_system && row.source_scope === binding.ad_source_scope));
  } else {
    const scopes = new Set(candidates.map((row) => JSON.stringify([row.source_system, row.source_scope])));
    if (scopes.size > 1) return adResult(candidates, 'ambiguous', 'multiple_accounts');
    scopeMethod = scopes.size ? 'single_account_inference' : 'none';
  }
  const exact = candidates.filter((row) => decodeOpaque(row.ad_key) === contentId);
  if (exact.length === 1) return adResult(exact, 'exact_ad_key', scopeMethod, 'HIGH');
  if (exact.length > 1) return adResult(exact, 'ambiguous', scopeMethod);
  // Normalize each original raw name exactly once; never normalize contentId again.
  const names = contentName ? candidates.filter((row) => row.ad_name && normalizeUtm(row.ad_name) === contentName) : [];
  if (names.length === 1) return adResult(names, 'normalized_ad_name', scopeMethod, 'MEDIUM');
  if (names.length > 1) return adResult(names, 'ambiguous', scopeMethod);
  return adResult([], 'none', scopeMethod);
}
function dateRank(value) {
  if (value === null) return null;
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw new TypeError('created_at must be a valid calendar ISO timestamp with offset/Z or null');
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || (m[7] !== 'Z' && (Number(m[7].slice(1, 3)) > 23 || Number(m[7].slice(4)) > 59)) || !Number.isFinite(Date.parse(value))) throw new TypeError('created_at must be a valid calendar ISO timestamp with offset/Z or null');
  // Parse a whole second before applying the fraction, including before the epoch.
  const epoch_seconds = Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, '')) / 1000;
  const fraction = /\.(\d{1,9})(?=Z|[+-]\d{2}:\d{2}$)/.exec(value)?.[1] ?? '';
  return { epoch_seconds, nanosecond: Number(fraction.padEnd(9, '0')) };
}
function compareDates(left, right) {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left.epoch_seconds - right.epoch_seconds || left.nanosecond - right.nanosecond;
}
export function attributeLeads(leads, options = {}) {
  if (!Array.isArray(leads)) throw new TypeError('leads must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const config = compileConfig(arrayOption(options, 'source_map'), arrayOption(options, 'source_patterns'));
  const ads = prepareAds(options); const seenKeys = new Set();
  const prepared = leads.map((lead) => {
    if (!lead || typeof lead !== 'object' || Array.isArray(lead)) throw new TypeError('lead must be an object');
    for (const field of ['source_system', 'source_scope', 'lead_key']) {
      requireIdentity(lead[field], `lead.${field}`);
    }
    const rank = dateRank(lead.created_at);
    const key = JSON.stringify([lead.source_system, lead.source_scope, lead.lead_key]);
    if (seenKeys.has(key)) throw new TypeError('duplicate lead key');
    seenKeys.add(key);
    const attribution = resolveAttribution(lead, config);
    const matchedAds = adMatch(lead, attribution, ads);
    const dedupKey = ['click:', 'first_touch_click:'].some((prefix) => attribution.basisKey.startsWith(prefix)) ? JSON.stringify([lead.source_system, lead.source_scope, attribution.matchKey, attribution.matchValue]) : null;
    return { lead, attribution, ads: matchedAds, dedupKey, rank };
  });
  const primaries = new Map();
  for (const item of prepared) {
    if (!item.dedupKey) continue;
    const previous = primaries.get(item.dedupKey);
    if (!previous || compareDates(item.rank, previous.rank) < 0 || (compareDates(item.rank, previous.rank) === 0 && compareText(item.lead.lead_key, previous.lead.lead_key) < 0)) primaries.set(item.dedupKey, item);
  }
  return prepared.map((item) => {
    const { lead, attribution, ads, dedupKey } = item;
    return { source_system: lead.source_system, source_scope: lead.source_scope, lead_key: lead.lead_key, created_at: lead.created_at, channel: attribution.classification.channel, taxonomy_version: TAXONOMY_VERSION, rule: attribution.classification.rule_id, attribution_basis: 'crm_paid_resolution', match_key: attribution.matchKey, confidence: attribution.confidence, quality_status: attribution.quality_status, raw_evidence: rawTracking(lead), is_attribution_primary: dedupKey ? primaries.get(dedupKey) === item : true, ...ads, network_id: attribution.network_id || null, campaign_key: ads.campaign_key ?? (attribution.campaign_key || null) };
  });
}
export { cleanClick, normalizeUtm, resolveAttribution };

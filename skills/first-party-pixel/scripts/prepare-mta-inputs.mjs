import { projectIdentity } from './project-identity.mjs';

const CONFIG_FIELDS = ['invocation_key', 'report_timezone', 'report_start_date', 'report_end_date', 'as_of', 'requested_lookback_days', 'min_lookback_days', 'max_lookback_days', 'half_life_days', 'conversion_window_mode'];
const SUBJECT_FIELDS = ['subject_source_system', 'subject_source_scope', 'subject_key'];
const TOUCH_FIELDS = ['invocation_key', 'source_system', 'source_scope', 'touch_key', 'visitor_key', 'occurred_at', 'channel', 'taxonomy_version', ...SUBJECT_FIELDS];
const CONVERSION_FIELDS = ['invocation_key', 'source_system', 'source_scope', 'conversion_key', 'occurred_at', ...SUBJECT_FIELDS, 'value', 'currency', 'value_status'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function invalid(rule) { throw new TypeError(`Invalid MTA handoff: ${rule}`); }
function plain(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') invalid('plain finite JSON required');
  if (seen.has(value)) invalid('cyclic input');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('plain object required');
  if (Object.getOwnPropertySymbols(value).length) invalid('symbol fields');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !own(descriptor, 'value')) invalid('data properties required');
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) invalid('array index required');
    plain(descriptor.value, seen);
  }
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!own(value, i)) invalid('dense arrays required');
  seen.delete(value);
}
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !own(value, key)) || Object.keys(value).some(key => !keys.includes(key))) invalid('exact input fields required');
}
function exact(value) { if (typeof value !== 'string' || value === '' || value !== value.trim()) invalid('exact nonempty string required'); }
function pick(row, keys) { return Object.fromEntries(keys.map(key => [key, row[key]])); }
function nativeTimestamp(original) {
  exact(original);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(original)) invalid('explicit ISO timestamp transport required');
  // Fraction inspection only, not a calendar parser or a temporal comparison.
  const fraction = /(\d{2}:\d{2}:\d{2})\.(\d+)/.exec(original);
  if (!fraction || fraction[2].length <= 6) return original;
  if (fraction[2].length > 9 || /[1-9]/.test(fraction[2].slice(6))) {
    const error = new TypeError('unsupported_timestamp_precision'); error.code = 'unsupported_timestamp_precision'; throw error;
  }
  const start = fraction.index + fraction[1].length + 1;
  return original.slice(0, start) + fraction[2].slice(0, 6) + original.slice(start + fraction[2].length);
}
function decimal(value) {
  if (value === null) return;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) invalid('plain decimal string or null required');
  if ((value.split('.')[1]?.length ?? 0) > 9) {
    const error = new TypeError('unsupported_decimal_precision'); error.code = 'unsupported_decimal_precision'; throw error;
  }
}

export async function prepareMtaInputs(input, options) {
  plain(input); plain(options);
  shape(options, ['identitySkillRoot']); exact(options.identitySkillRoot);
  const identitySkillRoot = options.identitySkillRoot;
  input = structuredClone(input); // Capture every caller-owned value before any await.
  shape(input, ['identity_input', 'configuration', 'conversions', 'conversion_evidence_ref']);
  shape(input.configuration, CONFIG_FIELDS);
  const config = input.configuration;
  for (const field of ['invocation_key', 'report_timezone', 'report_start_date', 'report_end_date', 'as_of', 'conversion_window_mode']) exact(config[field]);
  for (const field of ['requested_lookback_days', 'min_lookback_days', 'max_lookback_days']) {
    if (!(typeof config[field] === 'number' && Number.isSafeInteger(config[field])) && !(typeof config[field] === 'string' && /^-?\d+$/.test(config[field]))) invalid('lookback transport requires safe integer Number or plain integer string');
  }
  if (typeof config.half_life_days !== 'number' || !Number.isFinite(config.half_life_days)) invalid('finite half-life Number required');
  if (!input.identity_input?.config || input.identity_input.config.invocation_key !== config.invocation_key || input.identity_input.config.as_of !== config.as_of) invalid('identity/MTA invocation and original as_of must match exactly');
  exact(input.conversion_evidence_ref);
  if (!Array.isArray(input.conversions)) invalid('conversions array required');
  const asOfNative = nativeTimestamp(config.as_of);
  const conversionEvidence = [];
  const conversions = input.conversions.map(row => {
    shape(row, CONVERSION_FIELDS);
    for (const field of ['invocation_key', 'source_system', 'source_scope', 'conversion_key', 'occurred_at']) exact(row[field]);
    if (row.invocation_key !== config.invocation_key) invalid('conversion invocation mismatch');
    const nullSubjects = SUBJECT_FIELDS.filter(field => row[field] === null).length;
    if (nullSubjects !== 0 && nullSubjects !== 3) invalid('all-or-none qualified subject required');
    if (nullSubjects === 0) SUBJECT_FIELDS.forEach(field => exact(row[field]));
    decimal(row.value);
    if (row.currency !== null && typeof row.currency !== 'string' || typeof row.value_status !== 'string') invalid('currency/status transport types');
    const native = nativeTimestamp(row.occurred_at);
    conversionEvidence.push({ ...pick(row, ['source_system', 'source_scope', 'conversion_key']), original: row.occurred_at, native });
    return { ...pick(row, CONVERSION_FIELDS), occurred_at: native };
  });
  const projection = await projectIdentity(input.identity_input, { identitySkillRoot });
  const touchEvidence = [];
  const touches = projection.touches.map(row => {
    const native = nativeTimestamp(row.occurred_at);
    touchEvidence.push({ ...pick(row, ['source_system', 'source_scope', 'visitor_key', 'touch_key']), original: row.occurred_at, native });
    return { ...pick(row, TOUCH_FIELDS), occurred_at: native };
  });
  return {
    contract_version: '0.1.0', projection,
    input: { configuration: { ...pick(config, CONFIG_FIELDS), as_of: asOfNative }, touches, conversions },
    evidence_refs: { snapshot_evidence_ref: projection.snapshot_evidence_ref, external_contact_evidence_ref: projection.external_contact_evidence_ref, conversion_evidence_ref: input.conversion_evidence_ref },
    timestamp_evidence: { as_of: { original: config.as_of, native: asOfNative }, touches: touchEvidence, conversions: conversionEvidence }
  };
}

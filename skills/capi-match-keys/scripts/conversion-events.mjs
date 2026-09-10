import crypto from 'node:crypto';
import { SUPPORTED_PLATFORMS } from './match-keys.mjs';

// Schema vocabulary only; this standalone skill does not import a sibling skill.
const CLICK_ID_NAMES = new Set(['dclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'rdt_cid', 'li_fat_id', 'twclid', 'epik', 'sccid', 'srsltid']);
const PLATFORM_CLICK_KINDS = {
  meta: ['fbclid'], google: ['gclid', 'gbraid', 'wbraid'], tiktok: ['ttclid'],
  linkedin: ['li_fat_id'], reddit: ['rdt_cid'],
};
const BINDING_FIELDS = ['conversion_source_system', 'conversion_source_scope', 'click_source_system', 'click_source_scope'];
const CLICK_FIELDS = ['source_system', 'source_scope', 'click_key', 'occurred_at', 'kind', 'value', 'conversion_source_system', 'conversion_source_scope', 'conversion_key'];
const SUBJECT_FIELDS = ['subject_source_system', 'subject_source_scope', 'subject_key'];
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/;
const PLACEHOLDER = /^(?:null|undefined|\[object object\]|n\/a|na|none)$/i;
const DAY_NS = 86400000000000n;

function invalid(label) { throw new TypeError(`Invalid ${label}`); }

// Reject runtime objects, accessors, nonfinite numbers, and cycles even in unused
// fields. Never stringify arbitrary input or include input data in diagnostics.
function data(value, active = new Set()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('data number'); return; }
  if (typeof value !== 'object' || active.has(value)) invalid('plain acyclic data');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) invalid('plain data object');
  active.add(value);
  const keys = Reflect.ownKeys(value);
  if (array) {
    if (keys.length !== value.length + 1) invalid('dense data array');
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) invalid('dense data array');
    }
    if (keys.some((key) => key !== 'length' && (typeof key !== 'string'
      || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) invalid('data array property');
  }
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') invalid('data property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid('data property');
    data(descriptor.value, active);
  }
  active.delete(value);
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  data(value);
}

function exactKey(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || CONTROLS.test(value)) invalid(label);
  return value;
}

function timestamp(value, label) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) invalid(label);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', offset] = parts;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59
    || offsetMinute > 59 || offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0)) invalid(label);
  const secondsMillis = Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${offset}`);
  if (!Number.isSafeInteger(secondsMillis)) invalid(label);
  return BigInt(secondsMillis) * 1000000n + BigInt(fraction.padEnd(9, '0'));
}

// Interpret the finite Number's standard decimal spelling exactly. Rational
// comparisons avoid overflow and do not round policy limits to milliseconds.
function daysRational(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(label);
  const [mantissa, exponentText = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const exponent = Number(exponentText) - fraction.length;
  const digits = BigInt(whole + fraction);
  return exponent >= 0
    ? { numerator: digits * (10n ** BigInt(exponent)) * DAY_NS, denominator: 1n }
    : { numerator: digits * DAY_NS, denominator: 10n ** BigInt(-exponent) };
}

function exceeds(delta, limit) { return delta * limit.denominator > limit.numerator; }
function byteOrder(a, b) { return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
function qualifiedClick(row) { return JSON.stringify([row.source_system, row.source_scope, row.click_key]); }
function conversionReference(row) { return JSON.stringify([row.source_system, row.source_scope, row.conversion_key]); }
function bindingKey(row) { return JSON.stringify(BINDING_FIELDS.map((field) => row[field])); }

function money(row) {
  const { value, currency, value_status } = row;
  const validCurrency = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency);
  if (value_status === 'known') {
    const validNumber = typeof value === 'number' && Number.isFinite(value)
      && (!Number.isInteger(value) || Number.isSafeInteger(value));
    const validDecimal = typeof value === 'string' && /^-?(?:0|[1-9][0-9]{0,28})(?:\.[0-9]{1,9})?$/.test(value);
    if ((!validNumber && !validDecimal) || !validCurrency) invalid('known money');
  } else if (value_status === 'unknown') {
    if (value !== null || (currency !== null && !validCurrency)) invalid('unknown money');
  } else if (value_status === 'mixed_currency') {
    if (value !== null || currency !== null) invalid('mixed-currency money');
  } else invalid('value_status');
  return { value, currency, value_status };
}

export function makeConversionId(input) {
  record(input, 'conversion identity');
  const keys = ['source_system', 'source_scope', 'conversion_key'].map((key) => exactKey(input[key], 'conversion identity key'));
  return crypto.createHash('sha256').update(JSON.stringify(['conversion', 1, ...keys]), 'utf8').digest('hex');
}

export function conversionFromStage(row) {
  record(row, 'stage row');
  for (const field of ['source_system', 'source_scope', 'lead_key', 'stage_key']) exactKey(row[field], 'stage identity key');
  if (row.achieved !== true && row.achieved !== false && row.achieved !== null) invalid('achieved');
  if (typeof row.is_attribution_primary !== 'boolean') invalid('is_attribution_primary');
  if (row.stage_entered_at !== null) timestamp(row.stage_entered_at, 'stage_entered_at');
  const amount = money(row);
  const status = row.achieved === false ? 'not_achieved' : row.achieved === null ? 'stage_unknown'
    : row.stage_entered_at === null ? 'undated' : 'eligible';
  if (status !== 'eligible') return { status, conversion: null, business_conversion_id: null };
  const conversion = {
    source_system: row.source_system, source_scope: row.source_scope,
    conversion_key: JSON.stringify([row.lead_key, row.stage_key]), occurred_at: row.stage_entered_at,
    subject_source_system: null, subject_source_scope: null, subject_key: null, ...amount,
  };
  return { status, conversion, business_conversion_id: makeConversionId(conversion) };
}

function normalizeConversion(row) {
  record(row, 'conversion');
  for (const field of ['source_system', 'source_scope', 'conversion_key']) exactKey(row[field], 'conversion identity key');
  const time = timestamp(row.occurred_at, 'conversion occurred_at');
  const subjectValues = SUBJECT_FIELDS.map((field) => row[field] ?? null);
  if (subjectValues.some((value) => value !== null)) {
    for (const value of subjectValues) exactKey(value, 'qualified subject');
  }
  return {
    time,
    conversion: {
      source_system: row.source_system, source_scope: row.source_scope, conversion_key: row.conversion_key,
      occurred_at: row.occurred_at, ...Object.fromEntries(SUBJECT_FIELDS.map((field, index) => [field, subjectValues[index]])), ...money(row),
    },
  };
}

function normalizePolicy(row, platform) {
  record(row, 'policy');
  const asOf = timestamp(row.as_of, 'policy as_of');
  const eventAge = daysRational(row.max_event_age_days, 'max_event_age_days');
  const clickAge = daysRational(row.click_lookback_days, 'click_lookback_days');
  if (!Array.isArray(row.click_scope_bindings)) invalid('click_scope_bindings');
  const bindings = new Map();
  for (const binding of row.click_scope_bindings) {
    record(binding, 'click scope binding');
    if (Object.keys(binding).length !== BINDING_FIELDS.length || !BINDING_FIELDS.every((field) => Object.hasOwn(binding, field))) invalid('click scope binding fields');
    const projected = Object.fromEntries(BINDING_FIELDS.map((field) => [field, exactKey(binding[field], 'click scope binding key')]));
    bindings.set(bindingKey(projected), projected);
  }
  return {
    asOf, eventAge, clickAge, bindings,
    summary: {
      source: 'caller_supplied', platform, as_of: row.as_of,
      max_event_age_days: row.max_event_age_days, click_lookback_days: row.click_lookback_days,
      click_scope_bindings: [...bindings.entries()].sort(([a], [b]) => byteOrder(a, b)).map(([, binding]) => binding),
    },
  };
}

function normalizeClicks(rows) {
  if (!Array.isArray(rows)) invalid('click_observations');
  const clicks = new Map();
  let duplicates = 0;
  for (const input of rows) {
    record(input, 'click observation');
    for (const field of ['source_system', 'source_scope', 'click_key', 'conversion_source_system', 'conversion_source_scope', 'conversion_key']) exactKey(input[field], 'click identity key');
    const time = timestamp(input.occurred_at, 'click occurred_at');
    if (!CLICK_ID_NAMES.has(input.kind)) invalid('click kind');
    if (typeof input.value !== 'string' || !input.value || /\s/.test(input.value) || CONTROLS.test(input.value) || PLACEHOLDER.test(input.value)) invalid('canonical click value');
    const row = Object.fromEntries(CLICK_FIELDS.map((field) => [field, input[field]]));
    const key = qualifiedClick(row);
    const prior = clicks.get(key);
    if (prior) {
      if (JSON.stringify(prior.row) !== JSON.stringify(row)) invalid('conflicting qualified click observation');
      duplicates += 1;
    } else clicks.set(key, { row, time, key });
  }
  return { clicks: [...clicks.values()].sort((a, b) => byteOrder(a.key, b.key)), duplicates };
}

export function prepareConversion(input) {
  record(input, 'prepare input');
  if (!SUPPORTED_PLATFORMS.includes(input.platform)) invalid('platform');
  const { conversion, time } = normalizeConversion(input.conversion);
  const businessConversionId = makeConversionId(conversion);
  const eventId = input.browser_event_id === undefined || input.browser_event_id === null
    ? businessConversionId : exactKey(input.browser_event_id, 'browser_event_id');
  const policy = normalizePolicy(input.policy, input.platform);
  // Validate all observations before eligibility or matching can exclude any row.
  const { clicks, duplicates } = normalizeClicks(input.click_observations);
  const reasons = time > policy.asOf ? ['future_event'] : exceeds(policy.asOf - time, policy.eventAge) ? ['event_too_old'] : [];
  const reference = conversionReference(conversion);
  const exclusions = [];
  const selected = new Map();
  function exclude(click, reason) {
    exclusions.push({ source_system: click.row.source_system, source_scope: click.row.source_scope, click_key: click.row.click_key, reason });
  }
  for (const click of clicks) {
    const row = click.row;
    const ref = JSON.stringify([row.conversion_source_system, row.conversion_source_scope, row.conversion_key]);
    const binding = JSON.stringify([conversion.source_system, conversion.source_scope, row.source_system, row.source_scope]);
    let reason;
    if (ref !== reference) reason = 'unrelated_conversion';
    else if (!policy.bindings.has(binding)) reason = 'unbound_click_scope';
    else if (!PLATFORM_CLICK_KINDS[input.platform].includes(row.kind)) reason = 'unsupported_platform_kind';
    else if (click.time > time) reason = 'future_click';
    else if (exceeds(time - click.time, policy.clickAge)) reason = 'click_too_old';
    if (reason) { exclude(click, reason); continue; }
    const previous = selected.get(row.kind);
    // Clicks already have ascending byte-key order, so equal instants retain the
    // first qualified key. Latest observation wins independently for every kind.
    if (!previous || click.time > previous.time) {
      if (previous) exclude(previous, 'superseded');
      selected.set(row.kind, click);
    } else exclude(click, 'superseded');
  }
  const selectedClicks = [...selected.values()].sort((a, b) => byteOrder(a.row.kind, b.row.kind)).map(({ row }) => ({
    kind: row.kind, value: row.value, occurred_at: row.occurred_at,
    source_system: row.source_system, source_scope: row.source_scope, click_key: row.click_key,
  }));
  exclusions.sort((a, b) => byteOrder(qualifiedClick(a), qualifiedClick(b)));
  return {
    status: reasons.length ? 'ineligible' : 'ready', reasons, event_id: eventId,
    business_conversion_id: businessConversionId, conversion, selected_clicks: selectedClicks,
    click_diagnostics: {
      input_count: input.click_observations.length, unique_count: clicks.length, duplicate_count: duplicates,
      selected_count: selectedClicks.length, excluded_count: exclusions.length, excluded: exclusions,
      no_selected_clicks: selectedClicks.length === 0,
    },
    policy: policy.summary,
  };
}

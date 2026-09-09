import { buildMetaFbc, hashPlatformIdentity } from './match-keys.mjs';
import { prepareConversion } from './conversion-events.mjs';

const CONFIG_KEYS = {
  reddit: ['account_id', 'pixel_id', 'tracking_type', 'custom_event_name', 'action_source', 'event_source_url', 'test_id', 'data_processing', 'money_policy'],
  tiktok: ['account_id', 'pixel_id', 'event_name', 'page_url', 'page_referrer', 'client_user_agent', 'test_event_code', 'limited_data_use', 'money_policy'],
  meta: ['account_id', 'pixel_id', 'api_version', 'event_name', 'action_source', 'event_source_url', 'client_user_agent', 'test_event_code', 'data_processing', 'opt_out', 'advertiser_tracking_enabled', 'money_policy'],
  google: ['account_id', 'conversion_action_id', 'login_account_id', 'linked_account_id', 'event_source', 'consent', 'validate_only', 'money_policy'],
  linkedin: ['account_id', 'conversion_rule_id', 'api_version', 'money_policy'],
};
const GOOGLE_EVENTS = new Set(['WEB', 'APP', 'IN_STORE', 'PHONE', 'MESSAGE', 'OTHER']);
const CONSENT = new Set(['CONSENT_GRANTED', 'CONSENT_DENIED', 'CONSENT_STATUS_UNSPECIFIED']);
const GOOGLE_CLICKS = ['gclid', 'gbraid', 'wbraid'];
const MS_NS = 1000000n;
const SECOND_NS = 1000000000n;
const REDDIT_EVENTS = new Set(['PAGE_VISIT', 'VIEW_CONTENT', 'SEARCH', 'ADD_TO_CART', 'ADD_TO_WISHLIST', 'PURCHASE', 'LEAD', 'SIGN_UP', 'CUSTOM']);
const REDDIT_SOURCES = new Set(['WEBSITE', 'APP', 'OTHER', 'PHYSICAL_STORE']);
const META_SOURCES = new Set(['physical_store', 'app', 'chat', 'email', 'other', 'phone_call', 'system_generated', 'website']);
const DAY_NS = 86400000000000n;
const GOOGLE_MIN_NS = -62135596800000000000n;
const GOOGLE_MAX_NS = 253402300799999999999n;

function fail(label) { throw new TypeError(`Invalid ${label}`); }

// Inspect descriptors before reading values: even ignored metadata must be plain
// data, and a getter must never run during validation or serialization.
function plain(value, active = new Set()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('data number'); return; }
  if (typeof value !== 'object' || active.has(value)) fail('plain acyclic data');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('plain data object');
  const keys = Reflect.ownKeys(value);
  if (array) {
    if (keys.length !== value.length + 1) fail('dense data array');
    for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) fail('dense data array');
    if (keys.some((key) => key !== 'length' && (typeof key !== 'string'
      || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) fail('data array property');
  }
  active.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') fail('data property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('data property');
    plain(descriptor.value, active);
  }
  active.delete(value);
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields`);
}
function digits(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) fail(label);
}
function exactText(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.length || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || !value.isWellFormed()) fail(label);
}
function absoluteHttpUrl(value, label) {
  if (value === null) return;
  exactText(value, label);
  let parsed;
  try { parsed = new URL(value); } catch { fail(label); }
  if (!/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname || parsed.username || parsed.password) fail(label);
}
function redditConfiguration(value) {
  exactText(value.pixel_id, 'pixel_id');
  if (!REDDIT_EVENTS.has(value.tracking_type)) fail('tracking_type');
  if (value.tracking_type === 'CUSTOM') {
    exactText(value.custom_event_name, 'custom_event_name');
    if ([...value.custom_event_name].length > 64) fail('custom_event_name length');
  } else if (value.custom_event_name !== null) fail('custom_event_name');
  if (!REDDIT_SOURCES.has(value.action_source)) fail('action_source');
  absoluteHttpUrl(value.event_source_url, 'event_source_url');
  if (value.event_source_url !== null && value.action_source !== 'WEBSITE') fail('event_source_url action');
  exactText(value.test_id, 'test_id', true);
  if (value.data_processing !== null) {
    exactObject(value.data_processing, ['modes', 'country', 'region'], 'data_processing');
    const { modes, country, region } = value.data_processing;
    if (!Array.isArray(modes) || modes.length !== 1 || modes[0] !== 'LDU') fail('data_processing modes');
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) fail('data_processing country');
    if (region !== null && (typeof region !== 'string'
      || !(/^[A-Z0-9]{1,3}$/.test(region) || (region.startsWith(country + '-') && /^[A-Z0-9]{1,3}$/.test(region.slice(3)))))) fail('data_processing region');
  }
}
function tiktokConfiguration(value) {
  exactText(value.pixel_id, 'pixel_id');
  exactText(value.event_name, 'event_name');
  absoluteHttpUrl(value.page_url, 'page_url');
  absoluteHttpUrl(value.page_referrer, 'page_referrer');
  if (value.page_referrer !== null && value.page_url === null) fail('page_referrer context');
  exactText(value.client_user_agent, 'client_user_agent', true);
  exactText(value.test_event_code, 'test_event_code', true);
  if (value.limited_data_use !== null && typeof value.limited_data_use !== 'boolean') fail('limited_data_use');
}
function metaConfiguration(value) {
  digits(value.pixel_id, 'pixel_id');
  if (typeof value.api_version !== 'string' || !/^v[1-9][0-9]*\.[0-9]+$/.test(value.api_version)) fail('api_version');
  exactText(value.event_name, 'event_name');
  if (!META_SOURCES.has(value.action_source)) fail('action_source');
  exactText(value.client_user_agent, 'client_user_agent', true);
  exactText(value.test_event_code, 'test_event_code', true);
  absoluteHttpUrl(value.event_source_url, 'event_source_url');
  if (value.action_source === 'website' && (value.event_source_url === null || value.client_user_agent === null)) fail('website context');
  if (value.data_processing !== null) {
    exactObject(value.data_processing, ['options', 'country', 'state'], 'data_processing');
    const { options, country, state } = value.data_processing;
    if (!Array.isArray(options) || !(options.length === 0 || (options.length === 1 && options[0] === 'LDU'))) fail('data_processing options');
    if (![country, state].every((x) => Number.isSafeInteger(x) && x >= 0)) fail('data_processing location');
  }
  for (const key of ['opt_out', 'advertiser_tracking_enabled']) if (value[key] !== null && typeof value[key] !== 'boolean') fail(key);
}
function configuration(value, platform) {
  exactObject(value, CONFIG_KEYS[platform], `${platform} configuration`);
  if (['tiktok', 'reddit'].includes(platform)) exactText(value.account_id, 'account_id');
  else digits(value.account_id, 'account_id');
  if (!['require_known', 'omit_unknown'].includes(value.money_policy)) fail('money_policy');
  if (platform === 'google') {
    digits(value.conversion_action_id, 'conversion_action_id');
    digits(value.login_account_id, 'login_account_id', true);
    digits(value.linked_account_id, 'linked_account_id', true);
    if (!GOOGLE_EVENTS.has(value.event_source)) fail('event_source');
    if (typeof value.validate_only !== 'boolean') fail('validate_only');
    if (value.consent !== null) {
      exactObject(value.consent, ['ad_user_data', 'ad_personalization'], 'consent');
      if (!CONSENT.has(value.consent.ad_user_data) || !CONSENT.has(value.consent.ad_personalization)) fail('consent value');
    }
  } else if (platform === 'reddit') {
    redditConfiguration(value);
  } else if (platform === 'tiktok') {
    tiktokConfiguration(value);
  } else if (platform === 'meta') {
    metaConfiguration(value);
  } else {
    digits(value.conversion_rule_id, 'conversion_rule_id');
    if (typeof value.api_version !== 'string' || !/^[2-9][0-9]{3}(?:0[1-9]|1[0-2])$/.test(value.api_version)) fail('api_version');
  }
  return value;
}

// Called only on calendar-valid strings from the accepted preparation module.
// Date.parse already includes milliseconds; add only the remaining nanoseconds.
function isoNs(value) {
  const fraction = /\.(\d{1,9})/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * MS_NS + BigInt(fraction.padEnd(9, '0')) % MS_NS;
}
function floorMs(ns) {
  const quotient = ns / MS_NS;
  return ns < 0n && ns % MS_NS !== 0n ? quotient - 1n : quotient;
}

// Compare decimal values, not binary floating-point expansions or tolerances.
// JSON's emitted number spelling must represent the exact input decimal value.
function decimalParts(text) {
  const [mantissa, exp = '0'] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let coefficient = BigInt(whole + fraction);
  let exponent = Number(exp) - fraction.length;
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  while (coefficient % 10n === 0n) { coefficient /= 10n; exponent += 1; }
  return { coefficient, exponent };
}
function sameDecimal(left, right) {
  const a = decimalParts(left); const b = decimalParts(right);
  return a.coefficient === b.coefficient && a.exponent === b.exponent;
}
function expandNumber(value) {
  const text = String(value);
  if (!text.includes('e')) return text;
  const [mantissa, exponent] = text.split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
function money(conversion, policy, platform) {
  const { value, currency, value_status } = conversion;
  if (value_status !== 'known') return policy === 'require_known'
    ? { omitted: false, reason: 'unknown_value' }
    : { omitted: true, reason: null };
  if (decimalParts(String(value)).coefficient < 0n) return { omitted: false, reason: 'negative_value_requires_adjustment' };
  if (platform === 'linkedin') return { omitted: false, reason: null, value: typeof value === 'string' ? value : expandNumber(value), currency };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !sameDecimal(String(value), JSON.stringify(numeric))) return { omitted: false, reason: 'value_precision_loss' };
  return { omitted: false, reason: null, value: numeric === 0 ? 0 : numeric, currency };
}
function common(input, platform) {
  plain(input);
  exactObject(input, ['preparation_input', 'identity', 'configuration'], 'payload input');
  const c = configuration(input.configuration, platform);
  exactObject(input.identity, ['email', 'phone'], 'identity');
  for (const kind of ['email', 'phone']) if (input.identity[kind] !== null && typeof input.identity[kind] !== 'string') fail('identity value');
  // Use the accepted contract, including optional browser_event_id and validated
  // extra data. Never replace the caller's platform to force compatibility.
  const preparation = prepareConversion(input.preparation_input);
  if (preparation.policy.platform !== platform) fail('preparation platform mismatch');
  const identities = {
    email: hashPlatformIdentity(platform, 'email', input.identity.email),
    phone: hashPlatformIdentity(platform, 'phone', input.identity.phone),
  };
  const value = money(preparation.conversion, c.money_policy, platform);
  const ns = isoNs(preparation.conversion.occurred_at);
  const precisionLoss = ['linkedin', 'reddit'].includes(platform) ? ns % MS_NS !== 0n : ['meta', 'tiktok'].includes(platform) && ns % SECOND_NS !== 0n;
  const diagnostics = {
    money_omitted: value.omitted,
    timestamp_precision_loss: precisionLoss,
    warnings: [
      ...(value.omitted ? ['provider_value_defaults_may_apply'] : []),
      ...(precisionLoss ? [['meta', 'tiktok'].includes(platform) ? 'timestamp_truncated_to_seconds' : 'timestamp_truncated_to_milliseconds'] : []),
    ],
  };
  const result = {
    status: 'ready', reasons: [...preparation.reasons], preparation,
    destination: { platform, account_key: c.account_id, destination_key: platform === 'google' ? c.conversion_action_id : c.conversion_rule_id, event_type: 'conversion' },
    request: null,
    authorization: { mechanism: 'oauth2_bearer', header: 'Authorization', scopes: platform === 'google' ? ['https://www.googleapis.com/auth/datamanager'] : ['rw_conversions', 'r_ads'] },
    diagnostics,
  };
  return { c, preparation, identities, value, ns, result };
}
function finish(result, body, url, headers) {
  result.status = result.reasons.length ? 'blocked' : 'ready';
  if (result.status === 'ready') result.request = { method: 'POST', url, headers, body, request_body: JSON.stringify(body) };
  return result;
}

export function buildGooglePayload(input) {
  const { c, preparation: p, identities, value, ns, result } = common(input, 'google');
  if (p.conversion.occurred_at.startsWith('0000-') || ns < GOOGLE_MIN_NS || ns > GOOGLE_MAX_NS) result.reasons.push('provider_timestamp_out_of_range');
  const userIdentifiers = [];
  if (identities.email) userIdentifiers.push({ emailAddress: identities.email });
  if (identities.phone) userIdentifiers.push({ phoneNumber: identities.phone });
  const adIdentifiers = {};
  for (const kind of GOOGLE_CLICKS) {
    const click = p.selected_clicks.find((row) => row.kind === kind);
    if (click) adIdentifiers[kind] = click.value;
  }
  if (!userIdentifiers.length && !Object.keys(adIdentifiers).length) result.reasons.push('no_match_keys');
  if (value.reason) result.reasons.push(value.reason);
  const account = (accountId) => ({ accountType: 'GOOGLE_ADS', accountId });
  const destination = { operatingAccount: account(c.account_id), productDestinationId: c.conversion_action_id, reference: 'ad_destination' };
  if (c.login_account_id !== null) destination.loginAccount = account(c.login_account_id);
  if (c.linked_account_id !== null) destination.linkedAccount = account(c.linked_account_id);
  const event = { destinationReferences: ['ad_destination'], transactionId: p.event_id, eventTimestamp: p.conversion.occurred_at, eventSource: c.event_source };
  if (userIdentifiers.length) event.userData = { userIdentifiers };
  if (Object.keys(adIdentifiers).length) event.adIdentifiers = adIdentifiers;
  if (c.consent !== null) event.consent = { adUserData: c.consent.ad_user_data, adPersonalization: c.consent.ad_personalization };
  if (!value.omitted && !value.reason) { event.conversionValue = value.value; event.currency = value.currency; }
  return finish(result, { destinations: [destination], events: [event], encoding: 'HEX', validateOnly: c.validate_only },
    'https://datamanager.googleapis.com/v1/events:ingest', { 'Content-Type': 'application/json' });
}

export function buildLinkedInPayload(input) {
  const { c, preparation: p, identities, value, ns, result } = common(input, 'linkedin');
  if (ns < isoNs(p.policy.as_of) - 90n * DAY_NS) result.reasons.push('provider_event_too_old');
  const userIds = [];
  if (identities.email) userIds.push({ idType: 'SHA256_EMAIL', idValue: identities.email });
  const click = p.selected_clicks.find((row) => row.kind === 'li_fat_id');
  if (click) userIds.push({ idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: click.value });
  if (!userIds.length) result.reasons.push('no_match_keys');
  if (value.reason) result.reasons.push(value.reason);
  const body = { conversion: `urn:lla:llaPartnerConversion:${c.conversion_rule_id}`, conversionHappenedAt: Number(floorMs(ns)), eventId: p.event_id, user: { userIds } };
  if (!value.omitted && !value.reason) body.conversionValue = { currencyCode: value.currency, amount: value.value };
  return finish(result, body, 'https://api.linkedin.com/rest/conversionEvents',
    { 'Content-Type': 'application/json', 'Linkedin-Version': c.api_version, 'X-Restli-Protocol-Version': '2.0.0' });
}


export function buildMetaPayload(input) {
  const { c, preparation: p, identities, value, ns, result } = common(input, 'meta');
  result.destination = { platform: 'meta', account_key: c.account_id, destination_key: c.pixel_id, event_type: c.event_name };
  result.authorization = { mechanism: 'graph_access_token', parameter: 'access_token', scopes: [] };
  const userData = {};
  if (identities.email) userData.em = [identities.email];
  if (identities.phone) userData.ph = [identities.phone];
  const click = p.selected_clicks.find((row) => row.kind === 'fbclid');
  if (click) {
    let fbc = null;
    try { fbc = buildMetaFbc({ fbclid: click.value, observed_at: click.occurred_at }); }
    catch (error) { if (!(error instanceof TypeError)) throw error; }
    if (fbc) userData.fbc = fbc;
    else result.diagnostics.warnings.push('fbc_unrepresentable');
  }
  if (!userData.em && !userData.ph && !userData.fbc) result.reasons.push('no_match_keys');
  if (value.reason) result.reasons.push(value.reason);
  if (c.client_user_agent !== null) userData.client_user_agent = c.client_user_agent;
  const seconds = ns / SECOND_NS - (ns < 0n && ns % SECOND_NS !== 0n ? 1n : 0n);
  const event = { event_name: c.event_name, event_time: Number(seconds), event_id: p.event_id, action_source: c.action_source, user_data: userData };
  if (c.event_source_url !== null) event.event_source_url = c.event_source_url;
  if (!value.omitted && !value.reason) event.custom_data = { value: value.value, currency: value.currency };
  if (c.data_processing !== null) {
    event.data_processing_options = [...c.data_processing.options];
    event.data_processing_options_country = c.data_processing.country;
    event.data_processing_options_state = c.data_processing.state;
  }
  if (c.opt_out !== null) event.opt_out = c.opt_out;
  if (c.advertiser_tracking_enabled !== null) event.advertiser_tracking_enabled = c.advertiser_tracking_enabled;
  const body = { data: [event] };
  if (c.test_event_code !== null) body.test_event_code = c.test_event_code;
  return finish(result, body, `https://graph.facebook.com/${c.api_version}/${c.pixel_id}/events`,
    { 'Content-Type': 'application/json', Accept: 'application/json' });
}


export function buildTikTokPayload(input) {
  const { c, preparation: p, identities, value, ns, result } = common(input, 'tiktok');
  result.destination = { platform: 'tiktok', account_key: c.account_id, destination_key: c.pixel_id, event_type: c.event_name };
  result.authorization = { mechanism: 'access_token', header: 'Access-Token', scopes: [] };
  const user = {};
  if (identities.email) user.email = identities.email;
  if (identities.phone) user.phone = identities.phone;
  const click = p.selected_clicks.find((row) => row.kind === 'ttclid');
  if (click) user.ttclid = click.value;
  if (!user.email && !user.phone && !user.ttclid) result.reasons.push('no_match_keys');
  if (value.reason) result.reasons.push(value.reason);
  if (c.client_user_agent !== null) user.user_agent = c.client_user_agent;
  const seconds = ns / SECOND_NS - (ns < 0n && ns % SECOND_NS !== 0n ? 1n : 0n);
  const event = { event: c.event_name, event_time: Number(seconds), event_id: p.event_id, user };
  if (c.page_url !== null) {
    event.page = { url: c.page_url };
    if (c.page_referrer !== null) event.page.referrer = c.page_referrer;
  }
  if (!value.omitted && !value.reason) event.properties = { value: value.value, currency: value.currency };
  if (c.limited_data_use !== null) event.limited_data_use = c.limited_data_use;
  const body = { event_source: 'web', event_source_id: c.pixel_id, data: [event] };
  if (c.test_event_code !== null) body.test_event_code = c.test_event_code;
  return finish(result, body, 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
    { 'Content-Type': 'application/json', Accept: 'application/json' });
}


export function buildRedditPayload(input) {
  const { c, preparation: p, identities, value, ns, result } = common(input, 'reddit');
  result.destination = { platform: 'reddit', account_key: c.account_id, destination_key: c.pixel_id, event_type: JSON.stringify([c.tracking_type, c.custom_event_name]) };
  result.authorization = { mechanism: 'conversion_access_token', header: 'Authorization', scheme: 'Bearer', scopes: [] };
  if (ns < isoNs(p.policy.as_of) - 7n * DAY_NS) result.reasons.push('provider_event_too_old');
  const click = p.selected_clicks.find((row) => row.kind === 'rdt_cid');
  const user = {};
  if (identities.email) user.email = identities.email;
  if (identities.phone) user.phone_number = identities.phone;
  if (!user.email && !user.phone_number && !click) result.reasons.push('no_match_keys');
  if (value.reason) result.reasons.push(value.reason);
  if (c.data_processing !== null) {
    user.data_processing_options = { modes: [...c.data_processing.modes], country: c.data_processing.country };
    if (c.data_processing.region !== null) user.data_processing_options.region = c.data_processing.region;
  }
  const type = { tracking_type: c.tracking_type };
  if (c.custom_event_name !== null) type.custom_event_name = c.custom_event_name;
  const event = { event_at: Number(floorMs(ns)), action_source: c.action_source, type };
  if (click) event.click_id = click.value;
  if (Object.keys(user).length) event.user = user;
  event.metadata = { conversion_id: p.event_id };
  if (!value.omitted && !value.reason) { event.metadata.value = value.value; event.metadata.currency = value.currency; }
  if (c.event_source_url !== null) {
    if (click) event.event_source_url = c.event_source_url;
    else result.diagnostics.warnings.push('event_source_url_omitted_without_selected_click');
  }
  const data = { events: [event] };
  if (c.test_id !== null) data.test_id = c.test_id;
  return finish(result, { data }, `https://ads-api.reddit.com/api/v3/pixels/${encodeURIComponent(c.pixel_id)}/conversion_events`,
    { 'Content-Type': 'application/json', Accept: 'application/json' });
}

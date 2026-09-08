/*
 * Shared channel classifier. Keep this module dependency-free: build-artifacts.mjs
 * copies the declarations into a BigQuery JavaScript UDF.
 */
const TAXONOMY_VERSION = '0.1.0';
const CHANNELS = [
  'Paid Search', 'Paid Social', 'Paid Other', 'Organic Search',
  'Organic Social', 'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other'
];

const SEARCH_SOURCES = new Set([
  'google', 'googleads', 'google ads', 'bing', 'bingads', 'microsoft', 'yahoo',
  'duckduckgo', 'baidu', 'yandex', 'ecosia', 'brave', 'ask'
]);
const SOCIAL_SOURCES = new Set([
  'facebook', 'facebook.com', 'instagram', 'instagram.com', 'linkedin',
  'linkedin.com', 'twitter', 'x', 'x.com', 'tiktok', 'tiktok.com', 'reddit',
  'reddit.com', 'pinterest', 'pinterest.com', 'snapchat', 'youtube', 'youtube.com', 'meta', 'ig'
]);
const PAID_SOCIAL_NETWORKS = new Set([
  'facebook_ads', 'linkedin_ads', 'reddit_ads', 'reddit', 'pinterest_ads',
  'paid_social', 'tiktok_ads', 'tiktok'
]);
const PAID_SEARCH_NETWORKS = new Set(['google_ads', 'google_ads_pmax', 'bingads', 'paid_search']);
const PAID_OTHER_NETWORKS = new Set(['criteo', 'stackadapt', 'stackadapt_ads']);
const AFFILIATE_SOURCES = new Set(['cj', 'rakuten', 'impact', 'shareasale', 'awin', 'partnerize']);
const EMAIL_SOURCES = new Set(['mailchimp', 'klaviyo', 'hubspot', 'customer.io', 'iterable', 'sendgrid', 'braze', 'newsletter', 'email', 'e-mail']);
const SMS_SOURCES = new Set(['attentive', 'postscript', 'klaviyo_sms', 'sms']);
const SEARCH_HOSTS = new Set(['google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'yandex.com', 'yandex.ru', 'ecosia.org', 'search.brave.com', 'ask.com', 'aol.com']);
const SOCIAL_HOSTS = new Set(['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'reddit.com', 'pinterest.com', 'snapchat.com', 'youtube.com', 't.co']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function lower(value) { return text(decode(value)).toLowerCase(); }

function decode(value) {
  let result = text(value);
  for (let pass = 0; pass < 5; pass += 1) {
    let decoded;
    try { decoded = decodeURIComponent(result); } catch (error) { break; }
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}

function validClickId(value) {
  const candidate = text(decode(value));
  if (!candidate || /^(?:null|undefined|\[object object\])$/i.test(candidate)) return '';
  return candidate;
}

function clickValue(clickIds, name) {
  if (!clickIds || typeof clickIds !== 'object') return '';
  if (Array.isArray(clickIds)) {
    for (let i = 0; i < clickIds.length; i += 1) {
      if (clickIds[i] && lower(clickIds[i].name) === name) {
        const candidate = validClickId(clickIds[i].value);
        if (candidate) return candidate;
      }
    }
    return '';
  }
  return validClickId(clickIds[name]);
}

function queryParams(url) {
  const result = {};
  const raw = text(url).split('#')[0];
  if (!raw) return result;
  const queryStart = raw.indexOf('?');
  if (queryStart < 0) return result;
  let query = raw.slice(queryStart + 1);
  const hashStart = query.indexOf('#');
  if (hashStart >= 0) query = query.slice(0, hashStart);
  query.split('&').forEach((part) => {
    if (!part) return;
    const equals = part.indexOf('=');
    const rawKey = equals < 0 ? part : part.slice(0, equals);
    const rawValue = equals < 0 ? '' : part.slice(equals + 1);
    const key = lower(rawKey.replace(/\+/g, ' '));
    if (key && result[key] === undefined) result[key] = rawValue.replace(/\+/g, ' ');
  });
  return result;
}

function hostOf(value) {
  const raw = text(value);
  if (!raw || /\s|[\\<>]/.test(raw)) return '';
  const match = raw.match(/^(?:https?:)?\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match) return '';
  const authority = match[1].slice(match[1].lastIndexOf('@') + 1).toLowerCase();
  const parts = authority.match(/^([^:]+)(?::([0-9]+))?$/);
  if (!parts || (parts[2] && Number(parts[2]) > 65535)) return '';
  const host = parts[1].replace(/\.$/, '');
  if (host.length > 253 || !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
  return host;
}

function hostMatches(host, base) { return host === base || host.endsWith(`.${base}`); }

function sameHost(a, b) {
  const left = hostOf(a); const right = hostOf(b);
  return Boolean(left && right && (hostMatches(left, right) || hostMatches(right, left)));
}

function sourceHostHint(source) {
  // Inputs to this helper are already normalized; do not decode a second time.
  const value = text(source);
  const host = hostOf(value) || (/^[a-z0-9.-]+$/.test(value) ? hostOf(`https://${value}`) : '');
  const googleHosts = ['google.com', 'google.co.uk', 'google.ca', 'google.com.au', 'google.au', 'google.de', 'google.fr', 'google.es', 'google.it', 'google.nl', 'google.ie', 'google.co.nz', 'google.nz', 'google.co.in', 'google.in', 'google.sg', 'google.com.sg', 'google.co.jp'];
  if (SEARCH_SOURCES.has(value) || [...SEARCH_HOSTS, ...googleHosts].some((base) => hostMatches(host, base))) return 'Paid Search';
  if (SOCIAL_SOURCES.has(value) || [...SOCIAL_HOSTS].some((base) => hostMatches(host, base))) return 'Paid Social';
  return '';
}

function normalizeChannelLabel(value) {
  const label = lower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!label || label === '(not set)' || label === 'not set' || label === 'unassigned' || label === 'unknown' || label === 'mobile push') return 'Other';
  if (label === 'affiliates' || label === 'affiliate') return 'Affiliate';
  if (label === 'display' || label === 'paid shopping' || label === 'cross network' || label === 'cross-network' || label === 'paid video' || label === 'paid audio' || label === 'audio') return 'Paid Other';
  if (label === 'organic video') return 'Organic Social';
  if (label === 'organic shopping') return 'Organic Search';
  if (label === 'ai assistant') return 'Referral';
  const direct = { 'paid search': 'Paid Search', 'paid social': 'Paid Social', 'paid other': 'Paid Other', 'organic search': 'Organic Search', 'organic social': 'Organic Social', email: 'Email', sms: 'SMS', direct: 'Direct', referral: 'Referral', other: 'Other' };
  return direct[label] || 'Other';
}

function classify(input) {
  const value = input && typeof input === 'object' ? input : {};
  const landing = text(value.landing_url);
  const landingValid = Boolean(hostOf(landing));
  const landingParams = landingValid ? queryParams(landing) : {};
  const source = lower(text(value.utm_source) ? value.utm_source : landingParams.utm_source);
  const medium = lower(text(value.utm_medium) ? value.utm_medium : landingParams.utm_medium);
  const mediumKey = medium.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const native = normalizeChannelLabel(value.native_channel);
  const clicks = value.click_ids;
  const ids = {
    dclid: clickValue(clicks, 'dclid') || validClickId(landingParams.dclid),
    gclid: clickValue(clicks, 'gclid') || validClickId(landingParams.gclid),
    gbraid: clickValue(clicks, 'gbraid') || validClickId(landingParams.gbraid),
    wbraid: clickValue(clicks, 'wbraid') || validClickId(landingParams.wbraid),
    msclkid: clickValue(clicks, 'msclkid') || validClickId(landingParams.msclkid),
    fbclid: clickValue(clicks, 'fbclid') || validClickId(landingParams.fbclid),
    ttclid: clickValue(clicks, 'ttclid') || validClickId(landingParams.ttclid),
    rdt_cid: clickValue(clicks, 'rdt_cid') || validClickId(landingParams.rdt_cid),
    li_fat_id: clickValue(clicks, 'li_fat_id') || validClickId(landingParams.li_fat_id),
    twclid: clickValue(clicks, 'twclid') || validClickId(landingParams.twclid),
    epik: clickValue(clicks, 'epik') || validClickId(landingParams.epik),
    sccid: clickValue(clicks, 'sccid') || validClickId(landingParams.sccid)
  };
  // srsltid is intentionally retained only as raw input; it never establishes paid traffic.
  const has = (name) => Boolean(ids[name]);
  if (has('dclid')) return { channel: 'Paid Other', rule_id: 'click_id_dclid', taxonomy_version: TAXONOMY_VERSION };
  if (has('gclid') || has('gbraid') || has('wbraid') || has('msclkid')) return { channel: 'Paid Search', rule_id: 'click_id_search', taxonomy_version: TAXONOMY_VERSION };
  if (has('fbclid') || has('ttclid') || has('rdt_cid') || has('li_fat_id') || has('twclid') || has('epik') || has('sccid')) return { channel: 'Paid Social', rule_id: 'click_id_social', taxonomy_version: TAXONOMY_VERSION };

  const network = lower(value.network_id);
  if (PAID_SEARCH_NETWORKS.has(network)) return { channel: 'Paid Search', rule_id: 'network_paid_search', taxonomy_version: TAXONOMY_VERSION };
  if (PAID_SOCIAL_NETWORKS.has(network) || network.indexOf('tiktok_') === 0) return { channel: 'Paid Social', rule_id: 'network_paid_social', taxonomy_version: TAXONOMY_VERSION };
  if (PAID_OTHER_NETWORKS.has(network)) return { channel: 'Paid Other', rule_id: 'network_paid_other', taxonomy_version: TAXONOMY_VERSION };
  if (network === 'affiliate' || AFFILIATE_SOURCES.has(network)) return { channel: 'Affiliate', rule_id: 'network_affiliate', taxonomy_version: TAXONOMY_VERSION };

  // Explicit paid categories win over a conflicting platform source.
  if (mediumKey === 'paid search') return { channel: 'Paid Search', rule_id: 'paid_medium_search', taxonomy_version: TAXONOMY_VERSION };
  if (mediumKey === 'paid social') return { channel: 'Paid Social', rule_id: 'paid_medium_social', taxonomy_version: TAXONOMY_VERSION };
  if (/^(display|banner|cpm|native|video|audio|paid other|paid video|paid audio|paidvideo)$/.test(mediumKey)) return { channel: 'Paid Other', rule_id: 'paid_medium_other', taxonomy_version: TAXONOMY_VERSION };
  if (/^(paid(?: .+)?|cpc|cpa|cpv|cpe|cpp|ppc|sem|retargeting|remarketing)$/.test(mediumKey)) {
    const hint = sourceHostHint(source);
    return { channel: hint || 'Paid Other', rule_id: hint === 'Paid Search' ? 'paid_medium_search' : hint === 'Paid Social' ? 'paid_medium_social' : 'paid_medium_other', taxonomy_version: TAXONOMY_VERSION };
  }

  if (native !== 'Direct' && native !== 'Other') return { channel: native, rule_id: 'native_channel', taxonomy_version: TAXONOMY_VERSION };
  if (/^(email|e-mail|newsletter)$/i.test(medium)) return { channel: 'Email', rule_id: 'medium_email', taxonomy_version: TAXONOMY_VERSION };
  if (/^(sms|text|text_message)$/i.test(medium)) return { channel: 'SMS', rule_id: 'medium_sms', taxonomy_version: TAXONOMY_VERSION };
  if (/^(affiliate|affiliates)$/i.test(medium)) return { channel: 'Affiliate', rule_id: 'medium_affiliate', taxonomy_version: TAXONOMY_VERSION };
  if (/^(organic|seo)$/i.test(medium) && (sourceHostHint(source) === 'Paid Search' || SEARCH_SOURCES.has(source))) return { channel: 'Organic Search', rule_id: 'medium_organic_search', taxonomy_version: TAXONOMY_VERSION };
  if (/^(social|social-network|social_media|organic_social)$/i.test(medium) || (medium === 'organic' && (sourceHostHint(source) === 'Paid Social' || SOCIAL_SOURCES.has(source)))) return { channel: 'Organic Social', rule_id: 'medium_organic_social', taxonomy_version: TAXONOMY_VERSION };
  if (/^(organic|seo)$/i.test(medium)) return { channel: 'Organic Search', rule_id: 'medium_organic_search', taxonomy_version: TAXONOMY_VERSION };
  if (/^(referral|refer)$/i.test(medium)) return { channel: 'Referral', rule_id: 'medium_referral', taxonomy_version: TAXONOMY_VERSION };

  const shopifyType = lower(value.shopify_source_type);
  const shopifySource = lower(value.shopify_source);
  if (shopifyType === 'email') return { channel: 'Email', rule_id: 'shopify_email', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'sms') return { channel: 'SMS', rule_id: 'shopify_sms', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'affiliate') return { channel: 'Affiliate', rule_id: 'shopify_affiliate', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'search') return { channel: 'Organic Search', rule_id: 'shopify_search', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'social') return { channel: 'Organic Social', rule_id: 'shopify_social', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'ad' || shopifyType === 'retargeting') {
    const platformHint = sourceHostHint(shopifySource);
    if (platformHint === 'Paid Search') return { channel: 'Paid Search', rule_id: 'shopify_paid_search_platform', taxonomy_version: TAXONOMY_VERSION };
    if (platformHint === 'Paid Social') return { channel: 'Paid Social', rule_id: 'shopify_paid_social_platform', taxonomy_version: TAXONOMY_VERSION };
    return { channel: 'Paid Other', rule_id: 'shopify_paid_without_platform', taxonomy_version: TAXONOMY_VERSION };
  }
  if (shopifyType === 'seo' || shopifyType === 'organic') return { channel: 'Organic Search', rule_id: 'shopify_organic_search', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'post') return { channel: 'Organic Social', rule_id: 'shopify_social', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'newsletter') return { channel: 'Email', rule_id: 'shopify_email', taxonomy_version: TAXONOMY_VERSION };
  if (shopifyType === 'referral') return { channel: 'Referral', rule_id: 'shopify_referral', taxonomy_version: TAXONOMY_VERSION };
  // Unknown Shopify types are nonterminal; source and referrer evidence still apply.
  for (const hintSource of [source, shopifySource]) {
    if (EMAIL_SOURCES.has(hintSource)) return { channel: 'Email', rule_id: 'source_email', taxonomy_version: TAXONOMY_VERSION };
    if (SMS_SOURCES.has(hintSource)) return { channel: 'SMS', rule_id: 'source_sms', taxonomy_version: TAXONOMY_VERSION };
    if (AFFILIATE_SOURCES.has(hintSource)) return { channel: 'Affiliate', rule_id: 'source_affiliate', taxonomy_version: TAXONOMY_VERSION };
    if (sourceHostHint(hintSource) === 'Paid Search') return { channel: 'Organic Search', rule_id: 'source_search_hint', taxonomy_version: TAXONOMY_VERSION };
    if (sourceHostHint(hintSource) === 'Paid Social') return { channel: 'Organic Social', rule_id: 'source_social_hint', taxonomy_version: TAXONOMY_VERSION };
  }

  const referrer = text(value.referrer);
  if (referrer && hostOf(referrer) && (!landingValid || !sameHost(referrer, landing))) {
    const referrerHost = hostOf(referrer);
    const referrerHint = sourceHostHint(referrerHost);
    if (referrerHint === 'Paid Search') return { channel: 'Organic Search', rule_id: 'referrer_search', taxonomy_version: TAXONOMY_VERSION };
    if (referrerHint === 'Paid Social') return { channel: 'Organic Social', rule_id: 'referrer_social', taxonomy_version: TAXONOMY_VERSION };
    return { channel: 'Referral', rule_id: 'external_referrer', taxonomy_version: TAXONOMY_VERSION };
  }
  if (native === 'Direct' || shopifyType === 'direct' || (source === '(direct)' && (medium === '(none)' || medium === '(not set)'))) return { channel: 'Direct', rule_id: 'explicit_direct', taxonomy_version: TAXONOMY_VERSION };
  const unknownSignal = network || shopifyType || shopifySource || lower(value.native_channel) || lower(value.utm_campaign) || lower(landingParams.utm_campaign);
  if (landingValid && !source && !medium && !unknownSignal && (!referrer || (hostOf(referrer) && sameHost(referrer, landing)))) return { channel: 'Direct', rule_id: 'inferred_direct', taxonomy_version: TAXONOMY_VERSION };
  return { channel: 'Other', rule_id: 'fallback_other', taxonomy_version: TAXONOMY_VERSION };
}

function classifyChannel(input) { return classify(input).channel; }

export { CHANNELS, TAXONOMY_VERSION, classifyChannel, classify, normalizeChannelLabel };

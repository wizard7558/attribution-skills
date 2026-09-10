#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildGooglePayload, buildLinkedInPayload, buildMetaPayload, buildTikTokPayload, buildRedditPayload } from './provider-payloads.mjs';
import { prepareConversion } from './conversion-events.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'references/payload-fixtures.json'), 'utf8'));
const build = { google: buildGooglePayload, linkedin: buildLinkedInPayload, meta: buildMetaPayload, tiktok: buildTikTokPayload, reddit: buildRedditPayload };
const clone = structuredClone;
let assertions = 0;
const groups = [];
function equal(a, b) { assertions += 1; assert.deepStrictEqual(a, b); }
function ok(value) { assertions += 1; assert.ok(value); }
function invalid(fn) { assertions += 1; assert.throws(fn, TypeError); }
function group(name, fn) { const before = assertions; fn(); groups.push({ name, assertions: assertions - before }); }
function input(platform = 'google') { return clone(fixture.cases.find((f) => f.platform === platform).input); }
function noClicks(i) { i.preparation_input.click_observations = []; return i; }
function setTime(i, timestamp, asOf = timestamp) {
  i.preparation_input.conversion.occurred_at = timestamp;
  i.preparation_input.policy.as_of = asOf;
  i.preparation_input.click_observations = [];
  return i;
}
function amount(result, platform) { return platform === 'google' ? result.request.body.events[0].conversionValue : result.request.body.conversionValue.amount; }
function blocked(result, reasons) {
  equal(result.status, 'blocked'); equal(result.reasons, reasons); equal(result.request, null);
  equal(Object.keys(result), ['status', 'reasons', 'preparation', 'destination', 'request', 'authorization', 'diagnostics']);
}

group('26 independent complete result and wire goldens', () => {
  for (const f of fixture.cases) {
    const original = clone(f.input);
    const actual = build[f.platform](f.input);
    equal(actual, f.expected);
    equal(f.input, original);
    equal(actual.preparation, prepareConversion(f.input.preparation_input));
    if (actual.request) equal(JSON.parse(actual.request.request_body), actual.request.body);
  }
});

group('signal allowlists, exact scopes and stable destination identity', () => {
  for (const platform of ['google', 'linkedin']) {
    const i = input(platform);
    const original = build[platform](i);
    i.preparation_input.conversion.extra_name = 'SYNTHETIC_PRIVATE_NAME';
    i.preparation_input.conversion.email = 'SYNTHETIC_PRIVATE_EMAIL';
    i.preparation_input.conversion.ip = 'SYNTHETIC_PRIVATE_IP';
    i.preparation_input.extra = { note: 'SYNTHETIC_PRIVATE_NOTE' };
    equal(build[platform](i), original);
    i.preparation_input.browser_event_id = undefined;
    const absent = build[platform](i);
    equal(absent.preparation.event_id, '7af015a5c42c87622cd4136ba432ca4c81268bbc1c889ade4722558d528e391b');
    delete i.preparation_input.browser_event_id;
    equal(build[platform](i), absent);
    i.preparation_input.browser_event_id = null;
    equal(build[platform](i), absent);
    i.preparation_input.browser_event_id = 'Browser+%252F.Id';
    equal(build[platform](i).preparation.event_id, 'Browser+%252F.Id');
    equal(build[platform](i).preparation.business_conversion_id, absent.preparation.business_conversion_id);
    i.configuration.account_id = '0007';
    i.configuration[platform === 'google' ? 'conversion_action_id' : 'conversion_rule_id'] = '0008';
    const rerouted = build[platform](i);
    equal(rerouted.destination, { platform, account_key: '0007', destination_key: '0008', event_type: 'conversion' });
    equal(rerouted.preparation, build[platform]({ ...i, configuration: originalConfiguration(platform) }).preparation);
    i.identity = { email: null, phone: null };
    const row = i.preparation_input.click_observations[0];
    i.preparation_input.click_observations = [row];
    row.conversion_key = 'unrelated';
    blocked(build[platform](i), ['no_match_keys']);
    row.conversion_key = 'conversion-1'; row.source_scope = 'unbound';
    blocked(build[platform](i), ['no_match_keys']);
    row.source_scope = 'ads-scope'; row.kind = platform === 'google' ? 'li_fat_id' : 'gclid';
    blocked(build[platform](i), ['no_match_keys']);
    equal(build[platform](i).preparation.click_diagnostics.excluded[0].reason, 'unsupported_platform_kind');
    i.preparation_input.platform = platform === 'google' ? 'linkedin' : 'google';
    invalid(() => build[platform](i));
  }
  for (const kind of ['gclid', 'gbraid', 'wbraid']) {
    const i = input(); i.identity = { email: null, phone: null };
    i.preparation_input.click_observations = i.preparation_input.click_observations.filter((r) => r.kind === kind);
    equal(buildGooglePayload(i).request.body.events[0].adIdentifiers, { [kind]: kind + '+Opaque%252F' });
  }
});
function originalConfiguration(platform) { return input(platform).configuration; }

group('raw identity normalization exactly once and no identity passthrough', () => {
  for (const platform of ['google', 'linkedin']) {
    const i = noClicks(input(platform));
    i.identity = { email: 'not-an-email', phone: 'invalid-phone' };
    blocked(build[platform](i), ['no_match_keys']);
    i.identity.email = 'd15efbf82e75e1cfe93b15abc4aa7cca95ce14a27d2fd6b3e81428de42f2e9dd';
    blocked(build[platform](i), ['no_match_keys']);
    i.identity = { email: null, phone: '+14155552671' };
    if (platform === 'linkedin') blocked(build[platform](i), ['no_match_keys']);
    else equal(build[platform](i).request.body.events[0].userData.userIdentifiers, [{ phoneNumber: 'cb6880e416769253645cb9c6b8989154bf66a56a77fc14c81fb1019663cbb928' }]);
    const valid = input(platform); const output = JSON.stringify(build[platform](valid));
    ok(!output.includes(valid.identity.email)); ok(!output.includes(valid.identity.phone));
    ok(!output.includes('test.user+tag@gmail.com')); ok(!output.includes('+14155552671'));
    ok(!output.includes('Authorization":"Bearer'));
  }
});

group('known, unknown, negative and precision-sensitive money', () => {
  for (const platform of ['google', 'linkedin']) {
    for (const value of [0, -0, '0', '-0', '-0.00', '123.45', '123.4500', 123.45, 1e-7, 5e-324]) {
      const i = input(platform); i.preparation_input.conversion.value = value;
      const r = build[platform](i); equal(r.status, 'ready');
      let expected = platform === 'google' ? Number(value) : typeof value === 'string' ? value : String(value);
      if (platform === 'google' && expected === 0) expected = 0;
      if (platform === 'linkedin' && value === 1e-7) expected = '0.0000001';
      if (platform === 'linkedin' && value === 5e-324) expected = '0.' + '0'.repeat(323) + '5';
      equal(amount(r, platform), expected);
    }
    for (const value of ['99999999999999999999999999999', '9007199254740993', '12345678901234567890.123456789']) {
      const i = input(platform); i.preparation_input.conversion.value = value;
      if (platform === 'google') blocked(build[platform](i), ['value_precision_loss']);
      else equal(amount(build[platform](i), platform), value);
    }
    for (const value of ['-0.000000001', -1, '-123.4500']) {
      const i = input(platform); i.preparation_input.conversion.value = value;
      blocked(build[platform](i), ['negative_value_requires_adjustment']);
    }
    for (const value_status of ['unknown', 'mixed_currency']) {
      const i = input(platform); Object.assign(i.preparation_input.conversion, { value: null, currency: value_status === 'unknown' ? 'USD' : null, value_status });
      blocked(build[platform](i), ['unknown_value']);
      i.configuration.money_policy = 'omit_unknown';
      const r = build[platform](i); equal(r.status, 'ready'); equal(r.diagnostics.money_omitted, true);
      const target = platform === 'google' ? r.request.body.events[0] : r.request.body;
      ok(!Object.hasOwn(target, 'conversionValue')); ok(!Object.hasOwn(target, 'currency'));
      ok(r.diagnostics.warnings.includes('provider_value_defaults_may_apply'));
      i.identity = { email: null, phone: null }; noClicks(i);
      const b = build[platform](i); blocked(b, ['no_match_keys']); equal(b.diagnostics.money_omitted, true);
    }
    for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '01', '1e2', '0.1234567890']) {
      const i = input(platform); i.preparation_input.conversion.value = value;
      invalid(() => build[platform](i));
    }
  }
  const i = input(); i.preparation_input.conversion.value = '10000000000000000000000000000';
  equal(amount(buildGooglePayload(i), 'google'), 1e28);
});

group('exact timestamps, inclusive age and representation boundaries', () => {
  const exact = setTime(input('linkedin'), '2026-06-10T12:34:56.123456789Z', '2026-09-08T12:34:56.123456789Z');
  equal(buildLinkedInPayload(exact).status, 'ready');
  equal(buildLinkedInPayload(exact).request.body.conversionHappenedAt, 1781094896123);
  exact.preparation_input.conversion.occurred_at = '2026-06-10T12:34:56.123456788Z';
  blocked(buildLinkedInPayload(exact), ['provider_event_too_old']);
  exact.preparation_input.conversion.occurred_at = '2026-06-10T12:34:56.123456790Z';
  equal(buildLinkedInPayload(exact).status, 'ready');
  const future = setTime(input('linkedin'), '2026-09-08T12:34:56.123456790Z', '2026-09-08T12:34:56.123456789Z');
  blocked(buildLinkedInPayload(future), ['future_event']);
  for (const [time, ms, loss] of [
    ['2026-09-08T12:34:56.123456789Z', 1788870896123, true],
    ['2026-09-08T05:34:56.123456789-07:00', 1788870896123, true],
    ['2026-09-08T12:34:56.123000000Z', 1788870896123, false],
    ['1969-12-31T23:59:59.999999999Z', -1, true],
    ['1969-12-31T23:59:59.123456789Z', -877, true],
    ['1970-01-01T00:00:00.000000001Z', 0, true],
  ]) {
    const i = setTime(input('linkedin'), time); const r = buildLinkedInPayload(i);
    equal(r.request.body.conversionHappenedAt, ms); equal(r.diagnostics.timestamp_precision_loss, loss);
    equal(r.preparation.conversion.occurred_at, time);
  }
  for (const time of ['0000-12-31T23:59:59Z', '0000-12-31T23:59:59-01:00', '0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59.999999999-00:01']) {
    blocked(buildGooglePayload(setTime(input(), time)), ['provider_timestamp_out_of_range']);
  }
  for (const time of ['0001-01-01T00:00:00Z', '0001-01-01T01:00:00+01:00', '9999-12-31T23:59:59.999999999Z']) {
    equal(buildGooglePayload(setTime(input(), time)).request.body.events[0].eventTimestamp, time);
  }
  const googleOld = setTime(input(), '2026-06-10T12:00:00Z', '2026-09-08T12:00:00Z');
  equal(buildGooglePayload(googleOld).status, 'ready'); // No imported GA4 48/72-hour limit.
  googleOld.preparation_input.policy.max_event_age_days = 1;
  blocked(buildGooglePayload(googleOld), ['event_too_old']);
});

group('explicit validated configuration and no implicit consent', () => {
  for (const event_source of ['WEB', 'APP', 'IN_STORE', 'PHONE', 'MESSAGE', 'OTHER']) {
    const i = input(); i.configuration.event_source = event_source;
    equal(buildGooglePayload(i).request.body.events[0].eventSource, event_source);
  }
  for (const consent of [null, ...['CONSENT_GRANTED', 'CONSENT_DENIED', 'CONSENT_STATUS_UNSPECIFIED'].map((v) => ({ ad_user_data: v, ad_personalization: v }))]) {
    const i = input(); i.configuration.consent = consent; i.configuration.validate_only = false;
    const r = buildGooglePayload(i); equal(r.request.body.validateOnly, false);
    equal(r.request.body.events[0].consent, consent === null ? undefined : { adUserData: consent.ad_user_data, adPersonalization: consent.ad_personalization });
  }
  for (const platform of ['google', 'linkedin']) {
    for (const field of Object.keys(input(platform).configuration)) {
      const i = input(platform); delete i.configuration[field]; invalid(() => build[platform](i));
    }
    for (const credential of ['access_token', 'Authorization', 'headers', 'credentials', 'password', 'api_key']) {
      const i = input(platform); i.configuration[credential] = 'SYNTHETIC_SECRET_SENTINEL';
      invalid(() => build[platform](i));
      try { build[platform](i); } catch (e) { ok(!String(e).includes('SYNTHETIC_SECRET_SENTINEL')); }
    }
    for (const id of ['', ' 123', '123-456', 123, null, 'x']) {
      const i = input(platform); i.configuration.account_id = id; invalid(() => build[platform](i));
    }
    const old = setTime(input(platform), '2026-01-01T00:00:00Z', '2026-09-08T00:00:00Z');
    old.configuration.money_policy = 'unknown'; invalid(() => build[platform](old));
  }
  for (const api_version of ['199912', '000001', '202600', '202613', '20261', '202608 ', 202608]) {
    const i = input('linkedin'); i.configuration.api_version = api_version; invalid(() => buildLinkedInPayload(i));
  }
  for (const api_version of ['200001', '999912']) {
    const i = input('linkedin'); i.configuration.api_version = api_version;
    equal(buildLinkedInPayload(i).request.headers['Linkedin-Version'], api_version);
  }
  for (const change of [
    (c) => { c.event_source = 'EVENT_SOURCE_UNSPECIFIED'; },
    (c) => { c.validate_only = null; },
    (c) => { c.login_account_id = undefined; },
    (c) => { c.linked_account_id = '1-2'; },
    (c) => { c.consent.ad_user_data = 'GRANTED'; },
    (c) => { c.consent.extra = true; },
  ]) { const i = input(); change(i.configuration); invalid(() => buildGooglePayload(i)); }
});

group('strict plain data, excluded rows and no accessor execution', () => {
  for (const platform of ['google', 'linkedin']) {
    for (const extra of [new Date(), new Map(), new Set(), /x/, 1n, () => {}, Symbol('private'), NaN, Infinity, new (class Example {})()]) {
      const i = input(platform); i.preparation_input.conversion.extra = extra; invalid(() => build[platform](i));
    }
    const cyclic = input(platform); cyclic.preparation_input.extra = cyclic; invalid(() => build[platform](cyclic));
    for (const location of ['top', 'row', 'identity', 'configuration', 'array']) {
      const i = input(platform); let calls = 0;
      const target = location === 'top' ? i : location === 'row' ? i.preparation_input.click_observations[0] : location === 'array' ? i.preparation_input.click_observations : i[location];
      Object.defineProperty(target, location === 'array' ? '0' : 'secret', { enumerable: true, get() { calls += 1; return 'SYNTHETIC_PRIVATE_GETTER'; } });
      invalid(() => build[platform](i)); equal(calls, 0);
    }
    for (const extra of [Symbol('property'), 'secret']) {
      const i = input(platform); Object.defineProperty(i.identity, extra, { value: 'SYNTHETIC_PRIVATE', enumerable: false });
      invalid(() => build[platform](i));
    }
    for (const rows of [new Array(2), Object.assign([], { extra: true }), Object.assign([1], { '01': 2 })]) {
      const i = input(platform); i.preparation_input.click_observations = rows; invalid(() => build[platform](i));
    }
    const unused = input(platform); unused.preparation_input.click_observations[0].conversion_key = 'unrelated';
    unused.preparation_input.click_observations[0].occurred_at = 'invalid-date';
    invalid(() => build[platform](unused));
    const hidden = input(platform); hidden.preparation_input.click_observations[0].conversion_key = 'unrelated';
    hidden.preparation_input.click_observations[0].extra = { secret: new Date() };
    invalid(() => build[platform](hidden));
    const wrong = input(platform); wrong.identity.email = 123; invalid(() => build[platform](wrong));
    const nullProto = input(platform); nullProto.identity = Object.assign(Object.create(null), nullProto.identity);
    equal(build[platform](nullProto), build[platform](input(platform)));
  }
});

function reversed(value) {
  if (Array.isArray(value)) return value.map(reversed);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
  return value;
}
group('deterministic bytes under input key and click permutations', () => {
  for (const f of fixture.cases) {
    equal(build[f.platform](reversed(f.input)), f.expected);
    const i = clone(f.input); i.preparation_input.click_observations.reverse();
    equal(build[f.platform](i).request, f.expected.request);
  }
});

group('Meta supported contexts, scoped selected capture and browser parity', () => {
  const original = input('meta');
  equal(buildMetaPayload(original).preparation, prepareConversion(original.preparation_input));
  for (const action_source of ['physical_store','app','chat','email','other','phone_call','system_generated','website']) {
    const i=input('meta');i.configuration.action_source=action_source;
    if (action_source!=='website') {i.configuration.event_source_url=null;i.configuration.client_user_agent=null;}
    equal(buildMetaPayload(i).request.body.data[0].action_source,action_source);
  }
  for (const options of [[],['LDU']]) {
    const i=input('meta');i.configuration.data_processing={options,country:0,state:0};
    const e=buildMetaPayload(i).request.body.data[0];equal(e.data_processing_options,options);equal(e.data_processing_options_country,0);equal(e.data_processing_options_state,0);equal(e.opt_out,false);equal(e.advertiser_tracking_enabled,false);
  }
  const i=input('meta');i.identity={email:null,phone:null};
  const click=i.preparation_input.click_observations[0];
  i.preparation_input.click_observations.push({...click,click_key:'older',occurred_at:'2026-09-08T11:00:00Z',value:'Older'}, {...click,click_key:'unbound',source_scope:'wrong',occurred_at:'2026-09-08T12:30:00Z',value:'Unbound'}, {...click,click_key:'future',occurred_at:'2026-09-08T13:30:00Z',value:'Future'}, {...click,click_key:'unrelated',conversion_key:'other',value:'Unrelated'});
  equal(buildMetaPayload(i).request.body.data[0].user_data.fbc,'fb.1.1788868800000.fbclid+Opaque%252F');
  i.preparation_input.click_observations.reverse();equal(buildMetaPayload(i).request.body.data[0].user_data.fbc,'fb.1.1788868800000.fbclid+Opaque%252F');
  i.preparation_input.browser_event_id='Browser+%252F.Id';equal(buildMetaPayload(i).request.body.data[0].event_id,'Browser+%252F.Id');
  delete i.preparation_input.browser_event_id;equal(buildMetaPayload(i).request.body.data[0].event_id,'7af015a5c42c87622cd4136ba432ca4c81268bbc1c889ade4722558d528e391b');
  i.preparation_input.platform='google';invalid(()=>buildMetaPayload(i));
  const unrepresentable=clone(fixture.cases.find(f=>f.id==='meta-pre-epoch-fbc-unrepresentable').input);unrepresentable.identity={email:null,phone:null};blocked(buildMetaPayload(unrepresentable),['no_match_keys']);ok(buildMetaPayload(unrepresentable).diagnostics.warnings.includes('fbc_unrepresentable'));
  const malformed=input('meta');malformed.preparation_input.click_observations[0].value='opaque..segments';const omitted=buildMetaPayload(malformed);ok(omitted.diagnostics.warnings.includes('fbc_unrepresentable'));ok(!Object.hasOwn(omitted.request.body.data[0].user_data,'fbc'));
  const noSignal=noClicks(input('meta'));noSignal.identity={email:null,phone:null};blocked(buildMetaPayload(noSignal),['no_match_keys']);
  const hashed=noClicks(input('meta'));hashed.identity={email:'d15efbf82e75e1cfe93b15abc4aa7cca95ce14a27d2fd6b3e81428de42f2e9dd',phone:null};blocked(buildMetaPayload(hashed),['no_match_keys']);
  const output=JSON.stringify(buildMetaPayload(original));ok(!output.includes(original.identity.email));ok(!output.includes(original.identity.phone));ok(!output.includes('test.user+tag@gmail.com'));ok(!output.includes('fbp'));ok(!output.includes('client_ip_address'));
});
group('Meta seconds floor, money exactness and deterministic warning order', () => {
  for (const [time,seconds,loss] of [
    ['2026-09-08T12:34:56.123456789Z',1788870896,true],['2026-09-08T05:34:56.123456789-07:00',1788870896,true],
    ['1969-12-31T23:59:59.999999999Z',-1,true],['1969-12-31T23:59:58.123456789Z',-2,true],
    ['1970-01-01T00:00:00.000000001Z',0,true],['1969-12-31T23:59:59Z',-1,false],['2026-09-08T12:34:56Z',1788870896,false],
  ]) {const r=buildMetaPayload(setTime(input('meta'),time));equal(r.request.body.data[0].event_time,seconds);equal(r.diagnostics.timestamp_precision_loss,loss);equal(r.preparation.conversion.occurred_at,time);}
  for (const [value,reason] of [['9007199254740993','value_precision_loss'],['-1','negative_value_requires_adjustment']]) {const i=input('meta');i.preparation_input.conversion.value=value;blocked(buildMetaPayload(i),[reason]);}
  for (const value of ['0','-0.00','123.4500']) {const i=input('meta');i.preparation_input.conversion.value=value;equal(buildMetaPayload(i).request.body.data[0].custom_data.value,Number(value)||0);}
  const i=noClicks(input('meta'));i.identity={email:null,phone:null};Object.assign(i.preparation_input.conversion,{value:null,value_status:'mixed_currency',currency:null});i.preparation_input.policy.as_of='2026-09-08T11:00:00Z';blocked(buildMetaPayload(i),['future_event','no_match_keys','unknown_value']);
  i.configuration.money_policy='omit_unknown';blocked(buildMetaPayload(i),['future_event','no_match_keys']);equal(buildMetaPayload(i).diagnostics.warnings,['provider_value_defaults_may_apply','timestamp_truncated_to_seconds']);
});
group('exact provider IDs and versions reject line terminators', () => {
  for (const platform of ['google','linkedin','meta']) {
    const fields=platform==='google'?['account_id','conversion_action_id','login_account_id','linked_account_id']:platform==='linkedin'?['account_id','conversion_rule_id','api_version']:['account_id','pixel_id','api_version'];
    for (const field of fields) for (const suffix of ['\n','\r','\r\n','\u2028','\u2029',' ','\t']) {const i=input(platform);i.configuration[field]+=suffix;invalid(()=>build[platform](i));}
  }
});
group('Meta strict configuration, blocked-input validation and immutable data', () => {
  for (const field of Object.keys(input('meta').configuration)) {const i=input('meta');delete i.configuration[field];invalid(()=>buildMetaPayload(i));}
  for (const [field,values] of Object.entries({
    account_id:['',1,null,'12x'],pixel_id:['',1,null,'12x'],api_version:['v0.0','v01.0','25.0','v25',25,null],
    event_name:['',null,1,' Lead','Lead\n','Lead\u0080','Lead\ud800'],action_source:['WEB',null,''],
    event_source_url:['relative','ftp://example.test','https://user:pass@example.test','https://user@example.test',' https://example.test','https://example.test\n',1],
    client_user_agent:['',1,'agent\n','agent\udfff'],test_event_code:['',1,'code\u0085'],opt_out:[0,'false',undefined],advertiser_tracking_enabled:[1,'true',undefined],
    data_processing:[{}, {options:['LDU','LDU'],country:0,state:0},{options:['OTHER'],country:0,state:0},{options:[],country:-1,state:0},{options:[],country:0,state:0.5},{options:[],country:Number.MAX_SAFE_INTEGER+1,state:0},{options:[],country:false,state:0},{options:[],country:0,state:0,extra:1}],money_policy:['invalid',null],
  })) for (const value of values) {const i=input('meta');i.configuration[field]=value;i.preparation_input.policy.as_of='2026-09-08T11:00:00Z';invalid(()=>buildMetaPayload(i));}
  for (const field of ['event_source_url','client_user_agent']) {const i=input('meta');i.configuration[field]=null;invalid(()=>buildMetaPayload(i));}
  for (const credential of ['access_token','headers','authorization','existing_fbc','fbp','client_ip_address']) {const i=input('meta');i.configuration[credential]='PRIVATE_SENTINEL';invalid(()=>buildMetaPayload(i));try{buildMetaPayload(i);}catch(e){ok(!String(e).includes('PRIVATE_SENTINEL'));}}
  const getter=input('meta');let called=0;Object.defineProperty(getter.configuration,'secret',{enumerable:true,get(){called++;return 'private';}});invalid(()=>buildMetaPayload(getter));equal(called,0);
  const cycle=input('meta');cycle.preparation_input.extra=cycle;invalid(()=>buildMetaPayload(cycle));
  const frozen=input('meta');const before=clone(frozen);Object.freeze(frozen.configuration.data_processing.options);Object.freeze(frozen.configuration);Object.freeze(frozen.identity);Object.freeze(frozen);equal(buildMetaPayload(frozen),buildMetaPayload(before));equal(frozen,before);
  const bad=input('meta');bad.preparation_input.click_observations[0].conversion_key='unrelated';bad.preparation_input.click_observations[0].occurred_at='bad';invalid(()=>buildMetaPayload(bad));
});

group('TikTok selected qualified clicks, local match policy and exact scalar identity', () => {
  const i=input('tiktok');i.identity={email:null,phone:null};const click=i.preparation_input.click_observations[0];
  i.preparation_input.click_observations.push({...click,click_key:'older',occurred_at:'2026-09-08T11:00:00Z',value:'Older'}, {...click,click_key:'unbound',source_scope:'wrong',value:'Unbound'}, {...click,click_key:'future',occurred_at:'2026-09-08T13:30:00Z',value:'Future'}, {...click,click_key:'unrelated',conversion_key:'other',value:'Unrelated'});
  const r=buildTikTokPayload(i);equal(r.request.body.data[0].user.ttclid,'ttclid+Opaque%252F');equal(r.preparation,prepareConversion(i.preparation_input));
  i.preparation_input.click_observations.reverse();equal(buildTikTokPayload(i).request,r.request);
  noClicks(i);blocked(buildTikTokPayload(i),['no_match_keys']); // URL/UA are never keys.
  i.identity={email:'invalid',phone:'invalid'};blocked(buildTikTokPayload(i),['no_match_keys']);
  i.identity={email:'d15efbf82e75e1cfe93b15abc4aa7cca95ce14a27d2fd6b3e81428de42f2e9dd',phone:null};blocked(buildTikTokPayload(i),['no_match_keys']);
  const original=input('tiktok');const body=buildTikTokPayload(original).request.body;equal(typeof body.data[0].user.email,'string');equal(typeof body.data[0].user.phone,'string');equal(body.data[0].limited_data_use,false);
  const serialized=JSON.stringify(buildTikTokPayload(original));ok(!serialized.includes(original.identity.email));ok(!serialized.includes(original.identity.phone));ok(!serialized.includes('test.user+tag@gmail.com'));ok(!serialized.includes('external_id'));ok(!serialized.includes('"ip"'));ok(!serialized.includes('"ttp"'));
  original.preparation_input.browser_event_id='Explicit+ID';equal(buildTikTokPayload(original).request.body.data[0].event_id,'Explicit+ID');delete original.preparation_input.browser_event_id;equal(buildTikTokPayload(original).request.body.data[0].event_id,'7af015a5c42c87622cd4136ba432ca4c81268bbc1c889ade4722558d528e391b');
  original.configuration.event_name='Purchase';equal(buildTikTokPayload(original).destination.event_type,'Purchase');original.preparation_input.platform='meta';invalid(()=>buildTikTokPayload(original));
});
group('TikTok seconds, money and optional fields preserve exact values', () => {
  for (const [time,seconds,loss] of [['1969-12-31T23:59:59.999999999Z',-1,true],['1969-12-31T23:59:58.123456789Z',-2,true],['1970-01-01T00:00:00.000000001Z',0,true],['2026-09-08T12:34:56Z',1788870896,false],['2026-09-08T05:34:56.123456789-07:00',1788870896,true]]) {const r=buildTikTokPayload(setTime(input('tiktok'),time));equal(r.request.body.data[0].event_time,seconds);equal(r.diagnostics.timestamp_precision_loss,loss);}
  for (const [value,reason] of [['9007199254740993','value_precision_loss'],['-0.000000001','negative_value_requires_adjustment']]) {const i=input('tiktok');i.preparation_input.conversion.value=value;blocked(buildTikTokPayload(i),[reason]);}
  for (const limited_data_use of [true,false,null]) {const i=input('tiktok');i.configuration.limited_data_use=limited_data_use;equal(buildTikTokPayload(i).request.body.data[0].limited_data_use,limited_data_use===null?undefined:limited_data_use);}
  const partial=input('tiktok');partial.configuration.page_referrer=null;equal(buildTikTokPayload(partial).request.body.data[0].page,{url:partial.configuration.page_url});
  const i=noClicks(input('tiktok'));i.identity={email:null,phone:null};i.preparation_input.policy.as_of='2026-09-08T11:00:00Z';Object.assign(i.preparation_input.conversion,{value:null,value_status:'mixed_currency',currency:null});blocked(buildTikTokPayload(i),['future_event','no_match_keys','unknown_value']);i.configuration.money_policy='omit_unknown';blocked(buildTikTokPayload(i),['future_event','no_match_keys']);equal(buildTikTokPayload(i).diagnostics.warnings,['provider_value_defaults_may_apply','timestamp_truncated_to_seconds']);
});
group('TikTok exact config and immutable plain input', () => {
  for (const field of Object.keys(input('tiktok').configuration)) {const i=input('tiktok');delete i.configuration[field];invalid(()=>buildTikTokPayload(i));}
  for (const field of ['account_id','pixel_id','event_name','client_user_agent','test_event_code']) for (const v of ['',5,undefined,' x','x ','x\n','x\u0080','x\ud800']) {const i=input('tiktok');i.configuration[field]=v;i.preparation_input.policy.as_of='2026-09-08T11:00:00Z';invalid(()=>buildTikTokPayload(i));}
  for (const field of ['page_url','page_referrer']) for (const v of ['relative','ftp://example.test','https://u:p@example.test',' https://example.test','https://example.test\n',5]) {const i=input('tiktok');i.configuration[field]=v;invalid(()=>buildTikTokPayload(i));}
  const ref=input('tiktok');ref.configuration.page_url=null;invalid(()=>buildTikTokPayload(ref));
  for (const v of [0,1,'false',{},undefined]) {const i=input('tiktok');i.configuration.limited_data_use=v;invalid(()=>buildTikTokPayload(i));}
  for (const extra of ['access_token','headers','api_version','event_source','external_id','ip','ttp']) {const i=input('tiktok');i.configuration[extra]='SECRET_SENTINEL';invalid(()=>buildTikTokPayload(i));try{buildTikTokPayload(i);}catch(e){ok(!String(e).includes('SECRET_SENTINEL'));}}
  const invalidMoney=input('tiktok');invalidMoney.configuration.money_policy='invalid';invalid(()=>buildTikTokPayload(invalidMoney));
  const getter=input('tiktok');let count=0;Object.defineProperty(getter.configuration,'secret',{enumerable:true,get(){count++;return 'private';}});invalid(()=>buildTikTokPayload(getter));equal(count,0);
  const original=input('tiktok');const before=clone(original);Object.freeze(original.configuration);Object.freeze(original.identity);Object.freeze(original);equal(buildTikTokPayload(original),buildTikTokPayload(before));equal(original,before);
  const unused=input('tiktok');unused.preparation_input.click_observations[0].conversion_key='unrelated';unused.preparation_input.click_observations[0].occurred_at='invalid';invalid(()=>buildTikTokPayload(unused));
});

group('Reddit qualified URL fallback policy, hashing and local destination tuple', () => {
  const i=input('reddit');i.identity={email:null,phone:null};const click=i.preparation_input.click_observations[0];
  i.preparation_input.click_observations.push({...click,click_key:'unbound',source_scope:'wrong',value:'Unbound'}, {...click,click_key:'future',occurred_at:'2026-09-08T13:30:00Z',value:'Future'}, {...click,click_key:'unrelated',conversion_key:'other',value:'Unrelated'}, {...click,click_key:'older',occurred_at:'2026-09-08T11:00:00Z',value:'Older'});
  const r=buildRedditPayload(i);equal(r.preparation,prepareConversion(i.preparation_input));equal(r.request.body.data.events[0].click_id,'rdt+Opaque%252F');equal(r.request.body.data.events[0].event_source_url,i.configuration.event_source_url);
  i.preparation_input.click_observations.reverse();equal(buildRedditPayload(i).request,r.request);
  noClicks(i);blocked(buildRedditPayload(i),['no_match_keys']);ok(buildRedditPayload(i).diagnostics.warnings.includes('event_source_url_omitted_without_selected_click'));
  i.identity.email='test@example.test';for(const url of ['https://example.test/?rdt_cid=Unqualified','https://example.test/benign']){i.configuration.event_source_url=url;const o=buildRedditPayload(i);equal(o.status,'ready');ok(!Object.hasOwn(o.request.body.data.events[0],'event_source_url'));ok(!Object.hasOwn(o.request.body.data.events[0],'click_id'));}
  i.configuration.event_source_url=null;ok(!buildRedditPayload(i).diagnostics.warnings.includes('event_source_url_omitted_without_selected_click'));
  const original=input('reddit');const out=JSON.stringify(buildRedditPayload(original));ok(!out.includes(original.identity.email));ok(!out.includes(original.identity.phone));ok(!out.includes('testuser@gmail.com'));ok(!out.includes('"ip_address"'));ok(!out.includes('"uuid"'));
  equal(buildRedditPayload(original).request.url,'https://ads-api.reddit.com/api/v3/pixels/pixel%2Fa%2Bb%3Fc/conversion_events');
  original.preparation_input.browser_event_id='Browser+Opaque';equal(buildRedditPayload(original).request.body.data.events[0].metadata.conversion_id,'Browser+Opaque');delete original.preparation_input.browser_event_id;equal(buildRedditPayload(original).request.body.data.events[0].metadata.conversion_id,'7af015a5c42c87622cd4136ba432ca4c81268bbc1c889ade4722558d528e391b');
  const custom=input('reddit');custom.configuration.custom_event_name='LEAD';equal(buildRedditPayload(custom).destination.event_type,'["CUSTOM","LEAD"]');custom.configuration.tracking_type='LEAD';custom.configuration.custom_event_name=null;equal(buildRedditPayload(custom).destination.event_type,'["LEAD",null]');
  for(const action_source of ['WEBSITE','APP','OTHER','PHYSICAL_STORE']){const x=input('reddit');x.configuration.action_source=action_source;x.configuration.event_source_url=null;equal(buildRedditPayload(x).request.body.data.events[0].action_source,action_source);}
  original.preparation_input.platform='meta';invalid(()=>buildRedditPayload(original));
});
group('Reddit exact seven-day age, millisecond floor, money and warning order', () => {
  const boundary=setTime(input('reddit'),'2026-09-01T12:34:56.123456789Z','2026-09-08T12:34:56.123456789Z');equal(buildRedditPayload(boundary).status,'ready');
  boundary.preparation_input.conversion.occurred_at='2026-09-01T12:34:56.123456788Z';blocked(buildRedditPayload(boundary),['provider_event_too_old']);boundary.preparation_input.conversion.occurred_at='2026-09-01T12:34:56.123456790Z';equal(buildRedditPayload(boundary).status,'ready');
  equal(buildRedditPayload(setTime(input('reddit'),'2026-09-05T00:00:00Z','2026-09-08T00:00:00Z')).status,'ready'); // 2-day dedup window is not ingestion age.
  for(const [time,ms,loss] of [['1969-12-31T23:59:59.999999999Z',-1,true],['1969-12-31T23:59:59.123456789Z',-877,true],['1970-01-01T00:00:00.000000001Z',0,true],['2026-09-08T12:34:56.123000000Z',1788870896123,false]]){const o=buildRedditPayload(setTime(input('reddit'),time));equal(o.request.body.data.events[0].event_at,ms);equal(o.diagnostics.timestamp_precision_loss,loss);}
  for(const [value,reason] of [['9007199254740993','value_precision_loss'],['-0.000000001','negative_value_requires_adjustment']]){const x=input('reddit');x.preparation_input.conversion.value=value;blocked(buildRedditPayload(x),[reason]);}
  const x=setTime(input('reddit'),'2026-09-01T00:00:00.000000001Z','2026-09-08T01:00:00Z');x.identity={email:null,phone:null};Object.assign(x.preparation_input.conversion,{value:null,value_status:'unknown'});x.preparation_input.policy.max_event_age_days=1;blocked(buildRedditPayload(x),['event_too_old','provider_event_too_old','no_match_keys','unknown_value']);x.configuration.money_policy='omit_unknown';blocked(buildRedditPayload(x),['event_too_old','provider_event_too_old','no_match_keys']);equal(buildRedditPayload(x).diagnostics.warnings,['provider_value_defaults_may_apply','timestamp_truncated_to_milliseconds','event_source_url_omitted_without_selected_click']);
});
group('Reddit Unicode names, lexical LDU codes, strict config and immutable data', () => {
  for(const tracking_type of ['PAGE_VISIT','VIEW_CONTENT','SEARCH','ADD_TO_CART','ADD_TO_WISHLIST','PURCHASE','LEAD','SIGN_UP','CUSTOM']){const i=input('reddit');i.configuration.tracking_type=tracking_type;i.configuration.custom_event_name=tracking_type==='CUSTOM'?'😀'.repeat(64):null;equal(buildRedditPayload(i).request.body.data.events[0].type.tracking_type,tracking_type);}
  const tooLong=input('reddit');tooLong.configuration.custom_event_name='😀'.repeat(65);invalid(()=>buildRedditPayload(tooLong));
  for(const region of [null,'CA','US-CA','123','US-123']){const i=input('reddit');i.configuration.data_processing.region=region;const d=buildRedditPayload(i).request.body.data.events[0].user.data_processing_options;equal(d.region,region===null?undefined:region);equal(d.modes,['LDU']);equal(d.country,'US');}
  for(const field of Object.keys(input('reddit').configuration)){const i=input('reddit');delete i.configuration[field];invalid(()=>buildRedditPayload(i));}
  for(const [field,values] of Object.entries({account_id:['',5,'a\n',' a','a\ud800'],pixel_id:['',5,'p\u0080'],tracking_type:['Lead','OTHER',null],custom_event_name:[null,'','a\udfff','a\n'],action_source:['web',null],event_source_url:['relative','ftp://example.test','https://u:p@example.test'],test_id:['',5,'test\n'],data_processing:[{}, {modes:[],country:'US',region:null},{modes:['LDU','LDU'],country:'US',region:null},{modes:['OTHER'],country:'US',region:null},{modes:['LDU'],country:'us',region:null},{modes:['LDU'],country:1,region:null},{modes:['LDU'],country:'US',region:'CA-ON'},{modes:['LDU'],country:'US',region:'US-CALI'},{modes:['LDU'],country:'US',region:'us-ca'},{modes:['LDU'],country:'US',region:0},{modes:['LDU'],country:'US',region:null,extra:true}],money_policy:['bad',null]}))for(const v of values){const i=input('reddit');i.configuration[field]=v;i.preparation_input.policy.as_of='2026-09-08T11:00:00Z';invalid(()=>buildRedditPayload(i));}
  const standard=input('reddit');standard.configuration.tracking_type='LEAD';invalid(()=>buildRedditPayload(standard));const nonweb=input('reddit');nonweb.configuration.action_source='APP';invalid(()=>buildRedditPayload(nonweb));
  for(const extra of ['access_token','headers','ip_address','user_agent','uuid','event_type']){const i=input('reddit');i.configuration[extra]='SECRET';invalid(()=>buildRedditPayload(i));}
  const getter=input('reddit');let count=0;Object.defineProperty(getter.configuration.data_processing,'secret',{enumerable:true,get(){count++;return 'private';}});invalid(()=>buildRedditPayload(getter));equal(count,0);
  const x=input('reddit');const before=clone(x);Object.freeze(x.configuration.data_processing.modes);Object.freeze(x.configuration.data_processing);Object.freeze(x.configuration);Object.freeze(x.identity);Object.freeze(x);equal(buildRedditPayload(x),buildRedditPayload(before));equal(x,before);
  const bad=input('reddit');bad.preparation_input.click_observations.push({...bad.preparation_input.click_observations[0],value:'conflict'});invalid(()=>buildRedditPayload(bad));
});

const child = process.argv.includes('--child');
const copiedFiles = ['scripts/provider-payloads.mjs', 'scripts/test-provider-payloads.mjs', 'scripts/conversion-events.mjs', 'scripts/match-keys.mjs', 'references/payload-fixtures.json', 'references/payload-contract.md'];
const mutationResults = [];
let standalone = null;
if (!child) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capi-payload-check-'));
  try {
    for (const relative of copiedFiles) {
      const dest = path.join(temp, relative); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, relative), dest);
    }
    group('copied directory standalone complete suite', () => {
      const run = spawnSync(process.execPath, ['scripts/test-provider-payloads.mjs', '--child'], { cwd: temp, encoding: 'utf8', timeout: 30000 });
      equal(run.status, 0); ok(run.stdout.includes('PASS provider payloads'));
      standalone = { passed: true, isolated_files: copiedFiles, output: run.stdout.trim() };
    });
    const source = fs.readFileSync(path.join(temp, 'scripts/provider-payloads.mjs'), 'utf8');
    const mutants = [
      ['Reddit URL fallback allowed without selected click', 'if (click) event.event_source_url = c.event_source_url;', 'if (true) event.event_source_url = c.event_source_url;'],
      ['Reddit inclusive age rejected', 'ns < isoNs(p.policy.as_of) - 7n * DAY_NS', 'ns <= isoNs(p.policy.as_of) - 7n * DAY_NS'],
      ['Reddit custom destination collision', 'JSON.stringify([c.tracking_type, c.custom_event_name])', "c.custom_event_name || c.tracking_type"],
      ['TikTok milliseconds emitted as seconds', 'event: c.event_name, event_time: Number(seconds)', 'event: c.event_name, event_time: Number(seconds) * 1000'],
      ['TikTok scalar email double hashed', 'user.email = identities.email', "user.email = hashPlatformIdentity('tiktok', 'email', identities.email)"],
      ['TikTok qualified click replaced', 'user.ttclid = click.value', "user.ttclid = 'Unqualified'"],
      ['Meta conversion time used for capture', 'observed_at: click.occurred_at', 'observed_at: p.conversion.occurred_at'],
      ['Meta truncation toward zero before epoch', 'ns / SECOND_NS - (ns < 0n && ns % SECOND_NS !== 0n ? 1n : 0n)', 'ns / SECOND_NS'],
      ['Meta explicit false omitted', 'if (c.opt_out !== null)', 'if (c.opt_out)'],
      ['seconds instead of milliseconds', 'Number(floorMs(ns))', 'Number(floorMs(ns) / 1000n)'],
      ['double hash email', "hashPlatformIdentity(platform, 'email', input.identity.email)", "hashPlatformIdentity(platform, 'email', hashPlatformIdentity(platform, 'email', input.identity.email))"],
      ['unknown becomes known zero', "if (value_status !== 'known') return policy === 'require_known'", "if (value_status !== 'known') return { omitted: false, reason: null, value: 0, currency: 'USD' };\n  if (false) return policy === 'require_known'"],
      ['opaque click decoded twice', 'adIdentifiers[kind] = click.value', 'adIdentifiers[kind] = decodeURIComponent(click.value)'],
      ['wrong canonical account tuple', 'account_key: c.account_id', "account_key: 'wrong-account'"],
      ['large decimal precision loss accepted', '!sameDecimal(String(value), JSON.stringify(numeric))', 'false'],
      ['fraction milliseconds double counted', "BigInt(fraction.padEnd(9, '0')) % MS_NS", "BigInt(fraction.padEnd(9, '0'))"],
      ['unknown currency emitted', 'if (!value.omitted && !value.reason) { event.conversionValue', 'if (!value.reason) { event.conversionValue'],
    ];
    group('seventeen executable mutation guards', () => {
      for (const [name, from, to] of mutants) {
        ok(source.includes(from));
        fs.writeFileSync(path.join(temp, 'scripts/provider-payloads.mjs'), source.replace(from, to));
        const syntax = spawnSync(process.execPath, ['--check', 'scripts/provider-payloads.mjs'], { cwd: temp, encoding: 'utf8', timeout: 30000 });
        equal(syntax.status, 0);
        const run = spawnSync(process.execPath, ['scripts/test-provider-payloads.mjs', '--child'], { cwd: temp, encoding: 'utf8', timeout: 30000 });
        ok(run.status !== null && run.status !== 0); ok(run.stderr.includes('AssertionError'));
        mutationResults.push({ name, killed: true });
      }
    });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
console.log(`PASS provider payloads: ${groups.length} groups, ${assertions} assertions, ${fixture.cases.length} full goldens${child ? '' : `, ${mutationResults.length} mutants killed, standalone pass`}`);
if (!child) {
  const hashFiles = [...new Set([...copiedFiles, 'references/key-contract.md', 'references/conversion-contract.md', 'references/outbox-contract.md', 'references/provider-api-evidence.md'])];
  const sha256 = Object.fromEntries(hashFiles.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const timestamp = new Date().toISOString();
  const report = { suite: 'Google Data Manager, LinkedIn, Meta, TikTok and Reddit pure payload builders', timestamp, node: process.version, command: 'node scripts/test-provider-payloads.mjs', groups, assertions, golden_count: fixture.cases.length, mutations: mutationResults, standalone, source_sha256: sha256, cleanup: 'owned temporary directory removed', provider_requests: 0, credentials_used: false, limitation: 'Pure synthetic construction only; no provider acceptance, rule ownership, active version or native outbox integration claim.' };
  const dir = path.join(os.homedir(), 'Downloads'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `capi-provider-payload-evidence-${timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${file}`);
}

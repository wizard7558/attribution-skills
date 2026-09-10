import { readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT = 'canonical_sha256_v1';
const VERSION = '0.1.0';
const PIXEL = 'first_party_pixel';
const CHANNELS = ['Paid Search', 'Paid Social', 'Paid Other', 'Organic Search', 'Organic Social', 'Email', 'SMS', 'Direct', 'Referral', 'Affiliate', 'Other'];
const CLICK_FIELDS = ['dclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'rdt_cid', 'li_fat_id', 'twclid', 'epik', 'sccid', 'srsltid'];
const TOUCH_FIELDS = ['source_system', 'source_scope', 'touch_key', 'visitor_key', 'occurred_at', 'channel', 'taxonomy_version', 'utm_campaign', 'click_ids', 'native_contact_id', 'export_status'];
const OBSERVATION_FIELDS = ['source_system', 'source_scope', 'visitor_key', 'observation_key', 'occurred_at', 'source_event_type', 'email_hash', 'phone_hash', 'identity_input_format', 'identity_normalization_version', 'capture_status'];
const CONTACT_FIELDS = ['source_system', 'source_scope', 'contact_key', 'email_hash', 'phone_hash', 'email_hash_format', 'phone_hash_format', 'email_hash_status', 'phone_hash_status', 'capture_status', 'native_created_at'];
const BINDING_FIELDS = ['source_system', 'source_scope', 'contact_source_system', 'contact_source_scope'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function invalid(rule) { throw new TypeError(`Invalid identity projection input: ${rule}`); }
function plain(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') invalid('plain finite JSON data required');
  if (ancestors.has(value)) invalid('cyclic data');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('plain objects required');
  if (Object.getOwnPropertySymbols(value).length) invalid('symbol properties');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !own(descriptor, 'value')) invalid('enumerable data properties required');
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) invalid('extra array properties');
    plain(descriptor.value, ancestors);
  }
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!own(value, i)) invalid('dense arrays required');
  ancestors.delete(value);
}
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('record required');
  if (required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid('missing or unknown fields');
}
function exact(value) { if (typeof value !== 'string' || !value || value !== value.trim()) invalid('exact nonempty string required'); }
function nullableText(value) { if (value !== null && typeof value !== 'string') invalid('string or null required'); }
function digest(value) { if (value !== null && (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value))) invalid('lowercase canonical SHA-256 required'); }
function array(value) { if (!Array.isArray(value)) invalid('array required'); }
function pick(row, fields) { return Object.fromEntries(fields.map(key => [key, row[key]])); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const qualified = (row, kind) => JSON.stringify(kind === 'contact' ? [row.source_system, row.source_scope, row.contact_key] : [row.source_system, row.source_scope, row.visitor_key, row[kind === 'touch' ? 'touch_key' : 'observation_key']]);
function sorted(rows, kind) { return [...rows].sort((a, b) => { const x = qualified(a, kind), y = qualified(b, kind); return x < y ? -1 : x > y ? 1 : 0; }); }
function unique(rows, kind) {
  const seen = new Map();
  for (const row of rows) {
    const key = qualified(row, kind), prior = seen.get(key);
    if (prior && JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(row))) invalid('conflicting qualified duplicate');
    if (!prior) seen.set(key, row);
  }
  return [...seen.values()];
}
function descriptor(row, kind, reason) {
  return { ...pick(row, ['source_system', 'source_scope', 'visitor_key', kind === 'touch' ? 'touch_key' : 'observation_key']), reason };
}
function validateContact(row, external) {
  shape(row, CONTACT_FIELDS);
  for (const key of ['source_system', 'source_scope', 'contact_key']) exact(row[key]);
  if (!external && row.source_system !== PIXEL) invalid('native contact source');
  if (row.native_created_at !== null || !external) exact(row.native_created_at);
  for (const kind of ['email', 'phone']) {
    const hash = row[`${kind}_hash`], format = row[`${kind}_hash_format`], status = row[`${kind}_hash_status`];
    digest(hash);
    if (status === 'attested') {
      if (hash === null || format !== FORMAT) invalid('attested contact kind');
    } else if (status === 'missing' || status === 'legacy_unverified') {
      if (hash !== null || format !== null) invalid('unverified contact kind must expose null');
    } else invalid('contact kind status');
  }
  const eligible = row.email_hash_status === 'attested' || row.phone_hash_status === 'attested';
  if (row.capture_status !== (eligible ? 'eligible' : 'no_attested_identity')) invalid('contact export eligibility');
}
function validateObservation(row) {
  shape(row, OBSERVATION_FIELDS);
  for (const key of ['source_system', 'source_scope', 'visitor_key', 'observation_key', 'occurred_at']) exact(row[key]);
  if (row.source_system !== PIXEL) invalid('observation source');
  if (!['identify', 'form_submit'].includes(row.source_event_type)) invalid('observation event type');
  if (row.identity_input_format !== FORMAT || row.identity_normalization_version !== VERSION) invalid('observation identity format/version');
  digest(row.email_hash); digest(row.phone_hash);
  if (row.capture_status !== (row.email_hash !== null || row.phone_hash !== null ? 'eligible' : 'no_valid_identity')) invalid('observation capture status');
}
function validateTouch(row) {
  shape(row, TOUCH_FIELDS);
  for (const key of ['source_system', 'source_scope', 'visitor_key', 'touch_key', 'occurred_at']) exact(row[key]);
  if (row.source_system !== PIXEL) invalid('touch source');
  if (typeof row.channel !== 'string') invalid('touch channel');
  nullableText(row.taxonomy_version); nullableText(row.utm_campaign);
  if (row.native_contact_id !== null) exact(row.native_contact_id);
  shape(row.click_ids, CLICK_FIELDS);
  for (const field of CLICK_FIELDS) nullableText(row.click_ids[field]);
  const status = row.taxonomy_version === null ? 'legacy_requires_reclassification'
    : row.taxonomy_version !== VERSION ? 'unsupported_taxonomy_version'
    : !CHANNELS.includes(row.channel) ? 'invalid_canonical_channel' : 'eligible';
  if (row.export_status !== status) invalid('touch export status contradicts taxonomy');
}
async function engines(options) {
  plain(options); shape(options, ['identitySkillRoot']); exact(options.identitySkillRoot);
  const root = resolve(options.identitySkillRoot);
  let primitives, graph;
  try {
    [primitives, graph] = await Promise.all([
      import(pathToFileURL(join(root, 'scripts/identity-primitives.mjs')).href),
      import(pathToFileURL(join(root, 'scripts/identity-graph.mjs')).href)
    ]);
  } catch { throw new TypeError('Cannot load identity engines from the explicit identity skill root'); }
  if (typeof primitives.dedupeTouches !== 'function' || typeof graph.buildIdentityGraph !== 'function') throw new TypeError('Explicit identity skill root lacks required engine exports');
  return { dedupeTouches: primitives.dedupeTouches, buildIdentityGraph: graph.buildIdentityGraph };
}

export async function projectIdentity(input, options) {
  plain(input);
  // Own the validated JSON value before any suspension; callers retain mutable originals.
  input = structuredClone(input);
  plain(options); shape(options, ['identitySkillRoot']); exact(options.identitySkillRoot);
  const identitySkillRoot = options.identitySkillRoot;
  shape(input, ['snapshot_evidence_ref', 'config', 'touches', 'observations', 'contacts'], ['external_contacts', 'external_contact_evidence_ref']);
  exact(input.snapshot_evidence_ref);
  shape(input.config, ['invocation_key', 'as_of', 'lookback_days', 'identity_scope_bindings', 'identity_input_format', 'identity_normalization_version']);
  const config = input.config;
  exact(config.invocation_key); exact(config.as_of);
  if (typeof config.lookback_days !== 'number' || !Number.isFinite(config.lookback_days) || config.lookback_days <= 0) invalid('positive finite lookback_days required');
  if (config.identity_input_format !== FORMAT || config.identity_normalization_version !== VERSION) invalid('config identity format/version');
  array(config.identity_scope_bindings);
  for (const binding of config.identity_scope_bindings) { shape(binding, BINDING_FIELDS); for (const key of BINDING_FIELDS) exact(binding[key]); }
  for (const key of ['touches', 'observations', 'contacts']) array(input[key]);
  const external = input.external_contacts ?? [];
  if (own(input, 'external_contacts')) array(input.external_contacts);
  const externalRef = input.external_contact_evidence_ref ?? null;
  if (externalRef !== null || external.length) exact(externalRef);
  input.touches.forEach(validateTouch); input.observations.forEach(validateObservation);
  input.contacts.forEach(row => validateContact(row, false)); external.forEach(row => validateContact(row, true));
  const contacts = unique([...input.contacts, ...external], 'contact');
  const observations = unique(input.observations, 'observation');
  const touchRows = unique(input.touches, 'touch'); // Validate conflicts even on excluded rows.
  const { dedupeTouches, buildIdentityGraph } = await engines({ identitySkillRoot });
  const eligibleTouches = input.touches.filter(row => row.export_status === 'eligible'); // Keep idempotent duplicates for the real dedupe engine.
  const deduped = dedupeTouches(eligibleTouches.map(row => ({ ...pick(row, TOUCH_FIELDS), click_ids: pick(row.click_ids, CLICK_FIELDS) })));
  const identifies = observations.filter(row => row.capture_status === 'eligible');
  const graph = buildIdentityGraph({
    contacts: contacts.map(row => pick(row, ['source_system', 'source_scope', 'contact_key', 'email_hash', 'phone_hash'])),
    identifies: identifies.map(row => pick(row, ['source_system', 'source_scope', 'visitor_key', 'observation_key', 'occurred_at', 'email_hash', 'phone_hash'])),
    touches: deduped.touches.map(row => pick(row, ['source_system', 'source_scope', 'visitor_key', 'touch_key', 'occurred_at', 'channel', 'taxonomy_version'])),
    identity_scope_bindings: config.identity_scope_bindings.map(row => pick(row, BINDING_FIELDS)),
    as_of: config.as_of, lookback_days: config.lookback_days, identity_input_format: FORMAT
  });
  const touchLinks = new Map(graph.touch_links.map(row => [qualified(row, 'touch'), row]));
  const observed = new Set(graph.observations.map(row => qualified(row, 'observation')));
  const excludedTouches = touchRows.filter(row => row.export_status !== 'eligible').map(row => descriptor(row, 'touch', row.export_status));
  const excludedObservations = observations.filter(row => row.capture_status !== 'eligible').map(row => descriptor(row, 'observation', row.capture_status));
  const touches = [];
  for (const row of deduped.touches) {
    const link = touchLinks.get(qualified(row, 'touch'));
    if (!link) { excludedTouches.push(descriptor(row, 'touch', 'future_after_as_of')); continue; }
    const subject = link.status === 'matched' && link.contacts.length === 1 ? link.contacts[0] : null;
    touches.push({ ...pick(row, TOUCH_FIELDS), invocation_key: config.invocation_key, identity_status: link.status,
      subject_source_system: subject?.source_system ?? null, subject_source_scope: subject?.source_scope ?? null, subject_key: subject?.contact_key ?? null });
  }
  for (const row of identifies) if (!observed.has(qualified(row, 'observation'))) excludedObservations.push(descriptor(row, 'observation', 'future_after_as_of'));
  return {
    contract_version: VERSION, invocation_key: config.invocation_key, snapshot_evidence_ref: input.snapshot_evidence_ref,
    external_contact_evidence_ref: externalRef, graph, touches: sorted(touches, 'touch'),
    suppressed_touches: sorted(deduped.suppressed, 'touch'), excluded_touches: sorted(excludedTouches, 'touch'),
    excluded_observations: sorted(excludedObservations, 'observation'),
    contact_diagnostics: sorted(contacts.map(row => pick(row, ['source_system', 'source_scope', 'contact_key', 'email_hash_status', 'phone_hash_status'])), 'contact')
  };
}

const entryPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (entryPath && pathToFileURL(entryPath).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--identity-skill-root') throw new TypeError('Usage: project-identity.mjs --input FILE --identity-skill-root PATH');
    const input = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
    const output = await projectIdentity(input, { identitySkillRoot: resolve(args[3]) });
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } catch (error) {
    // Do not echo JSON parse errors (which can contain source values).
    process.stderr.write(error instanceof TypeError && ['Invalid identity projection input:', 'Usage: project-identity.mjs', 'Cannot load identity engines', 'Explicit identity skill root'].some(prefix => error.message.startsWith(prefix)) ? error.message + '\n' : 'Identity projection failed; check input and explicit identity engine root\n');
    process.exitCode = 1;
  }
}

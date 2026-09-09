# CAPI implementation guide

Version `0.1.0`; MIT; Riley Sorenson. Run examples from the standalone `capi-match-keys` directory.
Node 22+ is required; pure helpers use only Node built-ins and local modules. No sibling skill,
credentials, network service, package installation or SQL engine is needed for pure preparation.

## Source facts and identities

Read the [conversion contract](conversion-contract.md) before adapting native facts. A stage row
uses `source_system`, `source_scope`, `lead_key`, `stage_key`, nullable `achieved`, nullable
`stage_entered_at`, Boolean `is_attribution_primary`, and `value/currency/value_status`.
`conversionFromStage(row)` emits only an achieved dated conversion; undated, false and unknown
states remain distinct. A nonprimary achieved row is still a business event. Lead/stage keys
become a JSON conversion-key tuple, and subject fields remain null. Upstream source-native
stage truth must be established separately; this adapter is not a CRM state engine.

```js
import { conversionFromStage, makeConversionId, prepareConversion } from './scripts/conversion-events.mjs';
const stage = conversionFromStage({
  source_system: 'crm', source_scope: 'example', lead_key: 'lead-1', stage_key: 'won',
  achieved: true, stage_entered_at: '2026-09-08T12:00:00Z', is_attribution_primary: false,
  value: '0', currency: 'USD', value_status: 'known',
});
const conversion = stage.conversion;
const preparationInput = {
  conversion, platform: 'meta', browser_event_id: 'browser+example', click_observations: [],
  policy: { as_of: '2026-09-08T13:00:00Z', max_event_age_days: 7, click_lookback_days: 7,
    click_scope_bindings: [{ conversion_source_system: 'crm', conversion_source_scope: 'example',
      click_source_system: 'web', click_source_scope: 'example-pixel' }] },
};
const prepared = prepareConversion(preparationInput);
const businessId = makeConversionId(conversion);
```

No implicit source binding exists, even for similarly named accounts. All four binding fields
must match exactly. Each click also needs its own qualified source triple, a three-field exact
conversion reference, valid timestamp, canonical kind and opaque value. Select latest eligible
per kind; ties use qualified UTF-8 tuple ordering. Exact duplicate rows collapse; changed payload
under one qualified key throws. Excluded rows are validated too. Do not infer matches from native
user IDs, visitor keys, IP addresses, aliases or channel labels. An explicit subject triple needs
an independently established identity relationship.

Every timestamp requires a `Z` or numeric offset. There is no named report-timezone parameter:
convert source-local civil time to the correct instant before calling, including DST handling.
No date-only reinterpretation or clock fallback exists. Comparisons retain nanoseconds and use
inclusive caller as-of/age/lookback bounds; caller limits do not establish provider ingestion
limits. Preserve exact browser event ID text for provider deduplication and keep the separate
stable business ID. Stable IDs encode only the qualified conversion identity, never mutable
amounts, timestamps, subjects, browser IDs or destination names.

Money follows [the exact contract](conversion-contract.md): known finite safe numeric values or
bounded exact decimal strings require uppercase three-letter currency; unknown is null with
nullable currency; mixed is null/null. Zero is known. There is no FX conversion, fill, or rounding
at the common boundary. Negative money is retained here but blocked by these payload builders.
Do not create a replacement business ID to bypass an accepted-money conflict.

## Keys and five provider builders

```js
import { normalizePlatformIdentity, hashPlatformIdentity, buildMetaFbc } from './scripts/match-keys.mjs';
const canonical = normalizePlatformIdentity('meta', 'email', 'person@example.org');
const hashed = hashPlatformIdentity('meta', 'email', 'person@example.org');
const fbc = buildMetaFbc({ fbclid: 'opaque+click', observed_at: '2026-09-08T11:00:00Z' });
```

Hash only once from raw identity using the destination's exact [key contract](key-contract.md).
Meta/TikTok preserve email dots and plus suffixes; Google removes them only for Gmail/Googlemail;
Reddit removes them for all domains. Google/LinkedIn remove email whitespace, while other
providers reject internal whitespace. LinkedIn phone is unsupported; Meta hashes validated phone
digits without `+`, while Google/TikTok/Reddit include `+`. No national country inference is made.
These matching representations must not replace canonical identity-graph relationships.
The FBC helper preserves a valid supplied cookie; missing input returns null, malformed explicit
cookies throw, and a real click requires a valid positive capture timestamp. The Meta builder
uses selected click capture time, not conversion/send time, and warns if FBC is unrepresentable.

This complete pure example builds all five current wire payloads without sending them:

```js
import { buildGooglePayload, buildLinkedInPayload, buildMetaPayload, buildTikTokPayload, buildRedditPayload } from './scripts/provider-payloads.mjs';
const conversion = { source_system: 'crm', source_scope: 'example', conversion_key: 'order-1',
  occurred_at: '2026-09-08T12:00:00Z', value: '0', currency: 'USD', value_status: 'known' };
const configs = {
  google: { account_id: '123', conversion_action_id: '456', login_account_id: null,
    linked_account_id: null, event_source: 'WEB', consent: null, validate_only: true, money_policy: 'require_known' },
  linkedin: { account_id: '123', conversion_rule_id: '456', api_version: '202607', money_policy: 'require_known' },
  meta: { account_id: '123', pixel_id: '456', api_version: 'v25.0', event_name: 'Purchase',
    action_source: 'website', event_source_url: 'https://example.org/receipt', client_user_agent: 'SyntheticExample/1',
    test_event_code: null, data_processing: null, opt_out: null, advertiser_tracking_enabled: null, money_policy: 'require_known' },
  tiktok: { account_id: 'example-account', pixel_id: 'example-pixel', event_name: 'Purchase',
    page_url: 'https://example.org/receipt', page_referrer: null, client_user_agent: null,
    test_event_code: null, limited_data_use: false, money_policy: 'require_known' },
  reddit: { account_id: 'example-account', pixel_id: 'example-pixel', tracking_type: 'PURCHASE',
    custom_event_name: null, action_source: 'WEBSITE', event_source_url: 'https://example.org/receipt',
    test_id: null, data_processing: null, money_policy: 'require_known' },
};
const builders = { google: buildGooglePayload, linkedin: buildLinkedInPayload, meta: buildMetaPayload,
  tiktok: buildTikTokPayload, reddit: buildRedditPayload };
const inputs = Object.fromEntries(Object.entries(configs).map(([platform, configuration]) => [platform, {
  preparation_input: { conversion, platform, browser_event_id: null, click_observations: [],
    policy: { as_of: '2026-09-08T13:00:00Z', max_event_age_days: 7, click_lookback_days: 7, click_scope_bindings: [] } },
  identity: { email: 'person@example.org', phone: null }, configuration,
}]));
const payloads = Object.fromEntries(Object.entries(builders).map(([platform, build]) => [platform, build(inputs[platform])]));
if (!Object.values(payloads).every((p) => p.status === 'ready')) throw new Error('example preparation blocked');
```

IDs and versions here are syntactic examples, not verified provider resources or supported-version
claims. Required/nullable keys, consent, LDU, money precision and action names differ by provider;
see the [compact operational reference](payload-quick-reference.md),
[full payload contract](payload-contract.md) and [dated primary evidence](provider-api-evidence.md).
Google/LinkedIn use fixed destination event type `conversion`; Meta/TikTok use event names; Reddit
uses `JSON.stringify([tracking_type, custom_event_name])`. Source URL and user agent are context,
not an identity bridge. Reddit omits any URL without an explicitly selected qualified click to
prevent URL fallback; this example therefore warns while remaining ready through its email key.
Unknown money requires explicit `omit_unknown` to omit the pair, or blocks under `require_known`.
Known numeric precision loss also blocks. Meta/TikTok timestamps floor seconds; LinkedIn/Reddit floor milliseconds; Google retains the
validated RFC 3339 timestamp text as documented; warnings are not silently discarded. Provider responses and expiry rules are not
inferred from successful local construction.

## Atomic enqueue and stored-byte worker

Apply `references/sql/conversion_outbox.sql` through your migration process to PostgreSQL 17+
UTF-8, and grant only the required application privileges documented in the [outbox contract](outbox-contract.md).
Use your configured `pg` pool; install `pg@8.16.3` in the application if needed. The bridge itself
has no database dependency and performs no connection, role, transaction or network management.

```js
import { enqueueProviderConversion } from './scripts/provider-outbox.mjs';
const tx = await pool.connect();
let begun = false;
let discard = false;
try {
  await tx.query('BEGIN');
  begun = true;
  await tx.query('UPDATE business_events SET recorded=true WHERE id=$1', [businessId]);
  const { snapshot } = await enqueueProviderConversion(tx, 'meta', inputs.meta);
  await tx.query('COMMIT');
  begun = false;
} catch (error) {
  if (!begun) discard = true; // failed BEGIN: do not return this connection to the pool
  else { try { await tx.query('ROLLBACK'); } catch { discard = true; } }
  throw error; // retain the original error, including a COMMIT or blocked-payload error
} finally { tx.release(discard); }
```

`business_events` is an application-owned example. Use the same pinned connection for all
statements. Exact replay returns the original snapshot; changed body or either identity in the
same destination domain conflicts. Never rebuild an already-enqueued request on retries.

The following worker excerpt assumes immutable caller routing, an authorized transport function
`sendBytes(route, bytes)`, and a provider-specific `classify(response)` returning exactly
`{outcome, result_code}`. It is not invoked by any helper or test against provider URLs:

```js
const domain = ['meta', '123', '456', 'Purchase'];
const worker = 'worker-1';
const tx = await pool.connect();
let claims;
let begun = false;
let discard = false;
try {
  await tx.query('BEGIN');
  begun = true;
  claims = (await tx.query('SELECT * FROM capi_outbox.claim_conversions($1,$2,$3,$4,$5,$6::numeric,$7::integer)',
    [...domain, worker, 30, 1])).rows;
  await tx.query('COMMIT'); // release claim transaction before any network I/O
  begun = false;
} catch (error) {
  if (!begun) discard = true;
  else { try { await tx.query('ROLLBACK'); } catch { discard = true; } }
  throw error;
} finally { tx.release(discard); }
for (const stored of claims) {
  const response = await sendBytes(immutableRouteFor(domain), Buffer.from(stored.request_body, 'utf8'));
  const { outcome, result_code } = classify(response);
  const completion = await pool.query(`SELECT * FROM capi_outbox.complete_conversion(
    $1,$2,$3,$4,$5,$6,$7::integer,$8,$9,
    CASE WHEN $8='retry' THEN clock_timestamp()+interval '30 seconds' ELSE NULL END)`,
    [...domain, stored.business_conversion_id, worker, stored.attempt_token, outcome, result_code]);
  if (!completion.rows[0].applied) await reconcileStaleCompletion(stored, response);
}
```

`immutableRouteFor`, `sendBytes`, `classify`, and `reconcileStaleCompletion` are explicit caller
integration points. Implement and authorize them before live use; no generic provider-response
classifier is supplied. Persist routing URL, pinned API version, public headers and authorization
policy immutably outside this body-only outbox, and keep secrets outside stored bytes. The native
schema does not persist the full HTTP request envelope. A COMMIT error can leave the commit outcome uncertain even after a rollback attempt. Retain
the original error, reconcile durable state on a fresh connection and do not retry automatically.
Failed BEGIN or ROLLBACK discards the connection; cleanup must not mask the original error.
The example claims one event to avoid sequentially aging a batch of leases before sending.
Lease fencing blocks stale completions,
not duplicate remote receipt. Timeout/ambiguous delivery needs provider-specific reconciliation;
there is no exactly-once or provider-acceptance guarantee.

## Tests and troubleshooting

```sh
node scripts/test-match-keys.mjs
node scripts/test-conversion-events.mjs
node scripts/test-provider-payloads.mjs
node scripts/test-eval-manifest.mjs
bash scripts/test-conversion-outbox.sh
```

The manifest test also requires Python 3, `tiktoken==0.13.0`, and the frozen shared scorer;
see [eval.md](eval.md) for standalone configuration. The four Node commands execute no SQL
and make no model/provider calls. The shell harness uses
PostgreSQL 17+ tools, npm and Node; it creates an owned loopback-only cluster, installs pinned pg
in scratch, and runs the original native suite plus actual five-builder integration. Local HTTP
503/200 retries verify stored bytes, committed claims, rollback and fenced completion. This is
local transport proof, not a provider API test. Downloads contains timestamped native evidence
and verified cleanup. Pure fixture suites use independently authored goldens, including nulls.

For `TypeError`, check exact fields, explicit nulls, timestamp offsets, currency representation,
raw identity types and duplicate qualified records. For `capi_payload_blocked`, inspect safe
reasons and rollback; do not fill unknown money, invent click evidence or bypass adjustment rules.
For `outbox_conflict`, reconcile the accepted facts/ID/body instead of minting a new domain.
For an unapplied completion, inspect lease ownership/token/state and reconcile the remote result.
If local PostgreSQL tools are missing, install PostgreSQL 17+ and expose `initdb`, `pg_ctl`, `psql`;
do not point the isolated harness at a production database.

Current fixed-model evaluation scope and status are maintained in [eval.md](eval.md).

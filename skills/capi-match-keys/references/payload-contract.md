# Google, LinkedIn, Meta, TikTok and Reddit conversion payloads

Version `0.5.0`, reviewed 2026-09-08. `scripts/provider-payloads.mjs` exports
`buildGooglePayload(input)`, `buildLinkedInPayload(input)`, `buildMetaPayload(input)`, `buildTikTokPayload(input)`, and `buildRedditPayload(input)`. They construct one synthetic or
caller-supplied conversion request using only the local accepted `prepareConversion` and
`hashPlatformIdentity` modules and Node built-ins. They do not read credentials, read a clock,
make HTTP calls, provision rules, record delivery, or operate the outbox.

## Input

All functions accept exactly these top-level fields:

```js
{
  preparation_input: { conversion, platform, browser_event_id, click_observations, policy },
  identity: { email: null, phone: null },
  configuration: { /* provider configuration below */ }
}
```

`preparation_input` is the actual argument to the accepted `prepareConversion`, documented in
[conversion-contract.md](conversion-contract.md). The builder calls that function; it does
not accept an asserted preparation result. `browser_event_id` remains optional: omission,
undefined, and null use the stable business ID. Additional preparation fields follow the common
contract and are validated but never projected. A different platform throws, rather than being
overridden. Scope binding, conversion references, event eligibility, and per-kind click selection
come exclusively from the common preparation module.

`identity` has exactly `email` and `phone`, each a raw string or null. Invalid string identities
become null through the accepted [key-contract.md](key-contract.md). Each kind calls
`hashPlatformIdentity` once. There is no inferred prehashed-input mode. LinkedIn phone always
normalizes to null and is never sent. Email and phone values are not returned, logged, or placed
in errors. Names, addresses, IP addresses, and arbitrary free-text passthrough are outside
this subset. Meta accepts its explicitly configured user agent as contextual data. As in the common contract, caller-declared business keys, browser IDs, and opaque
click keys must not be repurposed as raw personal identity containers.

All input, including unused rows and extras, must be plain acyclic data. Records may have
Object.prototype or a null prototype; arrays must be ordinary dense arrays with only their
own indices and normal length property. Accessors are rejected by inspecting descriptors
without executing getters. Functions, symbols, nonfinite numbers, BigInts, sparse or augmented
arrays, nonenumerable record fields, Date/Map/Set/class instances, and cycles throw TypeError.
Errors contain only fixed field/validation labels. Required configuration and identity fields
are validated even for a conversion which would otherwise be blocked. No input is mutated.

## Exact configuration

Every listed field is required, including nullable routing fields. Unknown fields—including
credentials or arbitrary headers—throw. Google/LinkedIn/Meta provider identifiers are nonempty ASCII digit strings;
leading zeros are preserved without trimming, punctuation removal, or numeric coercion.

| Google field | Value |
| --- | --- |
| `account_id` | Google Ads operating account ID |
| `conversion_action_id` | Existing conversion action ID |
| `login_account_id` | Digit string or explicit null |
| `linked_account_id` | Digit string or explicit null |
| `event_source` | `WEB`, `APP`, `IN_STORE`, `PHONE`, `MESSAGE`, or `OTHER` |
| `consent` | Explicit null, or exact `{ad_user_data, ad_personalization}` |
| `validate_only` | Explicit boolean |
| `money_policy` | `require_known` or `omit_unknown` |

Each consent value is `CONSENT_GRANTED`, `CONSENT_DENIED`, or
`CONSENT_STATUS_UNSPECIFIED`. Null omits consent; there is no implicit grant. A supplied pair
maps to `adUserData` and `adPersonalization` on the wire. The caller remains responsible for
whether identity collection and use are permitted.

| LinkedIn field | Value |
| --- | --- |
| `account_id` | Account owning the configured rule; used in the canonical destination |
| `conversion_rule_id` | Existing conversion rule's numeric ID |
| `api_version` | Explicit `YYYYMM`, year 2000–9999 and month 01–12 |
| `money_policy` | `require_known` or `omit_unknown` |

The version is caller-pinned configuration. Syntactic validation does not establish that a
version is active or supported by the provider. No LinkedIn consent, test-event, or validate-only
field is invented. Account and rule ownership are caller preflight requirements, not verified
by a pure builder.

## Meta configuration and wire mapping

Meta uses exactly these required configuration fields (nullable means explicit null is allowed):

| Field | Accepted value |
| --- | --- |
| `account_id`, `pixel_id` | Nonempty digit strings, preserved exactly |
| `api_version` | Explicit `v` + positive integer major + `.` + nonnegative integer minor; major has no leading zero |
| `event_name` | Nonempty already-trimmed exact string, no controls or lone Unicode surrogates |
| `action_source` | `physical_store`, `app`, `chat`, `email`, `other`, `phone_call`, `system_generated`, `website` |
| `event_source_url` | Null or absolute HTTP/HTTPS URL without embedded username/password; no controls, whitespace trimming or lone surrogates |
| `client_user_agent`, `test_event_code` | Null or nonempty already-trimmed exact string without controls or lone surrogates |
| `data_processing` | Null or exactly `{options, country, state}`; options is `[]` or `['LDU']`; country/state are nonnegative safe integers |
| `opt_out`, `advertiser_tracking_enabled` | Null or explicit boolean |
| `money_policy` | `require_known` or `omit_unknown` |

Website events require nonnull source URL and user agent under this adapter's policy, based on the
[official website sample](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Conversions%20API%20%28Part%201%20-%20online%29.postman_collection.json).
Other action sources may omit them. This policy does not establish Meta's complete current
server-requiredness matrix. All configuration is validated before a blocked preparation can
return. Unknown fields, credentials, raw IP fields, cookies and arbitrary headers are rejected.

The request is `POST https://graph.facebook.com/{api_version}/{pixel_id}/events`, with public
`Content-Type: application/json` and `Accept: application/json` headers. The body contains
`data: [event]`, and top-level `test_event_code` only when supplied. Every event contains exact
`event_name`, `event_id` from actual preparation, `action_source`, integer-seconds `event_time`,
and `user_data`. Source URL is included at event level when supplied; user agent is included
inside `user_data`. No normalization changes these configured strings.

Meta `event_time` floors the exact conversion nanoseconds to seconds, including before 1970.
Any fractional second sets `timestamp_precision_loss` and warning
`timestamp_truncated_to_seconds`. No provider age limit is invented beyond common preparation
policy. The actual selected eligible `fbclid` is passed once to `buildMetaFbc` with that selected
click's `occurred_at` capture time, never conversion time or the current clock. A click that the
helper cannot represent, including a nonpositive capture epoch or invalid cookie segments, is
omitted with `fbc_unrepresentable`. The conversion can remain ready when another match key is
usable. Existing-cookie-only routing and `fbp` remain outside this payload subset; the underlying
key helper's separate existing-cookie API remains available unchanged.

User data contains `em` and `ph` arrays from one actual `hashPlatformIdentity` call per raw kind,
and `fbc` when representable. Already-hashed-looking input is not an alternate hashing mode.
At least one usable email hash, phone hash or fbc is required by this local subset, otherwise
`no_match_keys`; user agent alone is not a match key. The body never contains raw email/phone,
IP, fbp or extra identity fields. Common preparation remains complete provenance.

Known money uses `custom_data: {value, currency}` with the same exact-decimal JSON-number guard
as Google; known zero remains zero. `omit_unknown` omits the whole pair and preserves the
existing omission warning. Negative values require an adjustment route and block here. Supplied
processing configuration emits `data_processing_options`, `data_processing_options_country`,
and `data_processing_options_state` on the event. Supplied opt-out/tracking booleans are emitted
without dropping false, and processing codes preserve zero.

The destination is `{platform:'meta', account_key:account_id, destination_key:pixel_id,
event_type:event_name}`. Authorization metadata is exactly
`{mechanism:'graph_access_token', parameter:'access_token', scopes:[]}`. The SDK's
[request parameter authentication](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/event-request.js)
informs that metadata; no token is accepted or emitted in URL, body, headers or result. A separate
authorized transport must supply it. Meta reasons are preparation reasons, then `no_match_keys`,
then money reason. Warnings are money omission, timestamp precision, then unusable fbc.

The current SDK confirms these
[event fields and processing controls](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/server-event.js)
and [user-data fields](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/user-data.js).
It does not establish live acceptance, active API version, pixel ownership, event-ID length,
complete required fields or a deduplication-age guarantee. No event is sent by this builder.

## TikTok web configuration and wire mapping

`buildTikTokPayload` accepts exactly the shared outer shape. Its configuration has these exact
required keys: `account_id`, `pixel_id`, `event_name`, `page_url`, `page_referrer`,
`client_user_agent`, `test_event_code`, `limited_data_use`, `money_policy`.

Account, pixel and event names are nonempty already-trimmed well-formed strings without C0/C1
controls. No numeric ID, prefix, length or closed event-name restriction is invented. The event
name may be standard or custom and is preserved exactly. URLs are explicit null or absolute
HTTP/HTTPS URLs without embedded credentials, using the same exact-string validation as Meta.
A referrer requires a page URL. User agent and test code are explicit null or nonempty exact
strings; LDU is null or boolean, preserving false. Money policy remains `require_known` or
`omit_unknown`. Every field is validated even when common preparation is blocked.

The request is `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`, with public
`Content-Type: application/json` and `Accept: application/json`. Its body is exactly this subset:

```js
{
  event_source: 'web',
  event_source_id: pixel_id,
  data: [{
    event: event_name,
    event_time: /* floor exact conversion timestamp to Unix seconds */,
    event_id: preparation.event_id,
    user: { /* email: hash, phone: hash, ttclid: selected value, user_agent: supplied UA */ },
    // page: {url: page_url, referrer: page_referrer} when configured
    // properties: {value: exact-safe JSON number, currency} when money is known
    // limited_data_use: boolean when nonnull
  }],
  // test_event_code when nonnull
}
```

The actual common preparation enforces platform `tiktok`, scoped click selection, policy time
boundaries and browser/business ID parity. The accepted hashing helper is called once per raw
identity kind. Email and phone are scalar hashes, not raw identities or hash-detection mode.
Only the actual selected `ttclid` is projected. URL, referrer and user agent never qualify as a
match signal locally. The local subset requires at least one email hash, phone hash or selected
click; it does not claim a universal server-requiredness rule. No IP, cookie, external ID, URL
click extraction or second selection algorithm is added.

Page URLs pass through as explicit context. The reviewed official API sources do not establish
server-side URL click extraction, unlike the explicit Reddit documentation. The older official
GTM template does extract URL/referrer/cookie clicks itself; that template behavior is deliberately
not reproduced by this scoped builder. Callers must not treat context as qualified identity.

Seconds floor correctly before 1970 and with fractional nanoseconds; fractional seconds yield
`timestamp_precision_loss` and `timestamp_truncated_to_seconds`. No provider ingestion-age limit
is added because the reviewed sources did not establish one. Known zero remains zero; unsafe
decimal-to-number conversion and negative adjustment values block. Unknown/mixed money follows
the shared require/omit policy, warning on omission. Reasons remain common preparation, then
`no_match_keys`, then money reason. Optional LDU false is emitted as a boolean, not omitted or
converted into an object; no country/state fields are invented.

Destination is `{platform:'tiktok', account_key:account_id, destination_key:pixel_id,
event_type:event_name}`. Authorization metadata is
`{mechanism:'access_token', header:'Access-Token', scopes:[]}`. No credential is accepted or emitted.
Actual transport, token permissions, active destination and server acceptance remain unverified.

Current [official Payload Helper](https://business-api.tiktok.com/payload_helper/) and its
[served schema asset](https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/deploy/victorwang/payload_helper/85369/static/js/async/page.16e9e6c6.js)
confirm boolean event-level LDU and scalar-or-array hashed email/phone. The
[pinned official GTM template](https://github.com/tiktok/gtm-template-eapi/blob/089e34eef2e02f8b12a50e9180d958fdb15e6f25/template.tpl)
confirms scalar hashes, the v1.3 endpoint, Access-Token header, page/user mapping and top-level
test code. Its older event names and extraction policy do not constrain this builder.
[Official deduplication guidance](https://ads.tiktok.com/resources/help/article/event-deduplication?lang=en)
uses matching event/event_id over 48 hours, with cross-Pixel/API merge/dedup after five minutes;
this is not an ingestion-age rule or a substitute for explicit destination identity.

## Reddit configuration and wire mapping

`buildRedditPayload` accepts the same exact outer input and has exactly these required config
keys: `account_id`, `pixel_id`, `tracking_type`, `custom_event_name`, `action_source`,
`event_source_url`, `test_id`, `data_processing`, `money_policy`.

Account and pixel IDs are opaque nonempty already-trimmed well-formed strings without C0/C1
controls; no numeric/prefix restriction is inferred. The path uses `encodeURIComponent(pixel_id)`
and the destination preserves the original string. `tracking_type` is exactly `PAGE_VISIT`,
`VIEW_CONTENT`, `SEARCH`, `ADD_TO_CART`, `ADD_TO_WISHLIST`, `PURCHASE`, `LEAD`, `SIGN_UP`, or
`CUSTOM`. Custom name is required only for CUSTOM, and must otherwise be explicit null. It is
nonempty, well-formed, exact text of at most 64 Unicode code points, not 64 bytes or JavaScript
UTF-16 units. It must be already trimmed and contain no C0/C1 controls. Standard and custom names
remain case-sensitive. The action source is `WEBSITE`, `APP`, `OTHER`, or `PHYSICAL_STORE`.

Event source URL is null or an absolute HTTP/HTTPS URL without credentials, validated identically
to Meta/TikTok; a nonnull URL is allowed only for WEBSITE. Test ID is null or nonempty exact text.
Money policy has the same two values. Data processing is null or exactly:

```js
{ modes: ['LDU'], country: 'US', region: null } // or region 'CA' / 'US-CA'
```

Modes must contain exactly LDU once. Country is two uppercase ASCII letters. Region is null,
one to three uppercase letters/digits, or that same country plus `-` plus one to three uppercase
letters/digits. These are lexical ISO code shapes, not a complete country/subdivision database
or a claim that every syntactically accepted code is recognized by Reddit. Country requiredness
comes from the official direct-integration guide; region is optional. A null region is omitted
on the wire. Configuration and unused raw inputs are validated even when preparation is blocked.

The request is `POST https://ads-api.reddit.com/api/v3/pixels/{encoded_pixel_id}/conversion_events`,
with public Content-Type and Accept application/json headers. Body is:

```js
{
  data: {
    events: [{
      event_at: /* floor exact conversion timestamp to epoch milliseconds */,
      action_source,
      type: {tracking_type /*, custom_event_name only for CUSTOM */},
      // click_id: actual selected rdt_cid
      // user: {email: hash, phone_number: hash, data_processing_options: {modes, country, region?}}
      metadata: {conversion_id: preparation.event_id /*, value: numeric, currency */},
      // event_source_url only when a qualified click was selected
    }],
    // test_id when nonnull
  }
}
```

The builder invokes actual `prepareConversion` for `reddit` and hashes each raw identity kind
once. Only its actual selected qualified `rdt_cid` becomes click_id. The local supported subset
requires email hash, phone hash or selected click; processing flags alone are not a match key.
User is omitted if neither hashes nor LDU are present. Raw identity, cookies, IP, user agent and
external ID fields are outside this subset. Known money is protected by the existing exact JSON
number guard, zero is retained, negative adjustment values block, and unknown money follows the
shared require/omit policy. Metadata always retains the prepared event ID when a request is ready.

**URL fallback policy:** Reddit documents that event_source_url can supply a click ID when the
explicit click_id is absent. This builder includes the caller URL only when an actual qualified
rdt_cid was selected. Otherwise every supplied URL is omitted, even a seemingly benign one,
with warning `event_source_url_omitted_without_selected_click`. The URL is never parsed for
matching, rewritten, or used as a fallback source. This is an explicit local policy protecting
the common selection boundary, not a claim that Reddit itself enforces source qualification.

Milliseconds use mathematical floor, including pre-epoch fractional times. Submillisecond
precision sets `timestamp_precision_loss` and `timestamp_truncated_to_milliseconds`. The exact
nanosecond age comparison blocks events strictly older than `as_of - 7 days` with
`provider_event_too_old`; the boundary is inclusive. The guide's two-day proper-deduplication
window is documented but is not used as an ingestion filter. Reasons are common preparation,
provider age, no_match_keys, then money. Warnings are omitted money, timestamp precision, then
URL omission. No current clock is read.

Destination has platform reddit, exact account_key/pixel destination_key, and event_type equal
to `JSON.stringify([tracking_type, custom_event_name])`. This is a local collision-safe tuple
encoding: CUSTOM named LEAD cannot collide with standard LEAD. It is not a provider wire field
or a claim that this exact serialization is Reddit's deduplication key. Actual deduplication
requires matching conversion ID and event type within the same channel, plus custom name when
applicable. Authorization metadata is exactly
`{mechanism:'conversion_access_token', header:'Authorization', scheme:'Bearer', scopes:[]}`.
The token is supplied only by a separately authorized transport, never accepted by this builder.

The [current official operation](https://ads-api.reddit.com/docs/v3/api/post-conversion-events)
and its [served request-schema module](https://ads-api.reddit.com/docs/assets/js/cd024ded.483cf450.js)
confirm these wire fields, integer-millisecond type, nine event types, four action sources,
nonnegative numeric value and string pixel parameter. The
[direct-integration guide](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration)
confirms seven-day delivery, country/optional-region LDU policy and URL click fallback.
Neither source establishes a pixel/account ID regex, conversion-ID maximum, universal minimum
match-key set, live acceptance or a full server-validation guarantee. No event request is sent.

## Uniform result and blocking

All ready and blocked results always contain exactly these fields, in this order:

```js
{
  status: 'ready', // or 'blocked'
  reasons: [],
  preparation: /* complete, unchanged actual prepareConversion output */,
  destination: {
    platform: 'google', // or 'linkedin'
    account_key: '00123456789',
    destination_key: '00987654321',
    event_type: 'conversion'
  },
  request: { // null when blocked; never a partial request
    method: 'POST', url: '...', headers: { /* public headers only */ },
    body: { /* provider shape */ },
    request_body: '...' // exact JSON.stringify(body), stable construction order
  },
  authorization: {
    mechanism: 'oauth2_bearer',
    header: 'Authorization',
    scopes: [/* provider scope names, never an actual token */]
  },
  diagnostics: {
    money_omitted: false,
    timestamp_precision_loss: false,
    warnings: []
  }
}
```

Google scopes are `['https://www.googleapis.com/auth/datamanager']`; LinkedIn scopes are
`['rw_conversions', 'r_ads']`, following the current official permission guidance. This metadata
is outside the request body and public headers. A separate authorized transport must obtain and
supply the token. No Authorization value or credential placeholder is emitted.

Reasons accumulate deterministically: common preparation reasons first, provider timestamp
reason second, `no_match_keys` third, and the money reason last. Any reason blocks the entire
request. Provider timestamp reasons are `provider_timestamp_out_of_range` for Google and
`provider_event_too_old` for LinkedIn and Reddit. Money reasons are `unknown_value`,
`negative_value_requires_adjustment`, or `value_precision_loss`.

Diagnostics describe the planned representation, even when another reason blocks the request.
`money_omitted` is true for unknown/mixed money under `omit_unknown`, accompanied by
`provider_value_defaults_may_apply`. LinkedIn and Reddit submillisecond timestamps set
`timestamp_precision_loss` and `timestamp_truncated_to_milliseconds`. Warnings are ordered money
then timestamp. These flags do not imply that a request was sent.

Google and LinkedIn canonical destinations use the immutable account and configured action/rule identity,
with the fixed event type `conversion`. Meta uses the configured pixel and exact event name. A mutable stage or campaign label does not create a
new deduplication namespace. `preparation.business_conversion_id` and `preparation.event_id`
remain distinct; the wire uses the latter, including any explicit browser ID unchanged.

## Google Ads through Data Manager

The request is `POST https://datamanager.googleapis.com/v1/events:ingest`, with public header
`Content-Type: application/json`. The exact supported body shape is:

```js
{
  destinations: [{
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: account_id },
    productDestinationId: conversion_action_id,
    reference: 'ad_destination',
    // loginAccount and linkedAccount use the same ProductAccount shape when non-null
  }],
  events: [{
    destinationReferences: ['ad_destination'],
    transactionId: preparation.event_id,
    eventTimestamp: preparation.conversion.occurred_at,
    eventSource: event_source,
    // Optional userData: {userIdentifiers: [{emailAddress: hash}, {phoneNumber: hash}]}
    // Optional adIdentifiers: {gclid, gbraid, wbraid}
    // Optional consent: {adUserData, adPersonalization}
    // Paired conversionValue (JSON number) and currency when known and representable
  }],
  encoding: 'HEX',
  validateOnly: validate_only
}
```

`adIdentifiers` is one object, with all selected eligible kinds in gclid/gbraid/wbraid order;
opaque values retain case, `+`, and percent escapes. Email precedes phone. Empty userData and
adIdentifiers are omitted. At least one supported hash or click must exist; otherwise the
builder blocks with `no_match_keys`. Encoding and validation mode belong to the request;
consent belongs to the event. Google ignores encoding when no UserData is present.

The original valid RFC 3339 timestamp text is retained, including an offset and up to nine
fractional digits. Google uses the Protobuf Timestamp UTC range, from
0001-01-01T00:00:00Z through 9999-12-31T23:59:59.999999999Z inclusive. Lexical year 0000 and
an otherwise valid local timestamp whose offset crosses either UTC boundary are blocked.
No GA4-specific 48/72-hour age rule is imposed on Google Ads. Common caller policy still applies.

Before sending, the caller must establish an enabled Google Ads `UPLOAD_CLICKS` action,
appropriate account access/links and action ownership, and the other Google Ads prerequisites.
`ready` proves construction against this subset, not provider acceptance or authorization.
`validateOnly: true` instructs Google to validate without executing if a transport later sends it.

## LinkedIn

The request is `POST https://api.linkedin.com/rest/conversionEvents`, with public headers
`Content-Type: application/json`, `Linkedin-Version: <api_version>`, and
`X-Restli-Protocol-Version: 2.0.0`. Its supported body is:

```js
{
  conversion: 'urn:lla:llaPartnerConversion:' + conversion_rule_id,
  conversionHappenedAt: /* integer epoch milliseconds */,
  eventId: preparation.event_id,
  user: { userIds: [
    // {idType: 'SHA256_EMAIL', idValue: email_hash}, when available
    // {idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: selected_li_fat_id}
  ] },
  // Optional conversionValue: {currencyCode: currency, amount: decimal_string}
}
```

Email precedes li_fat_id. There must be at least one of these identifiers; phone alone blocks.
The original common conversion timestamp remains unchanged in `preparation`. Wire milliseconds
are floored, including timestamps before the Unix epoch. Exact nanosecond age comparison happens
before that reduction: the inclusive 90-day boundary uses caller `policy.as_of`, and one
nanosecond older blocks. Common caller age and future-event rules also apply; no implicit clock
or current-time fallback exists. These are reproducible construction checks relative to the
caller-supplied as-of value; the real service evaluates ingestion against its own time.

The caller must verify an existing enabled `CONVERSIONS_API` rule belonging to the configured
account, required permissions/roles, and an active pinned API version. LinkedIn's documented
browser Insight Tag plus API deduplication uses the same account and event ID. This does not
establish a server-to-server exactly-once guarantee or an undocumented deduplication time window.

## Monetary representation

Common unknown and mixed-currency values block under `require_known`. Under `omit_unknown`,
both amount and currency are omitted. Provider defaults may then apply; this is not a promise
that remote reporting preserves unknown/null semantics. No FX conversion is performed.

Known zero remains known zero and is always emitted with currency. Negative zero is
mathematically zero: Google emits JSON number 0; LinkedIn retains a supplied `'-0.00'` string.
Actual negative values block under the local ordinary-conversion policy with
`negative_value_requires_adjustment`. That policy requires a separate adjustment workflow;
it is not a claim about an undocumented provider-wide ban on negative values.

Google converts a known decimal string only when its exact decimal value equals the exact
decimal value of `JSON.stringify(Number(value))`. Comparison uses normalized BigInt coefficient
and decimal exponent, without tolerance or comparison against the binary floating-point
expansion. Thus `'123.4500'` becomes JSON `123.45`; a 29-digit value that loses decimal precision
blocks, while an exactly represented power of ten can pass. Accepted finite JS numbers already
carry Number semantics from the common contract and serialize faithfully. Unsafe integer Number
inputs are rejected by that contract before provider handling.

LinkedIn preserves a supplied decimal string byte-for-byte, including trailing zeros. For JS
numbers it expands the standard exponent spelling to ordinary decimal notation; it does not
truncate small values to zero. Amount and currency are always paired.

## Verification and source evidence

Run from this skill directory:

```sh
node scripts/test-provider-payloads.mjs
```

The suite includes ten literal complete-result goldens in `payload-fixtures.json`, actual
accepted preparation/hash integration, all supported signals, scope exclusions, stable IDs,
configuration/credential rejection, no raw-identity projection, exact money, nanosecond age
boundaries, negative epochs, Google UTC range, optional browser IDs, plain-data rejection
without getter evaluation, and deterministic complete output under key/click permutations.

Expected results were declared independently from the public schemas and accepted common
projection contract. Python hashlib independently derived the literal normalized-identity and
business-tuple hashes; Python datetime independently derived the primary wire timestamp. No
expected value was generated by running the payload implementation.

Seventeen executable source mutants must fail assertions: seconds instead of milliseconds, double
hashing, unknown zero-fill, click re-decoding, wrong canonical account, large decimal precision
loss, double-counted milliseconds, money fields on omitted values, Meta conversion-time cookie capture,
Meta pre-epoch truncation toward zero, omission of an explicitly false Meta control, TikTok milliseconds
in the seconds field, TikTok double-hashed scalar email, replacement of a selected TikTok click, Reddit
URL fallback without selection, rejection of the inclusive Reddit age boundary, and colliding Reddit
custom/standard destination encodings. Each mutant passes
syntax checking before its suite failure counts. The suite also runs in a copied directory
containing only these files and the two accepted local runtime modules; no sibling skill,
network, credentials, database, or external package is needed. Owned temporary files are removed.
Every full run writes fresh sanitized versions, commands, assertion counts, source SHA-256
hashes, mutation and standalone results to `~/Downloads/capi-provider-payload-evidence-<UTC>.json`.
Earlier reports are preserved.

Current primary sources were checked on 2026-09-08:

- [Google events.ingest](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest), updated 2026-07-28: endpoint, OAuth scope, request versus event fields, event source enum, and numeric conversion value.
- [Google Destination](https://developers.google.com/data-manager/api/reference/rest/v1/Destination), updated 2026-02-17: reference and optional routing ProductAccount objects.
- [Google UserData](https://developers.google.com/data-manager/api/reference/rest/v1/UserData), updated 2026-07-28: emailAddress and phoneNumber hash identifiers.
- [Google Consent](https://developers.google.com/data-manager/api/reference/rest/v1/Consent), updated 2025-03-06: camelCase fields and exact enum values.
- [Protobuf Timestamp](https://protobuf.dev/reference/protobuf/google.protobuf/#timestamp): RFC 3339 timestamp UTC range and nanosecond representation.
- [Google send-events guide](https://developers.google.com/data-manager/api/devguides/events/send-events): Google Ads signal/action requirements and separation from GA4 rules, also recorded in the accepted [provider evidence](provider-api-evidence.md).
- [LinkedIn Conversions API](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api?view=li-lms-2026-08), updated 2026-08-26: endpoint, headers, both rw_conversions and r_ads scope permissions, rule prerequisites.
- [LinkedIn schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema?view=li-lms-2026-07), updated 2026-08-26: milliseconds, 90-day ingestion rule, user IDs, and decimal-string amount.
- [LinkedIn deduplication](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/deduplication?view=li-lms-2026-06): browser/server account-and-event identity, also recorded in the accepted provider evidence.

No unknown provider identifier length, server deduplication expiry, rule ownership, or live
acceptance is invented. [outbox-contract.md](outbox-contract.md) defines the existing durable
ledger; this step adds no second ledger and does not claim a new native outbox integration test.

Five added Meta full-result goldens cover website context with false/zero controls, nonwebsite known zero, blocked missing keys plus unknown money, omitted unknown money, and pre-epoch capture omission. Original Google/LinkedIn fixtures remain unchanged. Meta targeted checks also exercise timestamp floor, capture scope/order, single hashing, browser/business ID parity, exact configuration types, raw input immutability and invalid excluded rows.

Five additional TikTok full-result goldens cover custom events with context and false LDU, known zero with omitted context, blocked missing keys plus unknown money, omitted unknown money, and negative-epoch fractional time. The prior 15 Google/LinkedIn/Meta goldens remain unchanged. All four pure builders run in the standalone copied-directory suite; no provider events are sent.

Six added Reddit full-result goldens cover custom LDU with a qualified URL, standard click-only known zero, unknown money with URL fallback suppressed, blocked missing keys plus unknown money, pre-epoch millisecond floor, and an event beyond seven days. The prior 20 goldens remain unchanged. Targeted Unicode/age/LDU/scope/config checks and three additional production-source mutants run with all five builders in the actual standalone copy.

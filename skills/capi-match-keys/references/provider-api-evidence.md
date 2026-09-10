# Provider conversion request evidence

Version `0.1.0`; primary-source review completed **2026-09-08**. This is a request-contract
research record for the five provider adapters. It does not send events, select credentials, or
claim that an accepted HTTP request was attributed. Examples use synthetic placeholders only.

The shared local contracts remain authoritative for canonical hashes, business/provider IDs,
click eligibility, and outbox replay. In particular, provider adapters must not reinterpret the
common negative/unknown monetary states or mutate the destination tuple on retry. Where a
provider source does not publish a limit or rule, this record says **not confirmed** rather than
inventing a constraint.

## At-a-glance contract

| Provider | Current endpoint and public request headers | Native event identity and deduplication | Time | Match keys from the shared helper | Money | Consent/test |
| --- | --- | --- | --- | --- | --- | --- |
| Google Ads via Data Manager | `POST https://datamanager.googleapis.com/v1/events:ingest`; `Authorization: Bearer <token>`, `Content-Type: application/json`. The Data Manager API uses OAuth scope `https://www.googleapis.com/auth/datamanager`; a Google Ads developer token is not required for this endpoint. | `Event.transactionId`; within the **same Google Ads conversion action**, Google Ads uses it to deduplicate events from multiple sources. No provider deduplication time window or transaction ID maximum is published in the reviewed sources. | `eventTimestamp`: JSON RFC 3339; source can preserve up to 9 fractional digits, while the API's generated representation uses 0, 3, 6, or 9. | `gclid`, `gbraid`, `wbraid` in `adIdentifiers`; SHA-256 hex email/phone in `userData` (request `encoding: HEX`). | `conversionValue`: JSON number; `currency`: string. Negative/range behavior is not documented in the reviewed Data Manager sources. Omit both when common value is unknown; Google behavior after omission is not promised here. | Request/event `consent` is optional and uses `adUserData`/`adPersonalization` statuses. `validateOnly: true` validates without executing. |
| Meta Conversions API | Graph endpoint constructed by the official SDK as `https://graph.facebook.com/{version}/{pixel_id}/events`; `Content-Type: application/json`, `Accept: application/json`, SDK `User-Agent`. The SDK puts the access token in request parameters; do not expose it in this evidence file. | `event_name` + `event_id` are the SDK-documented identity pair for determining identical events. The reviewed official SDK source does not state a deduplication time window or maximum event ID length; those remain not confirmed. | `event_time`: Unix epoch seconds, number. | `user_data.em` and `user_data.ph` after Meta SDK normalization/SHA-256; `user_data.fbc`/`fbp` are opaque browser identifiers and `event_id` is the event ID. This adapter's shared helper supplies email/phone hashes and fbc. | `custom_data.value`: number; `custom_data.currency`: valid ISO 4217 three-letter string (SDK normalizes currency). Negative/range behavior is not documented by the reviewed SDK source. Omit value/currency for unknown; downstream handling is not promised. | `data_processing_options` and country/state are optional processing controls; `opt_out` and `advertiser_tracking_enabled` are optional SDK fields. `test_event_code` is an optional EventRequest test field. |
| TikTok Events API 2.0 | `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`; `Access-Token: <token>`, `Content-Type: application/json`. | `event_id` is recommended for deduplication. Official TikTok help says identical event + event ID are deduplicated within a 48-hour window; Pixel/API overlap is merged or deduplicated after 5 minutes and within 48 hours from the first event. Domain includes the event source/channel and matching event identity; exact account/pixel scoping is not further specified in the reviewed source. | `event_time`: Unix epoch seconds in UTC+0. | `user.email`, `user.phone` (hashed values accepted by the payload helper), `user.ttclid` (click ID), and optionally external ID/ttp. The shared helper supplies email/phone hashes and ttclid. | `properties.currency`: ISO 4217 code; `properties.value`: provider payload helper exposes a numeric value field, but reviewed official source does not state negative/range behavior. Omit both for unknown; downstream defaults are not promised. | `limited_data_use` is an optional event field in the payload helper. No validate-only field was confirmed in the reviewed Events API 2.0 sources. |
| LinkedIn Conversions API | `POST https://api.linkedin.com/rest/conversionEvents`; `Authorization: Bearer <token>`, `Content-Type: application/json`, `Linkedin-Version: YYYYMM`, `X-Restli-Protocol-Version: 2.0.0`. | `eventId` is optional and used for deduplication. For redundant Insight Tag + CAPI events, LinkedIn describes the domain as same account + same event ID; no time window or event ID maximum is published in the reviewed current sources. | `conversionHappenedAt`: epoch milliseconds; current schema requires the timestamp to be within the past 90 days. | `user.userIds`: `SHA256_EMAIL` and `LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID` (the latter carries `li_fat_id`). LinkedIn does not accept the shared helper's phone hash as a listed current `idType`; the helper's LinkedIn phone result is null. | `conversionValue.amount`: decimal string; `currencyCode`: ISO currency code. Negative/range behavior is not documented in the reviewed schema. Omit `conversionValue` when unknown; provider behavior after omission is not promised. | No consent or validate-only field was confirmed in the reviewed current conversion event schema. |
| Reddit CAPI v3 | `POST https://ads-api.reddit.com/api/v3/pixels/{pixel_id}/conversion_events`; `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json`. | `metadata.conversion_id` is the preferred explicit dedup ID. Reddit says deduplication requires matching conversion ID or session method **and the same event type**; custom events also require matching custom name. Explicit conversion-ID deduplication is evaluated hourly, event logs are retained up to 7 days, and events must be sent within 2 days for proper deduplication. Conversion ID maximum is not published in the reviewed source. | `event_at`: Unix epoch milliseconds. | `click_id` from `rdt_cid`; `user.email` and `user.phone_number` may be hashed; the shared helper supplies Reddit email/phone hashes and rdt_cid. | `metadata.value`: double, documented `>= 0`; `metadata.currency`: ISO 4217 string. Unknown value must be omitted rather than zero-filled; API treatment of omitted revenue is not promised. Negative is outside the documented range. | `user.data_processing_options` is optional LDU consent control; for LDU, mode is fixed to `LDU`, country required, region optional. `data.test_id` is the official Events Testing field. |

For the outbox's future canonical tuple, Google and LinkedIn use fixed `event_type =
"conversion"` because the configured Google conversion action or LinkedIn conversion rule
defines the semantic action. Meta, TikTok, and Reddit map the actual provider event name/type.
The deduplication domain must include the immutable provider account/pixel/destination identity;
mutable campaign or stage labels must not create a new provider namespace.

## Minimal synthetic request bodies

These are intentionally minimal illustrative bodies. Fields marked `<...>` are configuration
or runtime placeholders, never secrets or real account identifiers. Include identity fields only
when the consent and source policy permits them. An unknown common monetary value is represented
by omission, not by a fabricated zero; provider-specific defaults, if any, are not known here.

### Google Ads through Data Manager API

Public headers:

```json
{
  "Authorization": "Bearer <oauth-access-token>",
  "Content-Type": "application/json"
}
```

```json
{
  "destinations": [{
    "operatingAccount": {"accountType": "GOOGLE_ADS", "accountId": "<ads-account-id>"},
    "productDestinationId": "<upload-clicks-conversion-action-id>",
    "reference": "ads_destination"
  }],
  "events": [{
    "destinationReferences": ["ads_destination"],
    "transactionId": "<stable-provider-event-id>",
    "eventTimestamp": "2026-09-08T12:34:56.123Z",
    "eventSource": "WEB",
    "adIdentifiers": {"gclid": "<gclid>"},
    "conversionValue": 123.45,
    "currency": "USD",
    "userData": {"userIdentifiers": [{"emailAddress": "<sha256-hex-email>"}]}
  }],
  "encoding": "HEX",
  "validateOnly": true
}
```

`destinations[]` and `events[]` are request-required. Google Ads offline conversions or
enhanced conversions for leads require `productDestinationId` to be an `UPLOAD_CLICKS` Google
Ads conversion action. For this Google Ads path, `eventSource` is required by the send-events
guide and must be an `EventSource` enum. At least one attribution/match signal is required by
the use-case guide: an applicable ad identifier, session attributes, or user data. `transactionId`
is required when the event is an additional source for tag conversions, but the reviewed guide
does not make it universal for every Google Ads event.

The `validateOnly` flag is test/validation-only and does not execute the request. Google warns
that, beginning 2026-06-15, new Google Ads API `UploadClickConversion` developer tokens are
restricted; this record therefore uses the Data Manager endpoint rather than designing a new
Google Ads `UploadClickConversion` adapter. The Google Analytics 72-hour/48-hour rules are
GA4-specific and are deliberately excluded from this Google Ads contract.

### Meta Conversions API

Public headers emitted by the reviewed SDK transport:

```json
{
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "fbbizsdk-nodejs-v<SDK_VERSION>"
}
```

```json
{
  "data": [{
    "event_name": "Lead",
    "event_time": 1788870896,
    "event_id": "<stable-provider-event-id>",
    "action_source": "website",
    "user_data": {
      "em": ["<sha256-hex-email>"],
      "ph": ["<sha256-hex-phone>"],
      "fbc": "<fbc>"
    },
    "custom_data": {"value": 123.45, "currency": "USD"}
  }],
  "test_event_code": "<test-event-code>"
}
```

The official Facebook Business SDK v25.0.1 source constructs the Graph URL, normalizes and
emits the fields shown, and documents `event_time` as seconds and `event_id` as an advertiser
chosen string used with `event_name` to determine identical events. The SDK's parameter builder
normalizes/hashes customer information; this record uses already-hashed values from the shared
helper so a future adapter must not accidentally double-hash. `test_event_code` is only for the
official Test Events flow and must not be used as a production identity.

The SDK source is implementation evidence for the current wire shape, not proof of all server
validation rules. In particular, requiredness beyond the fields demonstrated in Meta's current
server-event documentation, event ID maximum length, and deduplication time window remain not
confirmed here because the official documentation pages were unavailable during this review.

### TikTok Events API 2.0

Public headers:

```json
{
  "Access-Token": "<access-token>",
  "Content-Type": "application/json"
}
```

```json
{
  "event_source": "web",
  "event_source_id": "<pixel-id>",
  "data": [{
    "event": "CompletePayment",
    "event_time": 1788870896,
    "event_id": "<stable-provider-event-id>",
    "user": {
      "email": "<sha256-hex-email>",
      "phone": "<sha256-hex-phone>",
      "ttclid": "<ttclid>"
    },
    "properties": {"currency": "USD", "value": 123.45}
  }]
}
```

TikTok's official Payload Helper marks event name and event time required for all events and
event ID recommended for deduplication. The helper's generated shape uses `event_source`,
`event_source_id`, and `data`; its docs identify event time as UTC Unix seconds and currency as
ISO 4217. The current API reference identifies `/event/track/` as the Events API 2.0 endpoint and
v1.3 as the current API version. `event_id` is included even when no browser Pixel request exists
because it is the stable provider event identifier for retries and any later redundant setup.

### LinkedIn Conversions API

Public headers:

```json
{
  "Authorization": "Bearer <oauth-access-token>",
  "Content-Type": "application/json",
  "Linkedin-Version": "<YYYYMM>",
  "X-Restli-Protocol-Version": "2.0.0"
}
```

```json
{
  "conversion": "urn:lla:llaPartnerConversion:<conversion-rule-id>",
  "conversionHappenedAt": 1788870896123,
  "conversionValue": {"currencyCode": "USD", "amount": "123.45"},
  "user": {
    "userIds": [
      {"idType": "SHA256_EMAIL", "idValue": "<sha256-hex-email>"},
      {"idType": "LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID", "idValue": "<li_fat_id>"}
    ]
  },
  "eventId": "<stable-provider-event-id>"
}
```

The conversion rule must already exist, be enabled, and use `CONVERSIONS_API`; the streaming
event's `conversion` is its `urn:lla:llaPartnerConversion:<id>`. Current schema validation
requires at least one valid user identifier unless another valid user identifier source is used;
the helper subset here is SHA-256 email and LinkedIn first-party click ID. `userInfo`, if used,
requires both first and last name, but it is outside the helper subset and omitted. The current
schema calls `eventId` optional, although it is necessary when intentionally deduplicating a
redundant browser/server event. A single event returns 201 on success; this evidence does not
claim a validate-only mode.

### Reddit CAPI v3

Public headers:

```json
{
  "Authorization": "Bearer <oauth-access-token>",
  "Content-Type": "application/json",
  "Accept": "application/json"
}
```

```json
{
  "data": {
    "test_id": "<events-testing-id>",
    "events": [{
      "click_id": "<rdt_cid>",
      "event_at": 1788870896123,
      "action_source": "WEBSITE",
      "type": {"tracking_type": "LEAD"},
      "user": {
        "email": "<sha256-hex-email>",
        "phone_number": "<sha256-hex-phone>"
      },
      "metadata": {"conversion_id": "<stable-provider-event-id>"}
    }]
  }
}
```

`data.events[]` accepts 1–1000 events per request. The API marks `event_at`, `action_source`,
and `type` required; `type` must contain at least `tracking_type`, and `custom_event_name` is
needed with `CUSTOM` (maximum 64 UTF-8 characters). `click_id`, match keys, metadata, and test ID
are optional. For revenue events, Reddit documents nonnegative `metadata.value` and ISO 4217
`metadata.currency`; this example omits value because it is a lead event.

The direct-integration guide distinguishes delivery age from deduplication: events must be
delivered within seven days, while proper channel-scoped deduplication uses the same event type
and custom name within two days. The 64-character limit is UTF-8 characters, not bytes. Its
opening language says some match keys are required, while its form presents all match keys as
optional; the reviewed sources therefore do not establish a universal minimal match-key subset.

## Source register and remaining questions

All URLs below were retrieved or checked on **2026-09-08**. The dated page/version is included
where the source publishes one.

### Google

- [events.ingest REST method](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest) (updated/reference current at review): endpoint, request fields, 2,000-event limit, `validateOnly`, RFC 3339 event timestamp, and `conversionValue` number.
- [Destination](https://developers.google.com/data-manager/api/reference/rest/v1/Destination) (updated 2026-02-17): operating account, optional login/linked account, and required product destination ID.
- [UserData](https://developers.google.com/data-manager/api/reference/rest/v1/UserData) (updated 2026-07-28) and [format user data](https://developers.google.com/data-manager/api/devguides/concepts/formatting) (updated 2026-07-30): hash/encoding, E.164 phone, at-least-one identifier, and max 10 identifiers.
- [Consent](https://developers.google.com/data-manager/api/reference/rest/v1/Consent) (updated 2025-03-06): optional DMA consent statuses.
- [Send events](https://developers.google.com/data-manager/api/devguides/events/send-events) (current at review): Google Ads deduplication within a conversion action, Google Ads required signal guidance, and explicit separation from GA4 age rules.
- [Google Ads field mapping](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings) (updated 2026-07-30): Data Manager authentication and `UploadClickConversion` mapping.
- [Google Ads conversion category warning](https://developers.google.com/google-ads/api/docs/conversions/categories) (current at review): new `UploadClickConversion` developer-token restriction beginning 2026-06-15.

Open: Google does not publish a transaction ID length or deduplication expiry in the reviewed
Data Manager sources. Confirm any adapter-side length cap from an accepted provider response or a
new official schema before enforcing one.

### Meta

- [Official Facebook Business SDK README](https://github.com/facebook/facebook-nodejs-business-sdk/blob/v25.0.1/README.md), release `v25.0.1` (2026-03-30): server-side event example, Graph API use, test event code, and SDK normalization statement.
- [Official `server-event.js` source at v25.0.1](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/server-event.js): event fields, seconds timestamp, action-source enum comment, and event ID + event name identity description.
- [Official `user-data.js` source at v25.0.1](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/user-data.js): supported user data fields and normalization/hash handoff.
- [Official `event-request.js` source at v25.0.1](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/event-request.js): Graph URL shape, POST, public headers, body envelope, access token parameter, and test field.
- [Official `custom-data.js` source at v25.0.1](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/custom-data.js): numeric value and ISO currency normalization.

Open: Meta's current server-event documentation, formal required-field matrix, event ID maximum,
and deduplication window were not confirmed from the reviewed official pages. The SDK evidence
supports the wire fields and identity pairing only; it must not be expanded into invented limits.

Supplemental official evidence: the [fbsamples Lead Ads webhook sample](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Conversions%20API%20%28Part%201%20-%20online%29.postman_collection.json)
(sample collection, responses dated January 2022) describes website events with
`client_user_agent`, `action_source`, and `event_source_url`; in its non-website contextual
subset it calls out `action_source`. This older sample supplements current v25.0.1 SDK wire-field
evidence; it does not confirm today's complete requiredness or deduplication rules.

### TikTok

- [TikTok API for Business API reference](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521): current v1.3 base URL and `/event/track/` Events API 2.0 endpoint.
- [Official Payload Helper](https://business-api.tiktok.com/payload_helper/): required event/event time, event ID recommendation, envelope, user fields, click ID, timestamp seconds, currency, value, and limited-data-use control.
- [Official event deduplication help](https://ads.tiktok.com/help/article/event-deduplication?lang=en) (last updated May 2025): event ID requirement for overlapping Pixel/API events and 48-hour/5-minute deduplication windows.

Open: the current dynamic Events API reference does not expose a stable field-length table in
the reviewed source. No adapter-side length cap should be inferred from the helper UI.

### LinkedIn

- [Conversions API](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api?view=li-lms-2026-08), last updated 2026-08-26: endpoint, headers, permissions, body, success status, and 90-day validation error.
- [Conversions API schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema?view=li-lms-2026-07), last updated 2026-08-26: event fields, amount string, milliseconds, supported identifier types, validation, and 90-day rule.
- [Deduplication](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/deduplication?view=li-lms-2026-06): same-account same-event-ID browser/server deduplication.
- [Conversions API use cases](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/conversions-usecase?view=li-lms-2026-07): `li_fat_id` mapping to `LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID`.

Open: current LinkedIn sources do not publish an event ID maximum or deduplication time window.
The 90-day limit is an ingestion timestamp validity rule, not a deduplication window.

### Reddit

- [Post Conversion Events v3](https://ads-api.reddit.com/docs/v3/operations/Post%20Conversion%20Events): endpoint, headers/auth, body required fields, 1–1000 event limit, milliseconds, metadata types/ranges, and custom-name limit.
- [Direct integration guide](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration): match-key formatting/hash guidance, metadata, LDU control, test ID, and deduplication behavior.
- [Direct integration delivery and deduplication guidance](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration): seven-day delivery requirement, channel-scoped two-day proper-deduplication condition, and 64 UTF-8-character custom-name limit. Its opening “some required” match-key wording and optional-key form do not establish one universal minimal subset.
- [Verify Conversion Events](https://ads-api.reddit.com/docs/v3/capi-verify-events): official test-event verification flow.

Open: Reddit does not publish a conversion ID maximum in the reviewed v3 sources. The documented
seven-day rule is the delivery-age requirement; the two-day rule is for proper channel-scoped
deduplication, not a universal event-ingestion rejection window. The adapter should preserve
provider responses rather than silently classify older events.

## Review questions for the adapter design

1. For each provider, should the adapter reject an unknown common value before sending, or omit
   provider money fields and let the provider's documented default/omission semantics apply? This
   record recommends omission but cannot promise that reporting remains unknown.
2. Google and LinkedIn publish no deduplication expiry. What operational replay horizon should be
   used by the outbox without mislabeling it as a provider guarantee?
3. Meta's SDK source exposes `fbc` and `fbp`; the shared click selector currently selects `fbclid`
   and the helper builds `fbc`. Confirm whether the Meta adapter should send only `fbc`, or also a
   separately captured `fbp` when available.
4. LinkedIn's current schema has no phone identifier. Confirm that the adapter intentionally
   omits the shared phone hash rather than attempting an unsupported `idType`.
5. TikTok's payload helper exposes optional `ttp`, IP, and user agent. Confirm whether those
   signals are outside this helper subset and therefore excluded from the first adapter.

## Implemented Meta subset note

The pure payload builder now uses the pinned SDK's
[server-event wire fields](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/server-event.js),
[user-data shape](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/user-data.js),
and [access-token request parameter](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/v25.0.1/src/objects/serverside/event-request.js).
It emits seconds, exact event name/ID, action source, optional processing flags and the selected
fbclid's capture-time fbc. Website URL/user-agent requiredness and at least one supported match
key are explicit local adapter policies; they are not a complete server-requiredness claim.
The builder excludes existing-cookie-only routing and fbp, retains false/zero controls, and never
accepts credentials or sends events. See [payload-contract.md](payload-contract.md) for exact
configuration, omission and blocking behavior. Existing uncertainties about live validation,
ID limits and deduplication time remain unchanged.

## Implemented TikTok web subset note

The [current official Payload Helper](https://business-api.tiktok.com/payload_helper/) serves
[this versioned schema asset](https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/deploy/victorwang/payload_helper/85369/static/js/async/page.16e9e6c6.js).
It declares event-level `limited_data_use` as boolean and email/phone as hash-required strings
or string arrays. Its standard-event suggestions permit customization and are not a closed
server enum. The pure builder selects scalar hashes and arbitrary exact event names.

The [official GTM implementation pinned at 089e34e](https://github.com/tiktok/gtm-template-eapi/blob/089e34eef2e02f8b12a50e9180d958fdb15e6f25/template.tpl)
confirms the v1.3 `event/track/` envelope, scalar hashes, `Access-Token` header, page context and
top-level test code. That older template extracts URL/cookie clicks itself; the reviewed sources
do not establish that the API server performs the same extraction. Our builder exclusively uses
the common selected qualified click. It does not replicate template extraction or current-clock
substitution. No new ingestion-age, event-ID length or pixel/account syntax rule is inferred.
See [payload-contract.md](payload-contract.md) for exact omission, validation and metadata.

## Implemented Reddit subset note

The [current official operation](https://ads-api.reddit.com/docs/v3/api/post-conversion-events)
serves its [request schema in this public module](https://ads-api.reddit.com/docs/assets/js/cd024ded.483cf450.js).
It specifies integer-millisecond event_at, nine tracking types, four action sources, string pixel
ID, numeric nonnegative value, and `user.data_processing_options` with modes/country/region.
The [direct-integration guide](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration)
requires country for LDU, allows optional region, distinguishes seven-day delivery from two-day
proper deduplication, and explicitly documents event_source_url click fallback.

The pure builder omits supplied event URLs whenever no qualified rdt_cid was selected, recording
a warning; it never derives a click from a URL. It enforces exact seven-day age using the supplied
as-of boundary and uses a local JSON pair for standard/custom destination identity. Lexical LDU
code validation does not replace an ISO/provider validity database. See
[payload-contract.md](payload-contract.md) for the bounded supported fields, local match-key
policy, token metadata and unknown-money handling. No provider requests or new outbox integration
were executed by this step.

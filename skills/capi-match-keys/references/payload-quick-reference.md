# Provider payload quick reference

This compact operational reference describes the accepted local builder subset. Read the
[full payload contract](payload-contract.md) for detailed validation and
[provider API evidence](provider-api-evidence.md) for reviewed primary sources and uncertainties.
It is not a complete server schema or an acceptance/authorization guarantee.

## Common interface

`provider-payloads.mjs` exports `buildGooglePayload`, `buildLinkedInPayload`, `buildMetaPayload`,
`buildTikTokPayload`, and `buildRedditPayload`. Every call takes exactly
`{preparation_input, identity: {email, phone}, configuration}`. Email/phone are raw strings or
null. Each builder calls actual `prepareConversion` with its matching platform, then calls
`hashPlatformIdentity` once per identity kind. No asserted preparation, prehashed-input mode,
implicit clock, URL click selection, identity join, mutation, credentials or network call exists.

Use the [conversion contract](conversion-contract.md) for qualified conversion/click references,
four-field scope bindings, inclusive time bounds and selection order; the [key contract](key-contract.md)
for exact normalization. Provider hashes never become canonical person-merge evidence.
All input is plain acyclic data; unknown configuration fields and omitted required configuration
keys throw TypeError, even for blocked preparation. Every nullable field below is required in
configuration and uses explicit null for absence. Malformed raw identity becomes a null hash.
No names, IP, arbitrary headers or other identity fields are accepted.

Exact text means nonempty, already trimmed, well-formed Unicode without C0/C1 controls.
Digit IDs mean nonempty ASCII digits, preserving leading zeros. URL means exact absolute
HTTP/HTTPS string with hostname and no embedded credentials. Configuration ownership and
active API versions remain caller responsibilities.

All results contain `{status,reasons,preparation,destination,request,authorization,diagnostics}`.
`preparation` is the complete actual helper result. `destination` always has
`{platform,account_key,destination_key,event_type}`. Ready status is `ready`; any reason gives
`blocked` and null request. Ready request has `{method,url,headers,body,request_body}`;
method is POST, and request_body is exactly JSON.stringify(body) in stable construction order.
The body uses preparation.event_id, preserving browser overrides; the separate business ID
is retained in preparation for outbox uniqueness.

Diagnostics always have exactly `{money_omitted,timestamp_precision_loss,warnings}`.
Money status `known` requires currency and an amount; zero is emitted. Unknown/mixed values
block under `money_policy: 'require_known'` with `unknown_value`; `omit_unknown` omits both
amount and currency, sets money_omitted true, and warns `provider_value_defaults_may_apply`.
No zero fill or FX conversion occurs. Negative amounts block with
`negative_value_requires_adjustment`; negative zero is zero. Except LinkedIn, a decimal string
is converted to a JSON number only if the input's exact decimal value equals the decimal value
of JSON.stringify(Number(value)); otherwise `value_precision_loss`. Finite Number inputs retain
Number semantics. LinkedIn preserves supplied decimal strings, including trailing zeros, and
expands Number exponent notation to decimal text. Amount/currency are always paired.

Reasons are ordered: common preparation reasons; provider time reason if applicable;
`no_match_keys`; money reason. Match minimums below are explicit local subset policies, not
universal provider-requiredness claims. Diagnostics describe representation even if blocked.
Warnings are ordered: omitted money; timestamp precision; platform-specific omission.
Precision warnings are `timestamp_truncated_to_seconds` or
`timestamp_truncated_to_milliseconds`; the flag is true only if that reduction loses precision.
Google preserves timestamp text and does not set the reduction flag. Floor always means
mathematical floor, including negative epochs. Caller as_of is the age anchor, never current time.

## Google Data Manager

Exact configuration keys:
`account_id`, `conversion_action_id`, `login_account_id`, `linked_account_id`, `event_source`,
`consent`, `validate_only`, `money_policy`.
Account/action IDs are digits; login/linked IDs are nullable digits. Event source is `WEB`, `APP`,
`IN_STORE`, `PHONE`, `MESSAGE`, or `OTHER`. Consent is null or exactly
`{ad_user_data,ad_personalization}`, each one of `CONSENT_GRANTED`, `CONSENT_DENIED`,
`CONSENT_STATUS_UNSPECIFIED`. validate_only is Boolean. There is no implicit consent grant.

Destination: `{platform:'google', account_key:account_id,
destination_key:conversion_action_id, event_type:'conversion'}`. The configured action defines
semantics; mutable stage/campaign labels cannot split this domain.

```text
body = {
  destinations: [{
    operatingAccount: {accountType:'GOOGLE_ADS',accountId:account_id},
    productDestinationId:conversion_action_id, reference:'ad_destination',
    loginAccount?:{accountType:'GOOGLE_ADS',accountId:login_account_id},
    linkedAccount?:{accountType:'GOOGLE_ADS',accountId:linked_account_id}
  }],
  events: [{
    destinationReferences:['ad_destination'], transactionId:preparation.event_id,
    eventTimestamp:conversion.occurred_at, eventSource:event_source,
    userData?:{userIdentifiers:[{emailAddress:email_hash}?,{phoneNumber:phone_hash}?]},
    adIdentifiers?:{gclid?,gbraid?,wbraid?},
    consent?:{adUserData:ad_user_data,adPersonalization:ad_personalization},
    conversionValue?:numeric_value, currency?:currency
  }], encoding:'HEX', validateOnly:validate_only
}
```

`?` denotes conditional presence, not literal wire text or a null placeholder. Email precedes
phone; selected ad identifiers are gclid, gbraid, wbraid in that order. Omit empty userData and
adIdentifiers; one supported hash or selected click is required. Google email removes whitespace
and removes local dots/plus suffix only for Gmail/Googlemail; phone hashes E.164 including `+`.
Original RFC3339 timestamp text is retained, including offset and nanoseconds, but its exact UTC
instant must be within years 0001–9999; otherwise `provider_timestamp_out_of_range`. No added
GA4 age rule applies. POST `https://datamanager.googleapis.com/v1/events:ingest`; public
Content-Type application/json. Authorization metadata: mechanism `oauth2_bearer`, header
`Authorization`, scopes `['https://www.googleapis.com/auth/datamanager']`. Enabled UPLOAD_CLICKS
action, access/links and ownership require caller preflight. validateOnly controls remote
validation if later sent; local construction itself sends nothing.

## LinkedIn

Exact configuration: `account_id`, `conversion_rule_id`, `api_version`, `money_policy`.
IDs are digits; version is explicit YYYYMM, year 2000–9999 and month 01–12. Syntactic version
validity does not establish current support. Destination uses platform linkedin, account ID,
rule ID as destination_key, and fixed event_type `conversion`.

```text
body = {
  conversion:'urn:lla:llaPartnerConversion:'+conversion_rule_id,
  conversionHappenedAt:floor_epoch_milliseconds, eventId:preparation.event_id,
  user:{userIds:[{idType:'SHA256_EMAIL',idValue:email_hash}?,
                {idType:'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID',idValue:selected_li_fat_id}?]},
  conversionValue?:{currencyCode:currency,amount:decimal_string}
}
```

Email removes whitespace, preserves dots/aliases; phone is unsupported. Email precedes selected
li_fat_id, and at least one is required. Wire time floors milliseconds; submillisecond precision
warns. Exact age strictly greater than 90 days blocks with `provider_event_too_old` before
rounding; the boundary is inclusive. Common event-age/future rules still apply.
POST `https://api.linkedin.com/rest/conversionEvents`; public headers Content-Type application/json,
Linkedin-Version api_version, X-Restli-Protocol-Version `2.0.0`. Authorization: `oauth2_bearer`,
header Authorization, scopes `['rw_conversions','r_ads']`. Caller verifies enabled CONVERSIONS_API
rule/account ownership, roles and active version. Browser/server dedup uses the same account and
event ID; no undocumented server-to-server exactly-once window is inferred.

## Meta

Exact configuration: `account_id`, `pixel_id`, `api_version`, `event_name`, `action_source`,
`event_source_url`, `client_user_agent`, `test_event_code`, `data_processing`, `opt_out`,
`advertiser_tracking_enabled`, `money_policy`.
IDs are digits. Version matches `v` + positive integer major without leading zero + `.` +
nonnegative integer minor. Event name is exact text. Action source is `physical_store`, `app`,
`chat`, `email`, `other`, `phone_call`, `system_generated`, or `website`. URL is nullable URL;
UA/test code are nullable exact text. Website requires URL and UA under local adapter policy.
Other sources may omit them. Processing is null or exact `{options,country,state}`, with options
`[]` or `['LDU']` and nonnegative safe integer country/state. opt_out and tracking are nullable
Booleans. False flags and zero country/state codes remain present.

Destination uses meta/account/pixel/exact event_name. Seconds floor sets precision warning when
needed; no additional ingestion-age rule is invented.

```text
body = {data:[{
  event_name, event_time:floor_epoch_seconds, event_id:preparation.event_id, action_source,
  user_data:{em?:[email_hash],ph?:[phone_hash],fbc?,client_user_agent?},
  event_source_url?, custom_data?:{value:numeric_value,currency},
  data_processing_options?:options, data_processing_options_country?:country,
  data_processing_options_state?:state, opt_out?, advertiser_tracking_enabled?
}],test_event_code?}
```

Meta email preserves dots/aliases; phone hashes digits without `+`. FBC uses actual selected
fbclid and its occurred_at capture timestamp through buildMetaFbc, never conversion/send time.
If unrepresentable, omit fbc and warn `fbc_unrepresentable` after money/time warnings. At least
one hash or usable fbc is needed; UA alone does not qualify. Existing-cookie-only matching and
fbp are outside this builder, though the key helper separately supports existing cookies.
POST `https://graph.facebook.com/{api_version}/{pixel_id}/events`; Content-Type/Accept
application/json. Authorization metadata: mechanism `graph_access_token`, parameter
`access_token`, scopes `[]`. A separately authorized transport supplies the token; it never
appears in builder URL/body/result. No current server-requiredness or dedup-age guarantee.

## TikTok web

Exact configuration: `account_id`, `pixel_id`, `event_name`, `page_url`, `page_referrer`,
`client_user_agent`, `test_event_code`, `limited_data_use`, `money_policy`.
IDs and event name are opaque exact text; custom names are allowed, with no invented numeric,
prefix or closed-name restriction. Page/referrer are nullable URLs; referrer requires page URL.
UA/test code are nullable exact text; LDU is nullable Boolean, preserving false.
Destination is tiktok/account/pixel/event_name. Time floors seconds with precision warning;
no extra ingestion-age limit is added.

```text
body = {event_source:'web',event_source_id:pixel_id,data:[{
  event:event_name,event_time:floor_epoch_seconds,event_id:preparation.event_id,
  user:{email?:email_hash,phone?:phone_hash,ttclid?:selected_ttclid,user_agent?:client_user_agent},
  page?:{url:page_url,referrer?:page_referrer}, properties?:{value:numeric_value,currency},
  limited_data_use?
}],test_event_code?}
```

Email preserves dots/aliases; phone hashes E.164 with `+`; hashes are scalar strings. Require a
hash or actual selected ttclid. Page/referrer/UA are context and never qualify as keys. No URL,
cookie, IP or external-ID selection is added; reviewed sources do not establish server URL
extraction. POST `https://business-api.tiktok.com/open_api/v1.3/event/track/`, not pixel/track.
Content-Type/Accept application/json. Authorization: mechanism `access_token`, header
`Access-Token`, scopes `[]`. Published event/event_id dedup timing is not an ingestion-age rule.

## Reddit

Exact configuration: `account_id`, `pixel_id`, `tracking_type`, `custom_event_name`, `action_source`,
`event_source_url`, `test_id`, `data_processing`, `money_policy`.
IDs are opaque exact text. Tracking type is `PAGE_VISIT`, `VIEW_CONTENT`, `SEARCH`, `ADD_TO_CART`,
`ADD_TO_WISHLIST`, `PURCHASE`, `LEAD`, `SIGN_UP`, or `CUSTOM`. Custom name is exact text of at
most 64 Unicode code points iff CUSTOM; otherwise null. Source is `WEBSITE`, `APP`, `OTHER`,
`PHYSICAL_STORE`. Nullable URL is allowed only for WEBSITE; test ID is nullable exact text.
Processing is null or exact `{modes,country,region}`: modes exactly `['LDU']`, country two uppercase
ASCII letters, region null or 1–3 uppercase alphanumerics optionally prefixed by that country and
`-`. These are lexical ISO shapes, not a complete code database. Omit null region on the wire.

Destination uses reddit/account/pixel and event_type
`JSON.stringify([tracking_type,custom_event_name])`, a local collision-safe encoding, not a
provider wire field. Time floors milliseconds with precision warning. Age strictly greater than
seven days relative to as_of blocks `provider_event_too_old`; inclusive boundary uses exact
nanoseconds. Documented two-day dedup timing is not an ingestion filter.

```text
body = {data:{events:[{
  event_at:floor_epoch_milliseconds,action_source,type:{tracking_type,custom_event_name?},
  click_id?:selected_rdt_cid,
  user?:{email:email_hash?,phone_number:phone_hash?,data_processing_options?:{modes,country,region?}},
  metadata:{conversion_id:preparation.event_id,value?:numeric_value,currency?},event_source_url?
}],test_id?}}
```

Email removes local dots/aliases on every domain; phone hashes E.164 with `+`. Require a hash or
actual selected rdt_cid. Omit user if neither hash nor LDU exists. Because Reddit documents URL
click fallback, include supplied URL only with a qualified selected rdt_cid; otherwise omit it
and warn `event_source_url_omitted_without_selected_click` after money/time warnings, even for
benign-looking URLs. Never derive a click from URL/cookie/IP/UA. The prepared event ID always
remains in metadata. POST `https://ads-api.reddit.com/api/v3/pixels/{encoded_pixel_id}/conversion_events`
using encodeURIComponent(pixel_id), while preserving the original destination key.
Content-Type/Accept application/json. Authorization: mechanism `conversion_access_token`, header
Authorization, scheme `Bearer`, scopes `[]`. Provider account/pixel ownership and acceptance
remain unverified by construction.

## Durable delivery boundary

Use [provider-outbox](provider-outbox-contract.md) inside a caller-owned pinned business
transaction. The outbox stores exact body bytes, IDs and destination, not URL/headers/version or
credentials. Commit claims before sending; retry original stored UTF-8 bytes with current
worker/token fencing. Keep routing immutable outside the outbox and reconcile ambiguous remote
outcomes. A ready payload, local HTTP stub success or native commit proves no provider acceptance.

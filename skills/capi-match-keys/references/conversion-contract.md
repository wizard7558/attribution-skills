# Common conversion events and click eligibility

Version `0.1.0`, reviewed 2026-09-08. This layer projects native business events, assigns stable
business IDs, and selects explicitly linked click observations. It does not build provider
requests, hash customer identities, send conversions, enforce outbox idempotency, or infer
person/lead joins. Those responsibilities belong to their respective layers.

The module is `scripts/conversion-events.mjs`, with three named exports:
`makeConversionId`, `conversionFromStage`, and `prepareConversion`. It uses only Node built-ins
and this skill's `scripts/match-keys.mjs`. The thirteen canonical click names are a local schema
enum aligned with the shared attribution vocabulary; there is no sibling-skill runtime import
and no copied classifier or normalizer implementation.

## Input and identity rules

Inputs are plain data records (ordinary objects or objects with a null prototype). Collections
are dense ordinary arrays without additional properties. All input data, including unused
extra fields and excluded rows, is checked for cycles, nonfinite numbers, accessors, symbols,
functions, BigInts, and nonplain runtime objects such as Date, Map, or class instances. These
are rejected with `TypeError`. Accessors are rejected without evaluating them. Optional
undefined properties are allowed; required fields still undergo their own validation.

Qualified keys are nonempty exact strings with no surrounding whitespace or control characters
(U+0000–U+001F and U+007F–U+009F). No trimming, lowercasing, decoding, or delimiter concatenation
is performed. Internal ordinary spaces are retained in qualified keys. A key is a declared
source-native identifier: callers must not substitute an email, phone, IP address, or other
raw personal identity for a business event key. Extra personal fields are never projected,
hashed into IDs, or included in error messages.

Timestamps are exact strings of the form `YYYY-MM-DDTHH:mm:ss[.fraction]Z` or the same form with
a signed `HH:mm` offset. Fraction precision is 1–9 digits. Gregorian days and leap years are
validated before parsing; hours are 0–23, minutes/seconds 0–59, and offsets cannot exceed 14:00.
There is no date rollover, 24:00, leap-second, offset-free, or current-time fallback. ISO years
0000–9999 are accepted when calendar-valid; the business-event policy determines eligibility.
Original timestamp text is preserved in outputs. Comparisons retain all nine fractional digits
using integer nanoseconds, including offset-equivalent instants and negative Unix epochs.

## `makeConversionId({ source_system, source_scope, conversion_key })`

Returns lowercase, 64-character SHA-256 of the UTF-8 bytes of exactly:

```js
JSON.stringify(['conversion', 1, source_system, source_scope, conversion_key])
```

The three qualified identity fields are required. Timestamp, value, currency, subject/customer
identity, platform, browser event ID, and destination metadata do not participate. JSON tuple
encoding separates delimiter-bearing keys without collisions caused by concatenation.
Retries and changes to mutable facts retain the same business ID.

## `conversionFromStage(row)`

Consumes this projection of the actual native `stage_truth` ledger:

| Field | Required type |
| --- | --- |
| `source_system`, `source_scope`, `lead_key`, `stage_key` | Qualified key string |
| `achieved` | `true`, `false`, or `null` |
| `stage_entered_at` | Calendar-valid timestamp string or `null` |
| `is_attribution_primary` | Boolean |
| `value`, `currency`, `value_status` | Monetary contract below |

Additional ledger fields are allowed and validated as plain data, but not emitted. The adapter
does not reproduce the SQL stage engine. It validates every required field even when achievement
is false, unknown, or undated. `is_attribution_primary: false` does not suppress an achieved
business event; primary-row selection is a separate ad-attribution policy.

| Native truth | Returned `status` | `conversion` / `business_conversion_id` |
| --- | --- | --- |
| `achieved: true`, timestamp present | `eligible` | Projected conversion / stable ID |
| `achieved: true`, timestamp null | `undated` | `null` / `null` |
| `achieved: false` | `not_achieved` | `null` / `null` |
| `achieved: null` | `stage_unknown` | `null` / `null` |

An eligible conversion has exactly `source_system`, `source_scope`, `conversion_key`,
`occurred_at`, `subject_source_system`, `subject_source_scope`, `subject_key`, `value`, `currency`,
and `value_status`. Its conversion key is `JSON.stringify([lead_key, stage_key])` and its
`occurred_at` is exactly `stage_entered_at`. All three subject fields are null. A lead key never
implicitly becomes a person key. Cohort timestamps and processing/send time are not substitutes.

Later changes to a won aggregate's value or timestamp retain the same business ID. A caller
must use an explicit adjustment or conflict process for changed accepted facts, not mint a
replacement event ID to evade deduplication.

## Monetary contract

| `value_status` | `value` | `currency` |
| --- | --- | --- |
| `known` | Finite JS number or canonical decimal string | Uppercase three-letter string |
| `unknown` | Exactly `null` | Exactly `null` or uppercase three-letter string |
| `mixed_currency` | Exactly `null` | Exactly `null` |

A numeric integer must be a safe JS integer; a finite noninteger number is permitted, including
numbers represented in scientific notation. A decimal string matches
`^-?(?:0|[1-9][0-9]{0,28})(?:\.[0-9]{1,9})?$`: up to 29 integer and nine fractional digits, no
exponent, plus prefix, leading integer zeros, or whitespace. Fractional trailing zeros and
negative zero spellings are retained. Strings are never converted to float, rounded, or
reformatted. Negative amounts are preserved at this common boundary. Known zero is distinct
from unknown; no zero fill or FX conversion occurs. Provider payload builders must separately
validate their numeric range and negative-value rules.

## `prepareConversion({ conversion, platform, browser_event_id, click_observations, policy })`

`conversion` follows the ten-field conversion interface described above. The subject triple
may be omitted or entirely null (normalized to three nulls), or supplied as three exact
qualified strings. A partial non-null triple is invalid. Any non-null subject must be backed by
an explicit caller identity relationship; this function does not infer it. Extra fields are
validated but not emitted. `platform` must be one of this skill's `SUPPORTED_PLATFORMS`:
`meta`, `google`, `tiktok`, `linkedin`, or `reddit`.

A non-null `browser_event_id` is preserved as an exact nonempty opaque key, with no surrounding
whitespace or controls and no hashing or truncation. Omitted, undefined, or null uses the
business conversion ID. Explicit blank or wrong-type values throw. The returned
`business_conversion_id` remains separate from `event_id` so an outbox can enforce one accepted
event ID for each business conversion across retries. This function alone does not enforce
that persistence rule.

### Required caller policy

| Field | Type and meaning |
| --- | --- |
| `as_of` | Calendar-valid timestamp; no implicit clock read |
| `max_event_age_days` | Positive finite JS number |
| `click_lookback_days` | Positive finite JS number |
| `click_scope_bindings` | Array, possibly empty, of exact four-field bindings |

Each binding has exactly `conversion_source_system`, `conversion_source_scope`,
`click_source_system`, and `click_source_scope`, each a qualified exact key. No wildcard or
implicit same-account binding exists. Duplicate identical bindings collapse; the policy summary
sorts them by UTF-8 byte order of the JSON tuple in the field order above. Unused bindings are
still validated.

Limits are declared caller policy, **not claims about provider API limits**. Their standard JS
number decimal spelling is interpreted as a rational number of 86,400-second days. Exact rational
comparisons avoid both huge-number overflow and submillisecond rounding. The event is eligible
at the inclusive boundaries `as_of - max_event_age_days` and `as_of`. A future event returns
`ineligible` with `reasons: ['future_event']`; an older event returns
`ineligible` with `reasons: ['event_too_old']`. Eligible events have `status: 'ready'` and `reasons: []`.

### Click observation input and canonicalization boundary

Every observation requires exactly these declared fields (additional plain data fields may be
present but are not projected): `source_system`, `source_scope`, `click_key`, `occurred_at`,
`kind`, `value`, `conversion_source_system`, `conversion_source_scope`, and `conversion_key`.
The six identity/reference fields are qualified exact keys; `occurred_at` is a valid timestamp.

`kind` is one of `dclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`, `ttclid`, `rdt_cid`,
`li_fat_id`, `twclid`, `epik`, `sccid`, or `srsltid`. Values must already be canonical opaque
nonempty strings without whitespace, controls, or case-insensitive placeholders (`null`,
`undefined`, `[object Object]`, `n/a`, `na`, `none`). Source adapters must apply the source's
canonicalization once before this boundary. This module never percent-decodes or changes case
or `+`; even a remaining percent escape is preserved exactly, preventing a second decode.

Exact duplicates collapse by `(source_system, source_scope, click_key)` when all nine declared
field values match. Different declared content under the same qualified key throws, even if
the row would otherwise be excluded. Equivalent instants with different timestamp text are
still conflicting observations under one key. Extra metadata does not affect equality. All
rows and extras are validated before any event or click exclusion.

Selection requires an exact three-field conversion reference and an explicit four-field scope
binding. The allowed click kinds per destination are:

| Platform | Selectable kinds |
| --- | --- |
| Meta | `fbclid` |
| Google | `gclid`, `gbraid`, `wbraid` |
| TikTok | `ttclid` |
| LinkedIn | `li_fat_id` |
| Reddit | `rdt_cid` |

Eligible clicks fall in the inclusive interval
`[conversion.occurred_at - click_lookback_days, conversion.occurred_at]`. Choose the latest
eligible observation independently for each kind. Equal instants choose the first full qualified
click key by ascending UTF-8 byte order of `JSON.stringify([source_system, source_scope, click_key])`.
There is no locale ordering or newest-person heuristic. Selection is computed even for an
ineligible event so diagnostics remain available; `status` still prevents treating it as ready.

### Complete return shape and diagnostics

The result has exactly `status`, `reasons`, `event_id`, `business_conversion_id`, `conversion`,
`selected_clicks`, `click_diagnostics`, and `policy`.

`selected_clicks` is sorted by kind and each row has exactly `kind`, `value`, `occurred_at`,
`source_system`, `source_scope`, and `click_key`. These are selected observations, not inferred
customer identities or evidence that the provider will accept the event.

`click_diagnostics` has `input_count`, `unique_count`, `duplicate_count`, `selected_count`,
`excluded_count`, `excluded`, and `no_selected_clicks`. Counts are row counts; exact duplicates
are counted separately, and `unique_count = selected_count + excluded_count`.
`excluded` is sorted by the same qualified byte key and contains only `source_system`,
`source_scope`, `click_key`, and `reason`, never the excluded raw value. Each unique unselected
row receives the first applicable reason in this precedence:

1. `unrelated_conversion`: the three-field business reference differs.
2. `unbound_click_scope`: no exact source binding exists.
3. `unsupported_platform_kind`: the canonical kind is not eligible for this platform.
4. `future_click`: observation follows the conversion.
5. `click_too_old`: observation precedes the inclusive lookback interval.
6. `superseded`: another eligible observation won the kind's recency/tie comparison.

`no_selected_clicks: true` is informational, not an event-ineligibility reason. Provider identity
hashes may qualify a later payload even without selected click evidence. Unknown click evidence
is not fabricated. `policy` echoes `source: 'caller_supplied'`, `platform`, `as_of`,
`max_event_age_days`, `click_lookback_days`, and the sorted deduplicated `click_scope_bindings`.
No input is mutated and no raw identity is logged.

## Verification and fixture provenance

From this skill directory run `node scripts/test-conversion-events.mjs`. It uses only Node
built-ins, the local modules, and `references/conversion-fixtures.json`; no network, database,
SQL engine, credentials, or sibling fixture file is required.

The 28 full-output golden fixtures include five independent ID vectors, eight stage projections,
and fifteen preparation results. Every expected ID was independently pinned using Python
`hashlib.sha256` over the literal UTF-8 JSON tuple with compact separators and Unicode preserved.
Expected selections, reasons, statuses, and projected fields were specified without using the
implementation's outputs. Never regenerate goldens from the code being tested.

One native-stage integration fixture copies the literal expected ledger row from the sibling
stage suite's `complete-snapshot-stage-gaps` case. Its provenance is stored in the fixture. This
proves compatibility with that verified ledger shape; this conversion suite does **not** claim
a new SQL execution. The copied fixture makes standalone installation independent of the sibling.

The suite also checks malformed and nonplain runtime inputs, money precision, stable IDs after
mutable fact/destination changes, validation of unused records, inclusive microsecond/nanosecond
boundaries, 120 complete-output input permutations, input immutability, personal-field projection,
and full-output mutation guards for primary filtering, undated events, age rounding, browser IDs,
money coercion, source binding, click recency, and all five platform allowlists.

# CAPI match-key foundation

`normalizePlatformIdentity(platform, kind, value)` returns the provider-specific canonical
string or `null`. `hashPlatformIdentity(platform, kind, value)` returns the lowercase SHA-256
hex digest of that canonical UTF-8 string or `null`. Supported platforms are `meta`, `google`,
`tiktok`, `linkedin`, and `reddit`; kinds are `email` and `phone`. Unsupported enums throw
`TypeError`, even when the raw value is invalid. Non-string, empty, malformed, and placeholder
identities return `null`. Raw 64-character SHA-256 input is invalid and is never double-hashed.
These provider keys must never implicitly merge contacts in the core identity graph.

## Email contract

| Platform | Whitespace and case | Local dots and plus suffix |
| --- | --- | --- |
| Meta | Trim ends; lowercase; reject internal whitespace | Preserve |
| Google | Remove all JavaScript `\s` whitespace, including tabs/newlines; lowercase | Remove dots and everything from the first `+` only for `gmail.com` and `googlemail.com` |
| TikTok | Trim ends; lowercase; reject internal whitespace | Preserve |
| LinkedIn | Remove all JavaScript `\s` whitespace, including tabs/newlines; lowercase | Preserve |
| Reddit | Trim ends; lowercase; reject internal whitespace | Remove dots and everything from the first `+` for every domain |

After whitespace cleanup, email must have exactly one `@`, a nonempty local part, and a
nonempty dotted domain without empty labels. Remaining whitespace and control characters
(U+0000–U+001F, U+007F–U+009F) are rejected. This structural validation happens **before** alias
removal and again afterward: `a+bad@gmail.com@gmail.com` cannot become valid by dropping its
suffix, and alias removal cannot produce an empty local part. These are matching-key rules,
not an email deliverability check or a general cross-provider identity policy.

## Phone contract

Input must contain an explicit `+` country prefix. Formatting removal permits whitespace
other than control characters, parentheses, periods, and hyphens. A trailing extension may
use case-insensitive `ext`, `ext.`, or `x`, followed by one or more ASCII digits, with optional
whitespace before the marker, between the marker and digits, and after the digits. Examples
include `ext 9`, `EXT. 99`, and `x99`. `extension`, `#9`, missing extension digits, fractional
extensions, and nonterminal extensions are unsupported and return `null`.

After formatting and extension removal, require `+` followed by 8–15 ASCII digits with a
nonzero first digit. No national number or country inference is accepted. Google, TikTok,
and Reddit hash E.164 including `+`; Meta hashes the validated digits without `+`. LinkedIn
phone input always returns `null`. Phone input containing controls is rejected.

## Meta FBC contract

`buildMetaFbc({ fbclid, observed_at, existing_fbc })` preserves a valid existing cookie
byte-for-byte, including opaque appended SDK segments. Only `undefined` and `null` mean an
existing cookie is absent. Explicit blank, wrong-type, or malformed supplied cookies throw
`TypeError`; valid replacement inputs do not hide that error.

An existing cookie must have `fb.<subdomain>.<epoch milliseconds>.<click>[.<SDK suffix>...]`:
a nonnegative safe-integer subdomain, a positive safe-integer timestamp, a nonempty real first
click segment, and nonempty suffix segments. Whitespace and controls are forbidden. The first
click segment cannot be a case-insensitive placeholder (`null`, `undefined`, `[object Object]`,
`n/a`, `na`, or `none`). SDK suffix contents remain opaque. Numeric text is preserved, including
leading zeros. An unsafe integer or a huge numeric value that converts to infinity is invalid.

Without an existing cookie, trim `fbclid` before checking internal whitespace and controls.
Non-string, blank, placeholder, or empty-dot-segment click input returns `null`. Preserve case
and `+`, so ` Ab+C ` becomes `Ab+C`. A real click requires `observed_at` in the form
`YYYY-MM-DDTHH:mm:ss[.fraction]Z` or with a signed `HH:mm` offset; fraction precision is 1–9
digits, truncated to milliseconds. Validate Gregorian calendar days and leap years, hours
0–23, minutes/seconds 0–59, and offsets no greater than 14:00 before parsing. Date rollover,
24:00, leap seconds, offset 14:01, missing offsets, nonpositive epochs, and wrong types throw.
The result is `fb.1.<captured click epoch milliseconds>.<fbclid>`. An invalid or missing click
returns `null` without attempting to parse its timestamp.

Use the **click observation time**, never conversion or send time. This helper never generates
an `fbp`, invents a click identifier, sends a conversion, or checks click lookback/event age.
Those eligibility checks belong outside this step. Input objects are not mutated and identity
values are not logged or included in errors.

## Verification

From `skills/capi-match-keys`, run `node scripts/test-match-keys.mjs`. The fixture file contains
306 identity cases with literal canonical **and** hash expectations (including explicit nulls)
and 71 FBC cases. Hash literals were independently derived with Python 3
`hashlib.sha256(expected.encode('utf-8')).hexdigest()` from the literal canonical strings,
without importing or executing the implementation. The two published Reddit vectors are
separately pinned. Golden updates must use this independent process rather than implementation
output. The Node suite requires only built-in modules and logs case counts, never identities.

The suite asserts every canonical and hash result, malformed/unsupported input, provider
whitespace and alias behavior, phone length/extension boundaries, prehashed input, FBC capture
calendar/offset boundaries, existing-cookie preservation and rejection, and input immutability.
Its 21 mutation checks include faulty normalization, faulty phone hashing, hashed-null behavior,
and corrupted golden hashes for all five providers, plus an incorrect FBC capture epoch.

## Primary references

Provider rules were reviewed against these primary sources on **2026-09-08**. This helper is an
original implementation of the documented behavior; no provider source code is copied here.

- [Google Data Manager formatting](https://developers.google.com/data-manager/api/devguides/concepts/formatting), updated 2026-07-30.
- [Reddit CAPI direct integration](https://ads-api.reddit.com/docs/v3/guides/programs/capi/direct-integration), including published email and phone vectors.
- [TikTok Events API documentation](https://business-api.tiktok.com/gateway/docs/index?doc_id=1799004110681154).
- [LinkedIn Conversions API schema, July 2026 version](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api-schema?view=li-lms-2026-07).
- Meta CAPI parameter builder, pinned commit `9248ea676d96fb95d95bf7f5820f06286221afec`: [emailUtil.js](https://github.com/facebook/capi-param-builder/blob/9248ea676d96fb95d95bf7f5820f06286221afec/src/piiUtil/emailUtil.js), [phoneUtil.js](https://github.com/facebook/capi-param-builder/blob/9248ea676d96fb95d95bf7f5820f06286221afec/src/piiUtil/phoneUtil.js), and [ParamBuilder.js](https://github.com/facebook/capi-param-builder/blob/9248ea676d96fb95d95bf7f5820f06286221afec/src/ParamBuilder.js).

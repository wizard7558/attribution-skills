# CRM paid attribution contract

## Input

```js
attributeLeads(leads, {
  source_map: [{ source, medium, channel, network_id, campaign_key }],
  source_patterns: [{ id, priority, source_regex, medium_regex, channel, network_id, campaign_key }],
  ad_catalog: [{ source_system, source_scope, network_id, ad_key, campaign_key, ad_name }],
  ad_scope_bindings: [{ crm_source_system, crm_source_scope, ad_source_system, ad_source_scope, platform, entity_type }]
})
```

Each lead requires nonempty string `source_system`, `source_scope`, and `lead_key`, and
`created_at`: either `null` or an ISO timestamp with seconds and an explicit `Z` or numeric
offset. Naive timestamps, invalid calendar dates, invalid times/offsets, and missing dates
are structural errors. Lead identity strings cannot have surrounding whitespace. Duplicate
scoped lead keys are errors. A null date is allowed and sorts after every valid date. Optional fractional seconds have
1–9 digits. Four-digit years use the proleptic Gregorian calendar, including year 0000;
numeric offsets range through ±23:59. Compare instants at exact nanosecond precision:
first the whole UTC epoch second, then the fractional nanosecond (0–999999999).
Equivalent offset spellings represent the same instant. JavaScript and generated BigQuery
SQL use these two safe integer components without rounding to milliseconds. Preserve the
original timestamp string in output; internal ordering components are not public fields.

Leads may supply the five direct UTM fields (`utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, `utm_term`), `click_ids`, and `first_touch` containing the same UTM and
click fields. Tracking values must be strings to participate. Object, array, or boolean
values do not become IDs through string coercion.

All option collections are arrays when supplied; omitted collections mean empty arrays.
Required catalog and binding identities must be nonempty strings, including on unused
rows. The catalog requires `source_system`, `source_scope`, `network_id`, and `ad_key`.
Optional `campaign_key` and `ad_name` are nonempty strings or null/omitted. Catalog entities
are keyed by source system, scope, network, and ad key. Identical repeated entities are
deduplicated; conflicting campaign/name metadata for one entity is a configuration error.

## Source maps and normalization

`source_map` requires `source` (alias `utm_source`) and an exact canonical `channel` from
`CHANNELS`. `medium` (alias `utm_medium`) optionally narrows the match. An omitted or empty
medium matches any medium. A matching medium-specific row wins over a source-only row.
Conflicting rows with the same normalized source/medium key are errors; identical rows are
deduplicated. Source-map configuration cannot silently invent channels.

`source_patterns` requires a nonempty `id`, finite numeric `priority`, `source_regex`, and
canonical `channel`; `medium_regex` is optional. Lower numeric priority wins, with lexical
ID as a stable tie breaker. Identical repeated IDs are deduplicated; conflicting rows with
one ID, malformed regexes, missing priorities, and invalid channels are errors. Exact maps
win before any pattern. Optional map/pattern `network_id` and `campaign_key` must be nonempty
strings or null/omitted; campaign key case and literal plus are preserved.

Human join keys are normalized independently from raw input: up to five percent-decoding
passes, then plus-to-space, trim, and lowercase. This applies to lead UTM source/medium and
map values, and separately to raw `utm_content` and raw catalog `ad_name`. Never normalize an
already decoded value a second time. Opaque ad IDs and click IDs use up to five decoding
passes and trim while preserving case and literal plus. Invalid percent escapes stop
further decoding. Empty, encoded null/undefined, and object-sentinel click strings are not
paid evidence. Other nonempty click strings follow the canonical classifier's validation.

The canonical classifier always receives the selected **raw** tracking evidence and owns
its own five decoding passes. Its file is byte-identical to the shared taxonomy module.
Without an explicit map, use its channel and rule unchanged: unknown source plus email is
Email; unknown source plus CPC is Paid Other; unknown source alone falls back to Other.
Only the unmapped fallback has `quality_status=unmapped`. An explicit map is known evidence,
including an intentional canonical Other mapping. Missing tracking is Other/unattributed.

## Resolution and network routing

1. Current valid click IDs win in the order shown below.
2. With no current click, informative current UTM uses exact maps, patterns, then canonical
   raw UTM fallback. Current organic or unknown tracking blocks first-touch replacement.
3. With no informative current tracking, first-touch valid clicks win over first-touch UTM.
4. Without either source of tracking, return Other/unattributed.

| Click field | Network |
| --- | --- |
| `dclid` | `google_display` |
| `gclid` | `google_ads` |
| `gbraid` | `google_ads` |
| `wbraid` | `google_ads` |
| `msclkid` | `bingads` |
| `fbclid` | `facebook_ads` |
| `ttclid` | `tiktok_ads` |
| `rdt_cid` | `reddit_ads` |
| `li_fat_id` | `linkedin_ads` |
| `twclid` | `twitter_ads` |
| `epik` | `pinterest_ads` |
| `sccid` | `snapchat_ads` |

The selected click's network cannot be overridden by `lead.network_id` or a source map.
Maps apply only on the UTM resolution path. Canonical UTM channel resolution alone does not
infer an ad network/account; provide a source map or pattern with `network_id` to enable
UTM-only catalog joins. `srsltid` is retained in raw evidence and never establishes paid
traffic. Current clicks have channel confidence HIGH, known current UTM MEDIUM, known
first-touch evidence LOW, and unmapped/missing tracking UNMATCHED.

## Account authorization and ad matching

Bindings authorize exact CRM system/scope, ad system/scope, platform, and entity type.
`platform` equals the catalog `network_id`; catalog entries represent entity type `ad`, so
only the exact binding value `ad` applies. If the binding array is nonempty and no binding
applies, return unmatched with `ad_scope_method=binding_not_authorized`. Do not infer an
account in this situation. Applicable bindings restrict the catalog before matching.

Only an entirely empty binding array allows catalog account inference. One account for the
selected network permits inference, visibly marked `ad_scope_method=single_account_inference`.
Multiple accounts are ambiguous even if a bare ID appears unique; no account is selected.
Explicit scope selection uses `ad_scope_method=explicit_binding`. Account/network identities
are exact strings without surrounding whitespace; they are not URL-decoded or lowercased.

Within authorized scopes, exact opaque `utm_content` to `ad_key` is HIGH ad confidence.
If there is no exact ID match, normalized human ad-name matching is MEDIUM. Multiple best ID
or name candidates return ambiguous with null winning ad identity. Ad confidence describes
catalog evidence separately from channel confidence; neither proves spend or causality.

A unique catalog match supplies its `campaign_key`, preserving case and literal plus. If
that key is absent, use the selected explicit source-map/pattern campaign key when supplied;
otherwise return null. Ambiguous/unmatched ads may retain the explicit mapping campaign key,
but never select a campaign from one ambiguous catalog candidate.

## Output and attribution denominator

Every input lead remains in input order. Each result contains its CRM source identity,
`lead_key`, `created_at`, canonical `channel`, `taxonomy_version`, `rule`,
`attribution_basis=crm_paid_resolution`, `match_key`, `confidence`, `quality_status`,
`network_id`, `campaign_key`, `raw_evidence`, and `is_attribution_primary`.

Ad outputs are `ad_source_system`, `ad_source_scope`, `ad_key`, `ad_match_method`,
`ad_scope_method`, `ad_confidence`, `ad_match_status`, and sorted typed `candidate_ads`:

```js
[{ source_system, source_scope, ad_key, campaign_key }]
```

`candidate_ad_keys` is retained as a compatibility display field, but its colon-separated
strings are not authorization keys; downstream joins must use the typed identity fields.
An ambiguous or unmatched result has null winning ad source system, scope, and ad key.

`raw_evidence` includes only current/first-touch UTM strings, current/first-touch click
strings (including `srsltid`), and native-channel string. Invalid non-string values become
null. Arbitrary CRM fields or nested objects are never copied into tracking evidence.

Primary selection groups any selected current **or first-touch** click by CRM source system,
scope, click field, and exact cleaned opaque click value. The earliest valid date wins;
null dates sort last, then lexical lead key resolves exactly equal instants or tied null dates. Current and first-touch leads
sharing that scoped click compete in the same group. Different source identities, fields,
case, or literal-plus/space values remain separate. UTM-only and untracked leads are all
primary. Funnel totals use all rows; attribution denominators may filter to primary rows.
Unknown monetary values and status fields remain null in downstream marts.

## Checks

Run `node scripts/run-checks.mjs` for individually executed full API fixtures with golden
expected fields, structural failures, raw canonical parity, immutability, raw-evidence
privacy, and per-key permutation assertions. The optional first argument is an alternate
fixture JSON path. Run `node scripts/check-fixture-sensitivity.mjs` to verify that every
golden/error expectation independently fails when deliberately corrupted.

# Shared channels and observed session evidence

The embedded canonical taxonomy is version `0.1.0`, with exactly 11 labels: `Paid Search`, `Paid Social`, `Paid Other`, `Organic Search`, `Organic Social`, `Email`, `SMS`, `Direct`, `Referral`, `Affiliate`, and `Other`. Four session-family templates embed the same classifier and session reduction; installed copies need no sibling skill or external UDF. The [shared channel contract](channel-contract.md) defines interoperability boundaries.

## Evidence precedence

Valid paid click signals override conflicting email, organic and native-channel evidence. `dclid` maps to `Paid Other`; `gclid`, `gbraid`, `wbraid` and `msclkid` to `Paid Search`; `fbclid`, `ttclid`, `rdt_cid`, `li_fat_id`, `twclid`, `epik` and `sccid` to `Paid Social`. `srsltid` is retained but never establishes paid traffic alone.

The canonical classifier then considers paid network IDs and explicit paid-medium rules, useful native labels, non-paid source/medium, referrer evidence, justified Direct evidence, and finally `Other`. Missing evidence does not automatically mean Direct. Native `Unassigned` becomes `Other`; `Display`, `Paid Shopping`, `Cross-network`, `Paid Video` and `Audio` become `Paid Other`; `Organic Shopping` becomes `Organic Search`; `Organic Video` becomes `Organic Social`; `Affiliates` becomes `Affiliate`; `AI Assistant` becomes `Referral`. These are shared reporting rules, not a promise to reproduce every GA4 UI classification.

## Choose whole evidence records

For each event, choose its selected `cross_channel_campaign` struct when any consumed source, medium, campaign name or native-channel field is non-NULL. Only an all-NULL selected struct falls back to the same event's manual source/medium/campaign struct. Empty strings count as non-NULL. Across the observed session, select the earliest struct with any non-NULL field, ordered by event timestamp and deterministic selected-evidence JSON. Never fill a partial cross-channel pair from manual fields or independently aggregate source and medium across events.

No user-acquisition `traffic_source` field participates. Google documents the acquisition, collected-event and attributed-session fields separately in its [export schema](https://support.google.com/analytics/answer/7029846); their presence does not make those attribution scopes interchangeable.

The landing is the first event carrying a non-NULL `page_location`, otherwise the first observed event. Its referrer and collected click fields remain attached to that event. Blank or invalid non-NULL URLs still participate in landing selection. Later events cannot replace its click evidence.

The retained `click_ids` struct contains all 13 IDs listed above. Collected `gclid`, `dclid` and `srsltid` take priority when they are not exactly empty strings; this projection does not trim them. The other values come from the canonical landing-URL parser. The legacy `landing_gclid`, `landing_fbclid` and `landing_ttclid` aliases remain URL-only. URL click values retain encoded text after raw plus-to-space handling; classification validates/normalizes evidence separately. A retained raw collected value is not proof of a valid match key: the classifier can fall back to URL evidence when that value is unusable.

Canonical URL parsing ignores fragments, decodes keys with bounded decoding, and keeps the first duplicate key, including an empty first value. Landing UTM values use at most five decoding passes, preserve case, turn raw `+` into space and preserve an encoded plus as `+`. Do not replace these helpers with a different regex or decode policy.

## Source and date boundaries

Session identity is `(source_system, source_scope, session_key)`, where the local token combines the present visitor and selected integer session ID. The code does not separate platform or stream inside that scope. Session grouping and first landing are bounded by the scanned daily tables; events before/after the scan remain unknown. The assigned date is the supplied property date of the first observed session event. `reporting_timezone` remains NULL, and BigQuery location does not supply it.

The canonical daily grain is `(source_system, source_scope, event_date, channel)`. `source_system='ga4'`, the rendered project/dataset is `source_scope`, and `attribution_basis='session_last_click'`. Selected native `default_channel_group` is retained on session rows. Daily `native_channel_groups` is a distinct audit array, not another grouping dimension: exploding it and summing metrics duplicates the daily row.

GA4 and pixel visitor keys do not establish the same people. A caller-owned identity bridge and explicit population allocation are required before cross-source joins or totals. Channel labels, IP values and native user tokens are not that bridge.

## Metrics with distinct purchase policies

`sessions` counts emitted session rows. The engagement proxy uses an exported engaged flag, at least 10,000 accumulated selected integer engagement milliseconds, two page views or a configured key-event occurrence. It does not reconstruct screen-view engagement or property settings. Google defines engaged sessions using duration, key events and page/screen views and permits an adjusted engagement timer. See [engagement](https://support.google.com/analytics/answer/12798876) and [session settings](https://support.google.com/analytics/answer/9191807?hl=en).

`ga_session_number` is the maximum selected number in the observed group; `new_users` counts session rows whose maximum is 1. It is not a distinct-person or lifetime-acquisition count. `key_events` counts raw occurrences from the declared list, including repeated purchase events.

`channel_daily.sql` deduplicates exact nonempty transaction IDs within a local session. Whitespace-only IDs are not trimmed by this policy. The same ID in another session remains a separate purchase. It selects the earliest non-NULL USD amount and aggregates transactions to one session row before joining session metrics. It does not reconcile contradictory purchase payloads.

| Native daily revenue status | Meaning |
| --- | --- |
| `unkeyed_purchases` | At least one purchase lacks a nonempty transaction ID; amount NULL |
| `no_purchases` | No deduplicated or unkeyed purchases; amount zero |
| `unknown` | At least one deduplicated transaction has no selected amount; amount NULL |
| `complete` | Selected amounts are present under this policy; ordinary FLOAT64 sum |

These statuses are not the shared known/unknown/mixed-money interface. In particular, `complete` does not certify finite inputs or protect against FLOAT64 sum overflow. There is no implicit FX conversion or equivalence with pixel conversion values.

The separate [ecommerce report](ecommerce-contract.md) uses property/platform/stream/visitor/transaction qualification across dates, complete-payload conflict handling, guarded finite USD aggregation and explicit unkeyed-window uncertainty. Its count, money and item rules must not be attributed to the unchanged channel-daily query.

## Companion outputs and checks

Landing-page aggregation uses these same sessions across the whole window and returns the first 20 groups under its deterministic ordering. Traffic comparison uses selected native source/medium directly against landing UTM evidence; it preserves NULL and distinguishes `missing`, `invalid` and `valid` URLs. A valid untagged URL does not acquire invented Direct labels. Both are inspection samples. See the [companion contract](companion-session-contract.md).

Use the [bounded wrapper](export-execution-contract.md) for current all-eight-template execution and explicit synthetic tests. [Verification status](verification-status.md) records tested bytes and populations. Repository generation uses `node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check`; artifact isolation uses `node skills/ga4-bigquery-export/scripts/test-artifacts.mjs`. These repository checks do not execute SQL.

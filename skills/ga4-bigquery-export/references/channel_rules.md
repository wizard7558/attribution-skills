# Shared channel grouping for GA4

The canonical taxonomy version is `0.1.0`, with exactly these 11 labels:
`Paid Search`, `Paid Social`, `Paid Other`, `Organic Search`, `Organic Social`, `Email`,
`SMS`, `Direct`, `Referral`, `Affiliate`, `Other`.

Both standalone SQL templates embed the identical shared JavaScript classifier. Its source
is maintained by the channel-taxonomy skill and copied during repository generation; installed
GA4 skills do not need a sibling skill or external UDF. See the local
[channel contract](channel-contract.md) for identity, grain, and metric boundaries.

## Precedence and native labels

Paid click IDs win over conflicting email, organic, or native-channel evidence. `dclid`
maps to `Paid Other`; `gclid`, `gbraid`, `wbraid`, and `msclkid` map to `Paid Search`;
`fbclid`, `ttclid`, `rdt_cid`, `li_fat_id`, `twclid`, `epik`, and `sccid` map to `Paid Social`.
`srsltid` is retained but never establishes paid traffic by itself.

Next come paid network IDs and explicit paid-medium rules, then useful native labels,
non-paid medium/source evidence, referrer evidence, explicit or justified inferred Direct,
and finally `Other`. Empty or unknown evidence is not automatically Direct. Native GA4
`Unassigned` maps to canonical `Other`. Native `Display`, `Paid Shopping`, `Cross-network`,
`Paid Video`, and `Audio` collapse to `Paid Other`; `Organic Shopping` to `Organic Search`;
`Organic Video` to `Organic Social`; `Affiliates` to `Affiliate`; `AI Assistant` to `Referral`.
This shared classifier is a cross-source contract, not a reconstruction of every GA4 UI rule.

## Session evidence selection

Use one ordered source/medium/campaign/native-label struct from
`session_traffic_source_last_click.cross_channel_campaign`. Use the manual struct only when
all four cross-channel fields are NULL. Choose the first nonempty evidence struct by event
timestamp with a deterministic JSON tie-break. Never independently aggregate source and
medium: that can manufacture a pair from different events or campaigns. No user-first-touch
`traffic_source` fields participate.

The landing event is the first event carrying a non-NULL `page_location`; without one, it is
the first observed event. Its referrer and collected `gclid`/`dclid`/`srsltid` stay attached to
that event. The `click_ids` STRUCT retains those IDs (collected value takes priority) plus all
12 paid URL IDs and `srsltid`. URL values remain raw for audit; classification normalizes
values through the shared classifier. The legacy `landing_gclid`, `landing_fbclid`, and
`landing_ttclid` aliases remain URL-only. Later URL or collected click IDs never reclassify
the session. If a different evidence window is needed, define it explicitly in a new report.

Both queries use the same generated session reduction. It calls the UDF only after reducing
events to sessions. `default_channel_group` remains the selected native scalar on session
rows. Daily `native_channel_groups` is an audit ARRAY of distinct selected native labels;
it does not split the canonical grain. Migration: replace daily scalar
`default_channel_group` consumers with the audit array or use session rows for native-group
analysis. Do not explode the array and sum the duplicated daily metrics.

## Dates, metrics, and interoperability

The shared daily key is `source_system, source_scope, event_date, channel`.
`source_system='ga4'`, `source_scope='PROJECT.analytics_PROPERTY_ID'` (replace with the actual
scope), `visitor_key=user_pseudo_id`, and `attribution_basis='session_last_click'` retain
source context. Pixel attribution uses its first collected touch and its own visitor IDs;
these IDs do not identify the same people without an explicit bridge. Never sum overlapping
GA4 and pixel populations or treat their attribution bases as equivalent.

`event_date` is a DATE parsed from the first observed session event's GA4 property-local
`event_date`. `reporting_timezone` is NULL until the actual property IANA timezone is supplied;
`date_basis` documents the basis without guessing UTC. Scan adjacent daily tables for sessions
crossing midnight, then apply the desired reporting date filter after sessionization. A
session already running before the bounded scan has a truncated start and first landing;
these templates cannot recover events outside the scan. Late-arriving daily exports remain
subject to GA4's update window.

`sessions` counts session rows; `engaged_sessions` uses the exported engaged flag, at least
10,000 engagement milliseconds, two page views, or an event in the declared key-event list.
`new_users` counts first-session rows (`ga_session_number=1`), a source-native proxy rather
than cross-source deduplicated people. `key_events` counts raw events in the editable
`key_event_names` array, including repeated purchase events; agree that list before reporting.

GA4-native `purchases` deduplicates nonempty transaction IDs within `(session_key,
transaction_id)`. The same ID in another session remains a separate purchase. Duplicate
amounts use the earliest non-NULL amount; if every copy lacks an amount, that transaction's
revenue is unknown. Transactions aggregate to one session row before the join, preventing
multiple purchases from multiplying sessions, engagement, new users, or key events.
Missing/empty transaction IDs are excluded from deduped `purchases` but exposed as
`purchase_events_without_transaction_id`. Any such event makes daily revenue NULL with
`revenue_status='unkeyed_purchases'`, because it cannot safely be deduplicated. These events
can still be key events.

`purchase_revenue_usd` uses GA4's USD amounts and declares `currency='USD'`. When all purchase events have transaction IDs, it is zero for
no purchases (`revenue_status='no_purchases'`), the sum for fully known deduped purchases
(`complete`), and NULL if any deduped purchase amount is unknown (`unknown`), even when other
amounts are known. This is distinct from pixel `conversion_value`; there is no automatic
purchase equivalence or implied FX conversion.

## Reproducible checks

Run `node scripts/test-integration.mjs` from this installed skill for generated-UDF fixture
checks. Run `bash scripts/run_checks.sh --synthetic` with authenticated `bq` for both actual
SQL templates against synthetic nested events, a 20 MiB billed-bytes cap, and temporary tables
only. No customer tables or persistent datasets are read or written.

In the repository, regenerate all shared copies with
`node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository`; add `--check` to detect drift in
both queries, the standalone classifier copies, and the copied contract documents.

Run `node skills/ga4-bigquery-export/scripts/test-artifacts.mjs` from the repository to verify
standalone generator isolation and drift detection using temporary copies. Without
`--repository`, the channel-taxonomy generator only updates its own reference UDF and never
requires or creates sibling installed skills.

# Shared attribution contract

Taxonomy version `0.1.0` is carried with every classified record. Every downstream source
must retain source-scoped identity fields: `source_system`, `source_scope`, `session_key`,
and `visitor_key`. Never join bare session or visitor IDs globally across systems. Preserve
the source-native channel and raw source fields beside the canonical channel.

GA4's current source attribution is session last-click. The first-party pixel's touchpoint is
the first collected touch. Each output must expose `attribution_basis` so those measurements
are not presented as parity. `new_users` means source-native first-observed sessions; it is not
a cross-source deduplicated people count. CRM or MTA joins require an explicit identity bridge,
date mode, lookback window, and currency.

The canonical daily grain is `source_system, source_scope, event_date, channel`. Required
metrics are `sessions`, `engaged_sessions`, `new_users`, and `key_events`. Native channel audit
can be a separate grain. Never sum overlapping GA4 and pixel session populations. Monetary
metrics remain explicitly source-native fields, such as GA4 `purchase_revenue_usd` and pixel
`conversion_value`, with declared currency. Unknown or mixed currency produces `NULL` plus a
status; never sum mixed currencies. Consumers must inspect metric semantics and perform any
FX conversion explicitly before a monetary join. There is no fabricated purchase equivalence.

This contract describes data boundaries only. It does not imply that adapters, identity bridges,
or cross-source deduplication exist in this skill.

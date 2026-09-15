# Shared attribution contract

Taxonomy version `0.1.0` is carried with every classified record. Every record retains
`source_system`, `source_scope`, and the source-native key appropriate to its `record_kind`:

- sessions: `session_key`, `visitor_key`
- CRM leads: `lead_key`
- touches: `touch_key`, `visitor_key`
- conversions: `conversion_key`
- spend: `spend_key`

Never join a bare identifier globally across systems. Preserve source-native channels and raw
evidence beside the canonical channel. A reconciliation bucket is a separate field with one of
`matched`, `ambiguous`, `unmatched`, `unattributed`, or `spend_only`; it never replaces `channel`.

## Source boundaries

GA4's current source attribution is session last-click. The first-party pixel's touchpoint is the
first collected touch. Source session and daily measurement records expose `attribution_basis`;
these measurements are not presented as parity. `new_users` means source-native first-observed
sessions, not a cross-source deduplicated people count. Never sum GA4 and pixel populations or
infer an identity bridge.

CRM, touch, conversion, and modeling joins require an explicit identity bridge, timezone, date
mode (`cohort` or `activity`), lookback window, and currency. The canonical daily source grain is
`source_system, source_scope, event_date, channel`. Required daily metrics are `sessions`,
`engaged_sessions`, `new_users`, and `key_events`. Native channel audit can be a separate grain.
Dates and source grains must be declared at each report boundary. Cohort ratios and MTA outputs do
not establish causal lift.

## Monetary and downstream interfaces

Unknown or mixed currency produces a `NULL` amount plus status; never coerce it to zero or sum
mixed currencies. Monetary statuses are `known`, `unknown`, or `mixed_currency`. `known` requires
a finite amount and ISO currency. `unknown` and `mixed_currency` require a null amount.

Touches expose `source_system`, `source_scope`, `touch_key`, `visitor_key`, `occurred_at`,
`channel`, and `taxonomy_version`, with an optional all-or-none subject triple:
`subject_source_system`, `subject_source_scope`, `subject_key`.

Conversions expose `source_system`, `source_scope`, `conversion_key`, `occurred_at`, the same
nullable all-or-none subject triple, `value`, `currency`, and `value_status`. A subject triple
may come from an explicitly matched identity-graph contact or a source-native identified subject
with documented evidence. It is never a bare cross-source ID or IP address.

Spend exposes `source_system`, `source_scope`, `spend_key`, `event_date`, `channel`,
`taxonomy_version`, `network_id`, `campaign_key`, `spend`, `currency`, and `spend_status`.

## Scoped ad bindings

An `ad_scope_bindings` row has exactly these six fields:
`crm_source_system`, `crm_source_scope`, `ad_source_system`, `ad_source_scope`, `platform`, and
`entity_type`. Matching is exact and case-sensitive as configured: no wildcard, trim, or lower
operation is applied to binding fields. A consumer must use the appropriate `entity_type` and
preserve both CRM and ad source identities in qualified outputs. Bare ad IDs are never joined
across accounts. A CRM resolver may document a unique-account inference when no binding exists;
that is an explicit exception for that resolver, and downstream consumers must not silently widen
it.

Human-readable names may use five bounded percent-decoding passes, plus-to-space conversion,
trim, and lowercase. Opaque keys use five bounded decoding passes, trim, and preserve case and
`+`. The canonical classifier receives raw evidence once; consumers must not pre-decode it and
then classify it again.

## Measurement distinctions

Monetary fields remain source-native, such as GA4 `purchase_revenue_usd` and pixel
`conversion_value`, with declared currency and status. Consumers inspect metric semantics and
perform any FX conversion explicitly before a monetary join. There is no fabricated purchase or
population equivalence. This contract describes data boundaries and interfaces; it does not
claim that adapters, identity bridges, or downstream models are implemented in this skill.

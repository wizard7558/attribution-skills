# Evaluation output interface

This interface specifies projected answers, not a runtime API. Both conditions receive this
interface; only the with-skill condition receives the declared skill context files. Return
exactly `{"cases":[{"case":"…","result":…}]}` in input case order. Copy neutral case labels
exactly. Object property order does not matter. Array order is defined below.

## Classification

For each evidence object return `channel` (the chosen canonical label), `taxonomy_version`,
`paid_evidence_proven` (does classification alone prove paid spend?), and `preserve_raw`
(should native labels and all supplied evidence remain available beside the projection?).
Return these four fields; omit internal rule IDs and the evidence object itself.

## Contract review

Each case's `review` selects a decision shape below. Every result has `decision` and `money`.
Determine each decision from the available evidence and any supplied source contract. The
input shorthand `pixel` names the `first_party_pixel` source.

- `identity`: `identity_fields` lists the fields required to identify a session record;
  `same_session_token` and `same_scope_token` compare the corresponding supplied strings
  exactly; `identity_bridge_established` answers whether this evidence establishes a
  cross-source identity bridge.
- `population`: `source_measures` has `ga4` and `first_party_pixel` keys naming the units
  in the supplied population descriptions. `can_sum_populations` asks whether those
  populations can be added; `purchase_equivalence_established` asks whether the evidence
  establishes equivalent purchase measurement.
- `money`: `declared_currencies` copies input currencies in input order;
  `fx_conversion_supplied` asks whether an actual FX conversion is supplied.
- `attribution`: `attribution_bases` has `ga4` and `first_party_pixel` keys, naming each
  source's basis. `parity_established` asks whether the two attribution measurements are
  equivalent; `identity_bridge_established` asks whether an identity bridge is established.
  Neutral basis tokens are `session_last_click`, `first_touch`, `last_touch`,
  `multi_touch`, and `unknown`.
- `daily_grain`: `daily_grain` lists required grouping fields; `can_sum_populations` asks
  whether the given source populations can be added.
- `metrics`: `common_metrics` lists the common required metrics; `new_users_basis` names
  the meaning of new users; `cross_source_people_count` asks whether new users is a
  cross-source people count. `declared_currencies` copies input currencies in input order.
  `unconverted_currency_pool_status` classifies the declared currencies as a pool, rather
  than reporting a measured amount. Neutral new-user tokens are
  `source_native_first_observed_sessions`, `cross_source_deduplicated_people`,
  `all_source_visitors`, and `unknown`.

Field-list serialization uses this candidate ordering: `source_system`, `source_scope`,
`event_date`, `channel`, `session_key`, `visitor_key`, `campaign_key`, `network_id`.
Select the fields your decision requires, then order only those fields by this list.
Metric-list serialization similarly uses `sessions`, `engaged_sessions`, `new_users`,
`key_events`, `purchase_revenue_usd`, `conversion_value`. These candidate lists specify order,
not which members to select.

`money` has `observations` and `total`. The observations project only supplied monetary
records named `ga4_revenue` and `pixel_value`, ordered by their input field names in ascending
Unicode order. Each projected record has `source_field`, `value`, `currency`, and `status`.
Determine its monetary representation and status. `available_metrics` and `currencies` are
input declarations, not additional observation records for this output interface.

With no records to project, serialize `observations: []` and `total: null` as the structural
absence convention. Otherwise total has `value`, `currency`, and `status`, expressing your
assessment of a combined monetary result. Determine whether a total is available and which
representation the evidence supports. Status vocabulary for both money and currency-pool
answers is `known`, `unknown`, `mixed_currency`. Amounts are JSON numbers or null; currencies
are strings or null. Do not return formatted numeric strings or additional explanations.

Source policy references for the skill are [channel-contract.md](channel-contract.md),
[source-mappings.md](source-mappings.md), and [the classifier](../scripts/channel-taxonomy.mjs).
This interface defines answer shapes and vocabulary; it does not prescribe the selected
cases' classification, identity, attribution, aggregation, or monetary decisions.

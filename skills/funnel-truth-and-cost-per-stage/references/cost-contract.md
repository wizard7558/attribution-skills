# Native cost per stage reconciliation

`sql/cost_per_stage.sql` is a standalone native Standard SQL script with temporary synthetic
inputs. Replace only its marked input block with typed warehouse projections. There is
one explicitly scoped CRM invocation; no implicit account inference, tracking classifier,
JavaScript stage engine, persistent table, or customer-specific dependency exists in the SQL.

## Inputs and identity

Every input table includes `invocation_key`, an internal join namespace. Production requires
exactly one configuration row; missing or duplicate configuration fails before reporting.
The fixture runner substitutes independent synthetic invocation namespaces and still requires
one configuration for every namespace. `invocation_input` requires CRM `source_system`,
`source_scope`, valid IANA `report_timezone`, inclusive `report_start`/`report_end` DATEs,
`date_mode` (`cohort` or `activity`), and explicit `spend_complete` BOOL. Start must not exceed end.

The replaceable SQL block is also the concrete typed schema for:

- `stage_input`: `stage_key`, integer `stage_order`, `stage_kind` (`lead`, `qualified`,
  `converted`, `won`, `event`). Configured keys and orders are unique; gaps are valid.
  At least one stage is required, including empty-funnel reports.
- `stage_ledger_input`: qualified CRM `source_system`, `source_scope`, `lead_key`, stage
  key/order/kind, nullable `achieved`, `cohort_at` and `stage_entered_at` TIMESTAMPs,
  `is_attribution_primary`, native NUMERIC `value`, `currency`, `value_status`,
  `stage_truth_status`, and `attribution` STRUCT. This projects the actual stage ledger;
  precomputed cohort/activity dates and original evidence keys may remain in the upstream
  ledger but are not consumed here. This layer recalculates dates in its declared timezone.
  Each input lead requires one row per configured stage; identity conflicts and inconsistent
  per-lead cohort/primary/attribution metadata fail. Nonprimary rows remain in stage truth.
- `crm_attribution_input`: typed projection of actual CRM attribution output: qualified lead,
  `channel`, `taxonomy_version`, `quality_status`, `network_id`, `campaign_key`, qualified
  winning `ad_source_system`, `ad_source_scope`, `ad_key`, `ad_match_status`, and
  `candidate_ads ARRAY<STRUCT<source_system,source_scope,ad_key,campaign_key>>`.
  Do not include arbitrary raw CRM fields. A missing row becomes Other with
  `channel_status='missing_attribution'`, an unattributed bucket, and a diagnostic.
  Extra attribution rows are diagnosed and never create leads. Provided classification
  must use canonical taxonomy 0.1.0 and its 11 channels. Non-null upstream stage classification
  must agree. Classification is consumed unchanged, never inferred again.
- `campaign_input`: exact `source_system`, `source_scope`, `network_id`, `campaign_key`.
  No display name is a join key. Campaign keys are already canonical opaque identifiers;
  case, plus signs, and percent escapes remain unchanged. Do not URL-decode them again.
- `binding_input`: exact six-field shared binding: `crm_source_system`, `crm_source_scope`,
  `ad_source_system`, `ad_source_scope`, `platform`, `entity_type`. Only `entity_type='campaign'`
  authorizes this join; ad bindings or other CRM scopes do not. Empty bindings grant nothing.
- `spend_input`: native qualified `source_system`, `source_scope`, `spend_key`, required
  `event_date` DATE, canonical `channel`/`taxonomy_version`, nullable `network_id` and
  `campaign_key`, native NUMERIC `spend`, `currency`, `spend_status`. Missing catalog or
  campaign identifiers cannot discard spend; unresolved spend remains spend-only.
- `account_currency_input`: optional rows declaring the native currency for qualified
  `source_system`, `source_scope`, `network_id` over the entire invocation range. `currency`
  is uppercase three-letter. Identical repeats collapse; conflicting declarations or
  contradictions with observed non-null spend currency in the report range fail. Empty
  input is valid. Do not infer this currency from revenue or another account.

All non-null identities are exact nonempty strings without surrounding whitespace. Required
identities cannot be null. Exact repeated ledgers, attribution, spend, stages, catalog, and
bindings collapse. Conflicting payloads for the same qualified ledger/attribution/spend key
fail; there is no arbitrary latest-row selection. These inputs are already selected snapshots.

## Reconciliation and dates

Candidates are exact campaign/network catalog entities authorized by explicit CRM-to-ad-account
campaign bindings. If the upstream winner provides an ad account, candidates must also use
that same qualified account. Resolution is ordered:

1. Missing attribution or upstream unattributed quality is `unattributed`.
2. Upstream ambiguous ad evidence is `ambiguous`, even if a campaign hint is unique. This is
   deliberately conservative about the upstream ad ambiguity; its qualified candidate ads remain.
3. One authorized campaign is `matched`, even when upstream ad matching was unsuccessful.
4. Multiple authorized campaigns are `ambiguous`; none is `unmatched`.

`lead_reconciliation` retains qualified candidates, upstream candidate ads, method, and reason.
The campaign hint on an unresolved row does not authorize joining spend. Full outer
reconciliation adds `spend_only` when observed spend lacks a matched funnel group.

Cohort mode uses `cohort_at`; activity mode uses `stage_entered_at`. Both become DATEs in
`report_timezone`. Out-of-range dated rows are excluded from report aggregates, but their
qualified keys, values, chosen dates, and `included=false` remain in stage/spend evidence
with diagnostic counts. Null dates remain explicit undated report groups. `achieved` and
`stage_truth_status` preserve unknown stage truth versus not-yet-achieved activity. Undated
stages cannot be assigned a date-specific spend amount or an absent-spend zero.

## Counts and money

Funnel counts aggregate **before** spend joins. Grain is date (nullable), configured stage,
channel, network, qualified campaign identity for matched groups. Unresolved groups retain
CRM invocation, bucket, channel status, and campaign hint; they cannot join spend. All lead
rows count toward `lead_count`; `stage_count_total` counts achieved rows,
`stage_count_primary` counts achieved primary rows, and `stage_unknown_count` counts null
achievement. Currency is never a grouping dimension for lead counts.

Spend is first aggregated by date/channel/network/qualified account/campaign, without
currency. Then spend groups expand across configured stages and join matched funnel groups
on exact non-null date, channel, network, campaign, and qualified ad account. Other funnel
buckets remain separate. Spend repeats per stage by design: **never sum spend across stages**.
Per-stage spend-fact counts and native evidence make conservation checkable.

All input/output amounts use NUMERIC. `known` requires an amount and currency; `unknown`
requires null amount and permits known or unknown currency; `mixed_currency` requires null
amount/currency. Currency syntax is uppercase three-letter; ISO registry membership is an
upstream adapter responsibility. NUMERIC supports nine decimal places; adapters must reject
unintended higher-precision rounding before constructing typed inputs. Arithmetic overflows
fail the SQL rather than silently losing precision. JSON serialization may represent NUMERIC
decimals as strings; consumers must preserve exact decimal values.

Explicit mixed currency or more than one known native currency produces null/mixed_currency,
including alongside unknown amounts. Otherwise an unknown amount keeps the aggregate
null/unknown. There is no conversion or blanket zero filling. Revenue independently aggregates
only achieved stage values; no achieved values means unknown. Revenue and spend have separate
amount, currency, and status fields. Native spend facts remain in `spend_evidence` and stage
values remain in `stage_evidence`, including mixed/unknown cases.

`observed_spend`, `observed_spend_currency`, and `observed_spend_status` describe supplied facts.
Partial feeds keep these observations but force final `spend`/`spend_currency` null and
`spend_status='unknown'`. Complete feeds permit known zero for a dated matched campaign with
no spend facts **only** when an explicit qualified account currency exists, with
`absence_reason='complete_snapshot_zero'`. Without that currency, absence is
`complete_snapshot_currency_unknown` and the amount remains unknown. Unresolved campaign
absence stays unknown. An observed unknown fact does not become a zero.

`cost_per_stage` uses final known spend divided by positive `stage_count_primary`, only in
matched groups. `cost_status` explains an unavailable cost. Primary counts never replace
all-lead counts. These are descriptive date-aligned reporting ratios, not causal acquisition
cost estimates. This reference makes no ROAS or cross-currency claim.

## Native output codes and ordering

These are the literal output rules implemented by
[cost_per_stage.sql](sql/cost_per_stage.sql), especially `lead_reconciliation`, the aggregate
status CTEs, `cost_report`, and the final payload SELECT. Codes are part of the public contract;
keep their exact spelling rather than substituting a descriptive synonym.

Lead reconciliation chooses the first applicable bucket: missing attribution or upstream
`quality_status='unattributed'` gives `unattributed`; upstream `ad_match_status='ambiguous'` or
more than one authorized campaign gives `ambiguous`; exactly one authorized campaign gives
`matched`; otherwise `unmatched`. The full outer report adds `spend_only` for spend with no
matched funnel group. An ambiguous or unmatched funnel group cannot consume that spend.

`channel_status` is `missing_attribution` only for a lead with no attribution row (its channel
becomes `Other`); otherwise it is `classified`, including spend-only output. In lead
reconciliation, `reconciliation_method` is `explicit_campaign_binding` for a matched bucket
and `none` otherwise. `reconciliation_reason` takes the first applicable entry:

| Condition, in precedence order | Exact reason |
| --- | --- |
| Attribution row missing | `missing_attribution` |
| Upstream quality is unattributed | `upstream_unattributed` |
| Upstream ad match is ambiguous | `upstream_ad_ambiguity` |
| More than one authorized candidate campaign | `multiple_authorized_campaigns` |
| Matched bucket | `exact_authorized_campaign` |
| Otherwise | `no_authorized_campaign` |

`revenue_status` first becomes `mixed_currency` for an explicitly mixed achieved value or
multiple known achieved currencies; otherwise it is `unknown` when there are no achieved
records or any achieved value is unknown; otherwise `known`. Revenue amount and currency are
emitted only for `known`. `observed_spend_status` uses the same mixed-before-unknown precedence
for supplied spend facts, with `known` otherwise. Its amount and currency are emitted only for
`known`; a report group with no observed spend defaults to `unknown`.

Final `spend_status` has this precedence: an incomplete spend snapshot gives `unknown`; existing
spend facts use `observed_spend_status`; a dated matched group with no spend facts and an explicit
qualified account currency gives `known` zero; otherwise `unknown`. No unknown observed fact is
converted to zero. Final `absence_reason` takes the first applicable entry:

| Condition, in precedence order | Exact reason |
| --- | --- |
| Incomplete spend snapshot | `incomplete_spend_snapshot` |
| At least one observed spend fact | null |
| Dated matched group with explicit qualified account currency | `complete_snapshot_zero` |
| Dated matched group without that currency | `complete_snapshot_currency_unknown` |
| Undated report group | `undated_stage` |
| Otherwise | `unresolved_campaign` |

`cost_status` takes the first applicable entry, even if a later condition is also true:

| Condition, in precedence order | Exact status |
| --- | --- |
| Bucket is anything other than `matched`, including `spend_only` | `campaign_not_matched` |
| Final spend status is not `known` | `spend_unknown` |
| Primary stage attainment count is zero | `no_primary_stage_attainment` |
| Otherwise | `known` |

`cost_per_stage` is null unless the final status is `known`, in which case it is final known
spend divided by positive primary stage attainment. A spend-only row therefore has
`campaign_not_matched`, even when its spend is known and primary count is zero.

The final `report` array is sorted ascending by this exact tuple, left to right:

```text
(stage_order, report_date IS NULL, report_date, channel, bucket, network_id,
 ad_source_system, ad_source_scope, campaign_key, channel_status)
```

Use the configured numeric stage order, even when a compact output omits that field. Within a
stage, dated rows precede null-date rows because false precedes true for `report_date IS NULL`.
Dates then ascend. Strings use the SQL's default uncollated ordering, preserving case and opaque
key bytes; do not sort by a user-facing bucket priority or input order. Other nullable tuple
fields use BigQuery's ascending nulls-first behavior. Ties advance to the next listed field.
The SQL defines no additional tie-breaker after the complete tuple; do not invent one. Grouping
and invocation identity collapse equal report grouping keys before this ordering.

Other output arrays sort ascending as follows: `lead_reconciliation` by `lead_key`;
`spend_evidence` by `(source_system, source_scope, spend_key)`; `stage_evidence` by
`(lead_key, stage_order)`; candidate campaigns by `(source_system, source_scope, network_id,
campaign_key)`. The outer result sorts by `invocation_key`. Preserve complete row populations
and these orders when returning a projected subset of fields. BigQuery's default ascending and
null ordering is specified in its [ORDER BY reference](https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#order_by_clause).

## Executable verification

```sh
node scripts/test-cost-per-stage.mjs
node scripts/test-cost-per-stage.mjs --live --project YOUR_BILLING_PROJECT
node scripts/test-cost-per-stage.mjs --live --project YOUR_BILLING_PROJECT --integration
```

The first command checks fixture definitions only and explicitly does not execute SQL. Live
mode executes standalone SQL, every full golden report/evidence fixture, and actual failing
SQL assertions with a 1 GiB per-job billed-bytes cap. It verifies full output and independent
population/spend conservation checks. `--resume-report PRIVATE_PREVIOUS_REPORT` preserves
prior successful evidence and retrieves completed outputs read-only instead of resubmitting;
its SQL and fixture hashes must match, and it writes a new linked report. Failed reports remain.
For a corrected golden expectation, add `--recheck-goldens`: the runner requires the exact
previous SQL hash and byte-exact successful-fixture query hash, then retrieves that completed
job read-only and compares every full golden again. The report records both fixture hashes
and the correction separately from SQL changes.

Standalone SQL and golden fixtures are independent of sibling skills. `--integration` explicitly
requires repository siblings: it invokes the actual CRM JS resolver, adapts an existing stage
fixture into the actual native stage SQL, then feeds that output into native cost SQL. It
checks qualified campaign mapping, stage/count/value continuity, and observed spend/cost.
No second classifier or stage engine is copied. Private Downloads reports capture actual
job IDs, caps, errors, bytes, versions, and hashes. Large production ledgers should use typed
warehouse input projections and partition pruning rather than the synthetic literal fixture
loader. No large-scale performance or cost benchmark is claimed.

<!-- execution-status:start -->
Authenticated native BigQuery checks passed on 2026-09-08: standalone SQL, 21 full golden fixtures (34 report rows), 12 structural fixture failures, and two production configuration failures. The actual sibling CRM resolver → native stage ledger → native cost integration also passed. Every job confirmed Standard SQL and a 1 GiB billed-bytes cap. Private job IDs, project, hashes, versions, and measured bytes remain in Downloads evidence. These synthetic checks are correctness evidence, not a scale benchmark.
<!-- execution-status:end -->

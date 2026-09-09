# Observational share factors and explicit assumption bands

This module compares caller-declared modeled channel shares with CRM outcome shares, and separately applies user-supplied multipliers to a response-scenario delta. These are observational framing calculations. They do not establish causal incrementality, perform population joins, optimize a budget or estimate statistical uncertainty.

## Run and interfaces

Production uses only the Python standard library, including `zoneinfo` and `decimal`, with an available IANA timezone database. It has two importable functions:

```text
compare_attribution_shares({config, mmm, crm})
project_assumption_bands({scenario_result, assumption})
```

From this skill directory, the standalone JSON stdin CLI and test command are:

```sh
python3 scripts/framing.py < input.json > result.json
python3 -B scripts/test_framing.py
```

CLI input is exactly `{"operation":"compare_shares","input":{...}}` or `{"operation":"project_bands","input":{...}}`. It writes one result JSON object to stdout. Structural errors raise `ValueError("invalid attribution framing input")`; CLI errors exit 2, leave stdout empty and write only the generic error object to stderr. Unknown operations/fields, duplicate JSON object keys, malformed JSON and nonfinite JSON numeric tokens fail. Inputs are not mutated. Production requires neither NumPy nor repository siblings; the pipeline integration test explicitly requires the accepted regression and response modules and NumPy.

## Shared population contract

Share comparison has exactly `config`, `mmm`, and `crm`. Its configuration has exactly these fields:

| Field | Meaning and validation |
| --- | --- |
| `report_scope` | Exact label for the caller's preaggregated population. |
| `timezone` | Named IANA zone, resolved by `ZoneInfo`; aliases such as UTC/CET are allowed, numeric offsets alone are not names. |
| `start_week`, `end_week` | Real Monday dates in `YYYY-MM-DD`, inclusive and ordered. No `as_of` is used: the caller supplies the explicitly preaggregated window. |
| `outcome_name`, `outcome_kind` | Exact outcome label and `count` or `revenue`. |
| `spend_currency`, `outcome_currency` | Uppercase three-letter spend currency; outcome currency null for count and uppercase three-letter for revenue. No conversion occurs. |
| `channel_keys` | Ordered distinct exact opaque labels. Case and literal `+` remain unchanged. No implicit canonical-channel mapping occurs. |

Exact labels are nonblank, have no surrounding whitespace, and contain no C0/C1 controls. Each source has exactly `metadata`, `complete`, and `rows`. Metadata has all configuration fields except `channel_keys`, and must deeply equal those corresponding fields. Even timezone aliases representing similar clocks cannot silently replace the declared timezone string. Different windows, scopes, outcomes or currencies are errors. `complete` is an explicit boolean.

The caller must supply disjoint preaggregated pieces of this declared window and population. `source_system`, `source_scope`, and `row_key` identify a row exactly; they do not authorize a person-level cross-source join. Matching metadata is a caller assertion, not origin authentication or proof that source membership is correct.

## Rows, sums and completeness

MMM rows have exactly `source_system`, `source_scope`, `row_key`, `channel_key`, and `contribution`. Contribution is a finite signed modeled outcome quantity or explicit null. It is the caller's **observational modeled channel quantity**, not a claim of causal lift. It need not be a Hill response level, which is not the OLS channel contribution. Any negative input piece prevents MMM-share interpretation, even if positive pieces offset it; the signed sum and sorted qualified negative evidence keys remain visible.

CRM rows have exactly `source_system`, `source_scope`, `row_key`, `channel_key`, `spend`, and `outcome_quantity`. Spend and outcome quantities are finite nonnegative numbers or explicit null; booleans and numeric strings are invalid. `outcome_quantity` must measure the same declared outcome as the modeled quantities: count/weighted count for a count outcome, or monetary outcome quantity for a revenue outcome. CPA fields are calculated only for `outcome_kind="count"`, as cost per declared action or weighted count, which is not necessarily customer acquisition. For revenue outcomes, both CPA fields are null with `not_conversion_count`; share factors still compare the same declared monetary outcome across sources.

Every raw row is validated before deduplication or aggregation. Undeclared channels fail, including an unattributed label not included in the configured population. A caller can explicitly include an unattributed channel; it then remains in both denominators. Identical qualified row payloads collapse; conflicting duplicates fail. Dictionary ordering and numerically equal integer/float representations do not change identity. The same bare row key in a different source/scope remains a separate declared piece.

For each declared channel, contribution, spend and outcome quantity are summed separately. A missing channel is unknown, even when `complete=true`; only an explicit zero row establishes zero. A null piece makes the corresponding aggregate unknown. A finite integer that cannot be represented exactly in float64 makes its aggregate `numerical_failure`, retaining other known channel aggregates. Partial sources preserve their observed sums but cannot provide complete-window shares. An incomplete CRM source also cannot provide CPA.

MMM shares divide each channel's modeled contribution by the sum over the full declared channel set. CRM shares use summed outcome quantity, not spend. Source incompleteness, missing/unknown denominator pieces, unavailable arithmetic or a zero total makes the relevant shares unavailable. Any negative MMM piece makes MMM shares unavailable with `negative_model_contribution`. No channel is dropped to improve the denominator. Diagnostic denominators preserve known observed sums even when completeness or negative modeled evidence prevents their use as shares.

## Share factors and CPA arithmetic

```text
mmm_share = channel MMM contribution / full declared MMM contribution total
crm_share = channel CRM outcome quantity / full declared CRM outcome quantity total
factor = mmm_share / crm_share
crm_cpa = SUM(channel spend pieces) / SUM(channel outcome quantity pieces)  [count only]
adjusted_cpa = crm_cpa / factor  [count only]
```

A factor requires both shares and a positive CRM share. A true zero model share gives factor zero, but adjusted CPA is unavailable with `zero_factor`. CPA requires count mode, known spend, known positive outcome quantity and an explicitly complete CRM source. It is a ratio of sums, never an average of row CPAs. Adjusted CPA requires a known CPA and positive known factor; multiplying CPA by the factor would reverse the specified adjustment.

For example, modeled quantities 60/40 and CRM conversions 30/70 yield factors 2 and 4/7. If spend is 300/700, both CRM CPAs are 10, and adjusted CPAs are 5 and 17.5. Splitting channel A into spend/conversion pieces 100/5 and 200/25 still gives CPA 300/30=10; averaging the piece CPAs 20 and 8 would incorrectly give 14.

These ratios are observational comparisons conditional on the declared quantities and population. The word “adjusted” describes this arithmetic transformation only. It is not an experiment-calibrated incremental CPA or a budget recommendation.

The exact output shape is:

```text
contract_version: "0.1.0"
config: unchanged full share configuration
status: "complete" | "incomplete"
channels: [{key, mmm_contribution, crm_spend, crm_outcome_quantity,
            mmm_share, crm_share, factor, crm_cpa, adjusted_cpa}]
diagnostics:
  mmm: {complete, denominator, share_reason, duplicate_rows_collapsed,
        missing_channels, negative_contribution_keys}
  crm: {complete, denominator, share_reason, duplicate_rows_collapsed,
        missing_channels}
limits: ["observational_share_ratio", "not_causal_incrementality",
         "no_budget_recommendation", "no_population_join"]
```

Every metric, including each diagnostic denominator, is exactly `{value, reason}`. Known values have `reason=null`; unavailable values have `value=null`. Raw aggregates use `missing_channel`, `unknown_value` or `numerical_failure`. Share reasons additionally include `source_incomplete`, `negative_model_contribution` and `zero_total`. Factors use `shares_unavailable`, `zero_crm_share` or `numerical_failure`; CPA uses `not_conversion_count` in revenue mode; in count mode it uses its completeness/aggregate reason, `zero_outcome_quantity` or `numerical_failure`. Adjusted CPA uses `not_conversion_count` in revenue mode and `cpa_unavailable`, `factor_unavailable`, `zero_factor` or `numerical_failure` in count mode.

Source-level share reason precedence is incompleteness, negative MMM evidence, aggregate/denominator failure, then zero total. For combined denominator failures, numerical failure precedes missing and unknown. The detailed aggregates and diagnostic lists remain available alongside that primary reason. All channel outputs follow configured order. Overall `complete` requires usable source shares and available factors for every channel. Count mode additionally requires available CPA and adjusted CPA, so explicit legitimate zero-outcome or zero-model count channels can yield `incomplete` with specific reasons. Revenue mode does not require its inapplicable CPA fields; a zero modeled revenue share with a known factor of zero can remain complete. An empty channel set has zero diagnostic denominators and no invented shares.

## Scenario assumption bands

Band input has exactly `scenario_result` and `assumption`. The former is the **full actual** accepted `evaluate_response_scenario` result, including its full regression configuration, ordered channels, totals and fixed limits. Configuration follows the accepted regression shape, including the explicit offset-aware `as_of`, controls and thresholds. Identity, order, status and numeric structure are validated. This validates the producer contract; it does not authenticate the producer.

A complete scenario must have ready/flat channel statuses, finite channel response fields and all three finite totals matching the corresponding channel `math.fsum` values. The comparison uses relative tolerance `8 * float64 epsilon`, with expected zero requiring exact zero. It compares summed channel deltas directly, since the accepted response module computes deltas more accurately than subtracting rounded response levels. Inexact integer values in a claimed complete numerical scenario fail validation. An incomplete scenario must have **all three totals null**; finite totals under an incomplete status contradict the accepted producer and fail structurally. Unsupported channel response fields must be null; flat channels must have zero response fields.

Assumption has exactly `label`, `lower_multiplier`, and `upper_multiplier`. The label is exact nonblank text under the same control-character rules. Multipliers are explicitly supplied finite numbers satisfying `0 <= lower <= 1 <= upper`. There are no defaults, distributions, random samples or implicit confidence levels.

For a complete scenario, multiply its total response delta by both multipliers, then take the minimum and maximum as the bounds. The point remains the original scenario delta. Delta 30 and multipliers 0.5/1.5 give 15/30/45; delta -30 gives -45/-30/-15. Zero change gives exact zero bounds. Multipliers 1/1 give a degenerate range at the point. These are ranges for **media-response change**, not absolute outcomes or statistical uncertainty.

The exact output is:

```text
contract_version: "0.1.0"
config: unchanged full scenario configuration
status: "available" | "unavailable"
label, lower_multiplier, upper_multiplier: unchanged explicit assumption
point_delta: finite original delta or null for an incomplete scenario
lower_delta, upper_delta: finite ordered bounds or null
reason: null | "scenario_incomplete" | "numerical_failure"
limits: ["user_supplied_assumption_range", "not_confidence_or_credible_interval",
         "not_causal_lift", "media_response_change_only"]
```

Incomplete scenarios produce unavailable bands with null point and bounds. If a complete scenario's band arithmetic overflows or a true nonzero bound underflows to zero, the finite point is retained but both bounds are null with `numerical_failure`. Inexact integer multipliers receive the same numerical guard. Explicit multiplication by zero produces true known zero and is allowed. These limits remain present even if the caller chooses an evocative assumption label; the function never labels the result a confidence or credible interval.

## Numerical implementation and tests

Sums, divisions and band products use standard-library Decimal arithmetic at 2000 digits of working precision, with exact integer/float input conversion, before a guarded float output conversion. This avoids intermediate overflow and does not add currency conversion. Finite integers with inexact float64 representation are guarded rather than silently rounded. Nonfinite output and nonzero-to-zero conversion are unavailable, while true arithmetic zero remains known. Decimal computation is an implementation aid; the public API still returns ordinary finite JSON numbers or explicit nulls.

`framing-fixtures.json` contains complete literal expected outputs and separate analytical derivation notes. It does not use implementation output to generate expectations. Comparisons cover the entire structure with relative tolerance `1e-12` and zero absolute tolerance, so tiny positive numbers cannot pass as zero. Known-ratio fixtures establish factor direction, adjusted-CPA division and ratio-of-sums behavior. Cases also cover missing/unknown/partial sources, qualified duplicate handling, signed modeled evidence, explicit unattributed population, revenue quantities with inapplicable CPA, count/revenue metadata conflicts, extreme arithmetic, positive/negative/zero bands and contradictory producer metadata/totals.

Verified with Python 3.14.2: 62 executed fixtures (37 full-output goldens and 25 intended errors), six row/key permutations, seven rejected behavioral mutants, seven copied-directory CLI checks, and one actual pipeline integration. CLI checks use `-I -S` with only `framing.py` copied, confirming stdlib-only production execution. Mutants invert the factor, multiply adjusted CPA, average row CPAs, invent missing-channel zeros, leave negative band bounds unsorted, claim a confidence interval, or turn underflow into zero.

The actual integration runs the accepted weekly MLR, curve calibration, explicit response scenario and band projection using Python 3.14.2 / NumPy 2.4.4, then compares the band against an independently derived 15/30/45 expectation. This integration requires the accepted sibling modules; the production functions and literal fixture definitions do not depend on another reporting engine.

Every test run saves a new `~/Downloads/mmm-framing-evidence-<timestamp>.json` containing runtime versions, source/fixture hashes, executed cases/counts, integration source hashes, CLI results and mutation evidence. Failed runs are preserved separately. Only the stated local runtime and synthetic inputs were tested; there are no production accuracy, causal validity or scaling claims.

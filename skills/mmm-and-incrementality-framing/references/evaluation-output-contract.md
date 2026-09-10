# Projected evaluation output contract

This is a reporting projection of the accepted regression, response and framing interfaces, not a new producer API. Compute the relevant accepted behavior from each complete supplied input, then return only the fields requested by the types-only schema. Do not rerun regression when a response operation supplies an already-declared regression result; its provenance validation does not refit or authenticate the original data.

Each request contains `cases` in a declared order. Return `{"cases":[{"case":label,"result":projection}]}` with exactly one result per input, identical case labels and identical case order. Labels are opaque identifiers. Object field order is irrelevant; array order and cardinality are significant. Include every required field; use explicit nulls for unavailable values. Numbers must be finite JSON numbers, never numeric strings or booleans. Diagnostic counts `n`, `p` and `residual_df` are JSON integers. Other numerical results permit equivalent integer or decimal representations. Do not add explanatory fields, markdown, confidence levels, recommendations or an assumed causal interpretation.

## Regression projection

Return `status`, `intercept`, `channel_coefficients`, `control_coefficients`, `diagnostics`, and `limits`. Channel rows retain exactly `key`, `coefficient`, `mean_spend`; control rows retain `key`, `coefficient`. They follow the configured channel and control order, respectively, including non-fitted null rows. The diagnostics projection contains exactly `n`, `p`, `residual_df`, `missing_weeks`, `negative_coefficients`, and `flags`.

Use an OLS intercept and every declared channel/control in their original units. A completed Monday week requires the next Monday's local midnight to be at or before `as_of`. `n` counts the full required completed-week grid, including missing weeks; `p` counts channel plus control predictors; `residual_df=n-(p+1)`. Missing required weeks/values or insufficient declared sample/degree thresholds return `insufficient_input`, without fitting, dropping weeks or filling zeros. Coefficients, intercept and historical means remain null when these early checks fail. `missing_weeks` lists missing required dates in chronological order.

After completeness/sample gates, calculate historical channel means. Zero-variance predictors or deficient standardized-design rank return `rank_deficient`; full-rank condition number above the declared threshold returns `ill_conditioned`. Both keep finite means already computed but publish null intercept and coefficients. Failed float64 precision, solver, finite-value or original-unit consistency guards return `numerical_failure`, with null intercept/coefficients. Otherwise return `fitted`. Negative fitted coefficients retain their signs. `negative_coefficients` contains exactly `{kind,key}` for each negative coefficient, scanning configured channels first (`kind="channel"`), then configured controls (`kind="control"`), preserving each configured order. Negative-coefficient diagnostics start empty; preserve any diagnostics already computed if a later numerical guard fails.

Flags are exact strings in execution order; an unflagged fit uses `[]`. Before fitting, append applicable flags in this order: `intercept_only` (no predictors), `no_completed_weeks`, `missing_weeks`, `unknown_required_values`, `min_weeks_not_met`, `min_residual_df_not_met`. Any of these except `intercept_only` ends at `insufficient_input`. Subsequent guards append `float64_precision_loss`, or `zero_variance_predictors` followed by `rank_deficient`, or `rank_deficient`, or `ill_conditioned` as applicable. An exact constant-outcome fit appends `constant_outcome`; a fit with any negative coefficient appends `negative_coefficients`. A numerical computation failure appends `nonfinite_or_unstable_computation`. Retain flags already reached; do not add generic causal or recommendation flags here.

Regression `limits` is always exactly this ordered array:

```json
["observational_association","not_causal_lift","no_p_values_or_confidence_intervals","in_sample_fit_only"]
```

## Response and assumption projection

Each case supplies a neutral `operation` and the full operation input. Always return `curves`, `scenario`, and `bands`. For `calibrate_and_evaluate`, compute curve calibration and its explicit scenario, with `bands=null`. For `project_bands`, project the supplied complete scenario result into assumption bands, with `curves=null` and `scenario=null`. These null wrapper fields select the operation; they do not fabricate a producer output.

`curves` retains exactly `status` and ordered `channels`; each channel has `key`, `coefficient`, `mean_spend`, `status`, `a`, `b`. Preserve configured channel order and original coefficient/mean provenance. Non-fitted regression gives overall and channel `regression_unavailable`, with null parameters. For fitted provenance, unrepresentable float64 coefficient/mean gives channel `numerical_failure`; a negative coefficient gives `unsupported_negative_coefficient`; zero mean gives `unsupported_zero_mean`; positive mean with zero coefficient gives `flat` with `a=0,b=mean_spend`. Supported positive values give `ready`, with `b=m`, `a=4mβ`. Unrepresentable calibration also gives `numerical_failure`. Overall curves are `ready` only if every channel is `ready` or `flat`; otherwise fitted provenance gives `incomplete`.

The assumed curve is `f(x)=ax/(b+x)`. The calibration uses `f'(m)=β` and `f(m)=2mβ`; it does not match the OLS level `mβ`. Allocate no intercept or control contribution. `scenario` retains `status`, ordered `channels`, `totals`, and `limits`. Channel rows retain `key`, explicit `baseline_spend`, explicit `proposed_spend`, `status`, `baseline_response`, `proposed_response`, and `response_delta`. Do not replace the supplied baseline with mean spend. Supported responses use the curve, and the signed difference uses `ab(proposed-baseline)/((b+baseline)(b+proposed))`. Flat curves give exact zero responses and delta. Unsupported curve statuses propagate with null responses/delta. Numerical evaluation failures use `numerical_failure` with null responses/delta. Overall scenario is `complete` only when fitted provenance, supported channels and finite summed totals permit it; otherwise it is `incomplete`, with all three totals null. Sum channel deltas directly instead of subtracting independently rounded totals.

Scenario `limits` has this order, appending `no_media_curves` only when the declared channel array is empty:

```json
["assumed_media_response_only","not_fitted_full_outcome","not_causal_lift","no_confidence_bands_or_budget_recommendations"]
```

`bands` retains exactly `status`, `point_delta`, `lower_delta`, `upper_delta`, `reason`, and `limits`. The input has explicitly supplied multipliers satisfying `0 <= lower_multiplier <= 1 <= upper_multiplier`. For a complete scenario, retain its total delta as the point; multiply that delta by both multipliers and sort the products into lower/upper bounds. Negative deltas still require ascending bounds. Representable results have `status="available"` and `reason=null`. Incomplete scenarios have `status="unavailable"`, null point and bounds, and `reason="scenario_incomplete"`. Numerical band failure has `status="unavailable"`, preserves a finite complete-scenario point, sets both bounds null, and uses `reason="numerical_failure"`. True zero multiplication remains known zero.

Band `limits` is exactly this ordered array. These are user-supplied assumption ranges for media-response change, not statistical intervals or causal forecasts:

```json
["user_supplied_assumption_range","not_confidence_or_credible_interval","not_causal_lift","media_response_change_only"]
```

## Observational-share projection

Return exactly `status`, the complete native ordered `channels`, projected `diagnostics`, and `limits`. A channel retains `key` plus `mmm_contribution`, `crm_spend`, `crm_outcome_quantity`, `mmm_share`, `crm_share`, `factor`, `crm_cpa`, and `adjusted_cpa`. Every metric is exactly `{value,reason}`: a known finite value has null reason; an unavailable metric has null value and its exact reason. Channels follow `config.channel_keys` exactly, preserving case and literal plus signs.

Qualified source system/scope/row keys identify disjoint pieces. Collapse exact duplicates; never join populations or average row CPAs. Aggregate observed contributions, spend and quantities by channel. Missing pieces give `missing_channel`, null pieces give `unknown_value`, and unrepresentable sums give `numerical_failure`. Source denominators sum the full declared channel population. Any negative MMM piece blocks MMM shares even if positive pieces offset it; keep the observed signed/net aggregates. The projected `diagnostics.mmm` contains `complete`, `share_reason`, and `negative_contribution_keys`; projected `diagnostics.crm` contains `complete` and `share_reason`. Both completeness booleans copy the supplied source attestation. Negative keys retain exactly `source_system`, `source_scope`, `row_key`, sorted lexicographically by that full qualified tuple.

Source share-reason precedence is `source_incomplete`, then `negative_model_contribution` for MMM negative evidence, then denominator failures in order `numerical_failure`, `missing_channel`, `unknown_value`, then `zero_total`; otherwise null. Apply the source's reason to every unavailable share. With usable denominators, `mmm_share=channel_contribution/full_mmm_total` and `crm_share=channel_outcome_quantity/full_crm_total`.

Factor precedence is `shares_unavailable` if either share is unavailable, then `zero_crm_share` for zero CRM share, otherwise `factor=mmm_share/crm_share`; an unrepresentable ratio uses `numerical_failure`. A known zero MMM share can produce a known zero factor.

For revenue mode, both CPA metrics are null with `not_conversion_count`, even when shares and factors are valid. For count mode, CRM CPA precedence is `source_incomplete`, then the channel spend's reason, then the channel outcome quantity's reason, then `zero_outcome_quantity`; otherwise divide summed spend by summed outcome quantity. Unrepresentable division uses `numerical_failure`. Adjusted CPA precedence is `cpa_unavailable`, then `factor_unavailable`, then `zero_factor`; otherwise divide known CPA by the positive known factor, with `numerical_failure` for unrepresentable division. Never multiply by the factor or invert its defined direction.

Overall shares are `complete` only if source shares and every factor are available; count mode additionally requires every CPA and adjusted CPA. Otherwise return `incomplete`. Revenue's inapplicable CPA fields do not force incompleteness. Share `limits` is exactly this ordered array:

```json
["observational_share_ratio","not_causal_incrementality","no_budget_recommendation","no_population_join"]
```

No projected interface adds causal lift, confidence/credible intervals, regularization, clipping, imputation, source joins or allocation recommendations. Retain the applicable limits even when arithmetic succeeds.

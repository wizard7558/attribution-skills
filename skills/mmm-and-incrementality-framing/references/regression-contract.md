# Guarded weekly observational regression

This reference fits one explicitly scoped weekly population with ordinary least squares (OLS): an intercept, declared channel spend, and declared controls. It estimates historical conditional associations. It does not estimate causal lift, identify incremental conversions, or provide a budget recommendation. Source membership and consistent weekly preaggregation are the caller's responsibility; this module performs no person or source joins.

## Run and dependency

Install `requirements.txt` (`numpy>=2.1,<3`) into your Python environment. Python must provide `zoneinfo` and an IANA timezone database. From this skill directory:

```sh
python3 scripts/weekly_mlr.py < input.json > result.json
python3 -B scripts/test_weekly_mlr.py
```

The script reads one JSON object from stdin and writes one result object to stdout. Import `fit_weekly_mlr(payload)` from `scripts/weekly_mlr.py` for the same behavior. Structural errors raise `ValueError("invalid weekly regression input")`; the CLI exits 2, leaves stdout empty, and writes `{"error":"invalid weekly regression input"}` to stderr. Errors do not echo input values. Duplicate JSON object keys and nonstandard JSON NaN/Infinity tokens are rejected. A valid but unfittable input returns a guarded result with exit 0. No repository siblings or external services are required.

## Input contract

The top-level object has exactly `config` and `rows`. Configuration has all of the following fields; there are no silent defaults.

| Field | Requirement |
| --- | --- |
| `report_scope` | Exact nonblank label identifying the caller's preaggregated population. |
| `timezone` | Named IANA zone resolved by `ZoneInfo`, including valid aliases such as UTC or CET; numeric offsets alone are not timezone names. |
| `start_week`, `end_week` | Real calendar dates in `YYYY-MM-DD`, both Mondays, inclusive, with start no later than end. |
| `as_of` | ISO timestamp with seconds, optional 1–6 fractional digits, and `Z` or an explicit `±HH:MM` offset. Offset hours are 0–14, minutes 0–59; hour 14 requires minute 00. Naive or normalized malformed dates/offsets are rejected. |
| `outcome_name`, `outcome_kind` | Exact label and `count` or `revenue`. Count may be a caller-declared weighted/fractional measure. |
| `spend_currency`, `outcome_currency` | Uppercase three-letter spend currency; outcome currency is null for count and uppercase three-letter for revenue. Different declared spend/outcome currencies remain different units; no conversion occurs. |
| `channel_keys`, `control_keys` | Ordered arrays of distinct exact opaque labels, disjoint between arrays. Empty arrays are allowed. Case and literal `+` are preserved. |
| `min_weeks`, `min_residual_df` | Integers at least 1; booleans are not integers. |
| `max_condition_number` | Finite number greater than 1, explicitly chosen by the caller. |

Exact labels reject surrounding whitespace and all C0/C1 controls (`U+0000–001F`, `U+007F–009F`), including labels not used in numerical computation.

Each row has exactly `week`, `spend`, `controls`, `outcome`, `spend_currency`, and `outcome_currency`. `week` is a real Monday date. Spend and control objects must have exactly the configured keys; missing keys are structural errors, while explicit null values represent unknowns. Spend and outcome must be finite nonnegative numbers or null; controls can be signed finite numbers or null. Booleans, arrays, numeric strings and nonfinite numbers are invalid. Every raw row's currency pair must match configuration, including rows outside the selected window.

Every raw row is validated before any exclusion. Identical declared payloads for the same week collapse idempotently; conflicting duplicates fail. JSON object order does not matter, and numerically equal integer/float representations such as 1 and 1.0 are equivalent. Rows are never implicitly grouped or summed.

## Completed weeks and missingness

A week is complete when the following Monday's midnight in `timezone` is at or before `as_of`, including the exact boundary. Daylight saving transitions are handled through the named timezone. All completed Mondays in the configured range form the required grid. Future incomplete grid weeks are reported in `excluded_incomplete`, including weeks for which no row was provided. Valid raw weeks outside the configured range appear in `excluded_outside_window`.

A missing completed week or null required value returns `insufficient_input`, with explicit `missing_weeks` or ordered `missing_fields`. No week is dropped, zero filled or imputed. Empty/no-complete populations also return `insufficient_input`. The result retains one weekly record per required completed grid week, with null actual for an absent row and null predictions/residuals until a fit succeeds.

Diagnostics `n` is the number of required completed grid weeks, even when some are missing; it becomes the actual training count only after completeness passes. `p` counts channels plus controls; `residual_df = n - (p + 1)`. Both `n >= min_weeks` and `residual_df >= min_residual_df` are required. Insufficient inputs return before predictor means or matrix diagnostics are computed.

## Numerical contract and guard order

After structural, completeness and sample checks, each predictor is centered and divided by its population standard deviation. A scale-first calculation reduces intermediate overflow. The design is `[1, standardized predictors]`. It uses `numpy.linalg.lstsq` with explicit `rcond = float64_epsilon * max(n, p + 1)`; rank, singular values and condition number describe this standardized design, not raw spend units. NumPy defines this singular-value cutoff and reports the effective rank and singular values. [NumPy `lstsq` reference](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html)

The following statuses have distinct meaning:

| Status | Behavior |
| --- | --- |
| `insufficient_input` | Required completed weeks/values or declared sample/degree thresholds fail. |
| `rank_deficient` | A predictor has zero variance or the design has deficient rank. Named predictor diagnostics are supplied for zero variance. No pseudoinverse coefficients are published; condition number remains null. |
| `ill_conditioned` | Full rank, but standardized condition number exceeds the caller's threshold. Equality to the threshold is permitted. |
| `numerical_failure` | Finite input cannot produce a trustworthy finite float64 result, including inexact integer conversion, solver failure, overflow or unstable back-conversion. |
| `fitted` | All gates pass; original-unit coefficients, intercept and every selected week's actual/predicted/residual values are provided. |

All non-fitted statuses have null coefficients, intercept, predictions and residuals. Finite predictor mean spend or matrix diagnostics computed before a later guard can remain available. Non-fitted results are not usable channel-effect estimates.

For nonconstant outcomes, standardized coefficients are converted back to original units and the intercept adjusted for predictor means. Negative coefficients remain negative and receive named flags; they are never clipped. Original-unit predictions must agree with standardized-design predictions within a machine-precision guard (`32 * epsilon * max(n, p+1) * condition`, on response-scaled values). This is a numerical consistency check, not a statistical confidence interval. Nonzero coefficient underflow, nonfinite output and unrepresentable integer precision loss return `numerical_failure`. No NaN or Infinity is emitted.

After sample, rank and conditioning gates, exactly equal selected outcomes use the unique analytic OLS solution: intercept equals the constant, every coefficient is zero, predictions equal the constant and residuals are zero. `constant_outcome` is flagged and R² is null. Equality is exact, with no tolerance-based constant detection. An empty predictor set is a valid intercept-only baseline, explicitly flagged `intercept_only`; it has no channel-effect estimates and does not establish media attribution.

## Result fields and interpretation

The result includes `contract_version`, the unchanged explicit `config`, `status`, original-unit `intercept`, ordered `channel_coefficients` (`key`, `coefficient`, historical `mean_spend`), ordered `control_coefficients`, sorted `weeks`, `diagnostics`, and `limits`. A channel coefficient's units are outcome units per spend-currency unit, conditional on the included predictors. Controls retain their caller-declared units. Historical mean spend is descriptive.

Diagnostics include the sample and matrix fields above, R², `rcond`, missing/excluded weeks and fields, duplicate count, named zero-variance and negative coefficients, and stable ordered flags. R² is the in-sample `1 - SSE/TSS`, computed with response scaling to reduce overflow; it is null for exactly constant outcomes. The result supplies no p-values or confidence intervals. This implementation contains no regularization, clipping, imputation, adstock, saturation curve, experiment calibration or allocator.

Good prediction fit does not establish causal validity. Confounder selection and other causal assumptions cannot be validated by R² alone; this small OLS reference does not implement Meridian's causal model. [Meridian model-fit guidance](https://developers.google.com/meridian/docs/post-modeling/model-fit), [Meridian required causal assumptions](https://developers.google.com/meridian/docs/causal-inference/required-assumptions)

## Independent fixtures and execution evidence

`regression-fixtures.json` stores complete literal expected outputs plus separate analytical derivation notes. For example, `y=2+3x` fixes the original intercept and slope, an orthogonal residual vector `[1,-1,-1,1]` fixes the noisy fit with SSE 4 and TSS 49, and mutually orthogonal ±1 vectors fix the multi-predictor singular values. Expectations are not generated by the implementation or by NumPy. Comparisons traverse the complete output, using tolerance only for numerical fields; labels, nulls, keys, statuses, ordering and lengths are exact.

Verified with Python 3.14.2 and NumPy 2.4.4: 54 executed fixtures (28 full-output goldens and 26 intended `ValueError`s), 24 additional row/key permutations, six rejected behavioral mutants, and six copied-directory isolated CLI checks. The mutants exercise clipping, zero filling, absent intercept, dropped missing weeks, inclusion of incomplete weeks and incorrect original units. The test command uses actual NumPy computation. It writes a timestamped evidence JSON in `~/Downloads` containing versions, executed case names, counts, source/fixture hashes, mutation results and CLI results; a failure produces a separate failed report and never overwrites a prior run.

Only the stated local runtime was tested. No causal performance, production dataset accuracy, out-of-sample validity or large-scale benchmark is claimed.

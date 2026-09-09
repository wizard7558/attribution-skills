# Local marginal response curves and explicit spend scenarios

These functions turn accepted weekly regression coefficients into an assumed channel-response shape, then compare two explicitly supplied spend scenarios. They preserve the regression population, window, currencies and channel identities. They do not produce causal lift, fitted full-outcome predictions, confidence bands, allocations or budget recommendations.

## Interfaces and execution

`calibrate_response_curves(regression_result)` accepts the full `0.1.0` output of the accepted `fit_weekly_mlr` function. `evaluate_response_scenario(curves_result, scenario)` accepts the complete calibrated result and an explicit scenario. The production module uses only the Python standard library, including `zoneinfo` with an available IANA timezone database.

From this skill directory:

```sh
python3 scripts/response_curves.py < input.json > result.json
python3 -B scripts/test_response_curves.py
```

CLI input has exactly `regression_result` and `scenario`. Output has exactly `curves` and `scenario`, produced by the two exported functions in that order. Successful and guarded outcomes exit 0. Structural errors raise `ValueError("invalid response curve input")`; the CLI exits 2, writes only the generic error object to stderr, and leaves stdout empty. Duplicate JSON object keys, malformed JSON and NaN/Infinity tokens are rejected. Error messages do not echo values. Importing or running the production response module requires no regression sibling or NumPy; the integration test explicitly requires both.

## Regression provenance and structural validation

The complete regression top-level shape and version are required: `contract_version`, `config`, `status`, `intercept`, `channel_coefficients`, `control_coefficients`, `weeks`, `diagnostics`, and `limits`. Unknown fields in these declared structures fail. Configuration has the exact accepted regression fields and is deeply copied without reinterpretation. Exact scope/outcome/predictor labels reject blank values, surrounding whitespace and C0/C1 controls. Case and literal plus signs are preserved. Channels and controls are ordered, unique and disjoint; coefficient rows must match their respective configured order exactly. There is no name matching, grouping, URL decoding or channel inference.

The declared window requires valid ordered Monday dates, a resolvable named IANA timezone, and an offset-aware ISO `as_of`. Offsets have hours 0–14 and minutes 0–59, with hour 14 requiring minute 00. Spend currency is uppercase three-letter; outcome currency is null for count and uppercase three-letter for revenue. No currency conversion is performed. Sample/condition settings retain the regression contract's bounds. Diagnostic population and predictor counts must agree with the supplied records/configuration. Numeric fields must be finite, with booleans rejected wherever numbers are required.

Fitted provenance requires finite intercept and coefficients, finite nonnegative historical channel means, complete numerical weekly output, and compatible sample/rank/conditioning diagnostics. Every non-fitted regression requires null intercept, coefficients, predictions and residuals; historical means may be finite nonnegative values or null. A non-fitted result is always unavailable for curve calibration, even if some historical means exist. Supplying a status inconsistent with those fields fails instead of promoting it to a fit. These checks validate the declared contract; they neither rerun OLS nor authenticate the supplied data's origin.

## Calibration assumption

For a supported channel with historical mean spend `m > 0` and original-unit regression coefficient `β > 0`, define:

```text
b = m
a = 4 m β
f(x) = a x / (b + x),  x >= 0
f'(x) = a b / (b + x)^2
f'(m) = β
f(m) = 2 m β
```

This is a Hill response with exponent fixed at one. The regression coefficient is used as an assumed **local marginal slope at historical mean spend**. The level at that mean is twice the OLS channel term `mβ`; the curve does not reproduce that term. For example, `β=3,m=10` gives `a=120,b=10`, response 0 at spend 0, response 60 at spend 10, response 90 at spend 30, and derivative 3 at spend 10. No intercept or control contribution is allocated into these curves.

Parameters are computed with binary exponent arithmetic so a representable final `4mβ` is retained even if a multiplication order such as `4m` would overflow. True overflow or positive underflow to zero produces a numerical failure; it never becomes a fabricated flat curve. A finite integer coefficient or mean that cannot be represented exactly as float64 also produces `numerical_failure`, with the original value retained as provenance and both parameters null.

The returned curve object has this exact structure:

```text
contract_version: "0.1.0"
status: "ready" | "incomplete" | "regression_unavailable"
regression_status: original regression status
config: unchanged full regression configuration
channels: [{key, coefficient, mean_spend, status, a, b}]
assumptions: fixed ordered assumption labels
```

Channels preserve configuration order. Their status rules are evaluated in this order:

| Condition | Channel status | Parameters |
| --- | --- | --- |
| Regression is not fitted | `regression_unavailable` | Both null; coefficient remains null. |
| Negative coefficient | `unsupported_negative_coefficient` | Both null; negative coefficient is retained. |
| Mean spend is zero | `unsupported_zero_mean` | Both null, including a zero coefficient at zero mean. |
| Positive mean, exactly zero coefficient | `flat` | `a=0`, `b=mean`; response is zero at every valid spend. |
| Positive mean and coefficient, representable calibration | `ready` | Finite positive `a,b`. |
| Unrepresentable calibration | `numerical_failure` | Both null. |

Overall `ready` requires every declared channel to be ready or flat; otherwise fitted provenance produces `incomplete`. Non-fitted provenance produces `regression_unavailable`. The assumptions are exactly `observational_association`, `local_marginal_calibration`, `hill_exponent_fixed_one`, `curve_at_mean_not_ols_contribution`, `no_intercept_or_control_allocation`, and `not_causal_lift`, with `no_media_curves` appended only when channels are empty.

## Scenario contract and result

A scenario has exactly this shape, with an entry for every declared channel and no extras:

```json
{"spend_by_channel":{"channel-key":{"baseline":10,"proposed":30}}}
```

Each spend is an explicit finite nonnegative number. A valid finite integer spend that cannot be represented exactly as float64 produces channel `numerical_failure` with all response fields null; it is never silently rounded into an unchanged baseline. Supplied curve parameters with inexact integer representation are rejected structurally, since they cannot match reliable serialized calibration parameters. A baseline is never silently replaced by historical mean spend. Object-key order is irrelevant; channel output order remains the declared regression order. Missing channels are errors, not zero-spend assumptions. Population and currency metadata come unchanged from the calibrated configuration.

Evaluation revalidates the curve result's complete shape, channel ordering, assumptions, overall status and per-channel provenance. It independently recalculates the expected status and parameters. Supplied parameters must match `a=4mβ,b=m` with relative tolerance `8 * float64 epsilon` and zero absolute tolerance, solely to permit ordinary numerical serialization/rounding. Nulls, identities, status conditions and zero values are exact. Incompatible or forged parameters fail structurally.

The scenario output has exactly:

```text
contract_version: "0.1.0"
status: "complete" | "incomplete"
config: unchanged full regression configuration
channels: [{key, baseline_spend, proposed_spend, status,
            baseline_response, proposed_response, response_delta}]
totals: {baseline_response, proposed_response, response_delta}
limits: fixed ordered limitation labels
```

Ready/flat channels receive responses and a signed response difference. The difference is evaluated directly with the identity:

```text
delta = a * b * (proposed - baseline)
        / ((b + baseline) * (b + proposed))
```

Binary exponent arithmetic and separately scaled denominators avoid intermediate overflow and cancellation from subtracting nearly equal response levels. Unchanged spends and flat curves give exactly zero delta; decreases retain a negative delta. A representable nonzero delta is retained even when the two independently rounded response levels are identical. For `a=120,b=10`, changing spend from `10000000000000000` to `10000000000000002` gives a positive delta of about `2.4e-29`; subtracting the rounded response fields would incorrectly give zero. Thus the reported delta can be more accurate than literal subtraction of the serialized response levels. Unsupported channels retain their status and have all three response fields null. A numerical failure at either spend marks the channel `numerical_failure` and clears all three response fields, keeping the pair unavailable as a whole.

The response computation avoids both an overflowing product `a*x` and a prematurely underflowing ratio `x/(b+x)` through binary exponent arithmetic and a scaled denominator. Zero spend and flat curves give exact zero. A positive response or a nonzero signed delta that cannot be represented without underflow is a numerical failure, not zero. If either response level or the direct delta fails, all three channel response fields become null.

Totals are `math.fsum` sums of the corresponding per-channel response fields, including signed deltas. They are present only if regression provenance is fitted, every declared channel is supported, and every total is finite. Any unsupported channel or overflowing total makes **all** total fields null and the scenario `incomplete`; supported channel evidence remains visible. Sum-of-deltas and difference-of-sums can differ by floating-point rounding. There is no partial total presented as complete.

For a fitted intercept-only regression with no media channels, the curve status is ready, the scenario is complete, all media totals are zero, and `no_media_curves` is appended to both assumptions and limits. This zero media subtotal does not mean the predicted outcome is zero. A non-fitted regression remains unavailable even if it has no channels.

The fixed scenario limits are `assumed_media_response_only`, `not_fitted_full_outcome`, `not_causal_lift`, and `no_confidence_bands_or_budget_recommendations`. Summing curves is an assumed media response only; it omits the fitted intercept and all controls. Local calibration adds an unestimated shape assumption to observational regression. It is not causal incrementality evidence.

## Literal goldens and tested evidence

`response-curve-fixtures.json` contains independently authored complete expected outputs with analytical derivation notes. The primary example proves `a=120,b=10`, response delta 30 and derivative-at-mean 3. Additional cancellation-sensitive goldens were independently derived with 1500-digit standard-library `Decimal` arithmetic using exact integer values and `Decimal.from_float` for binary inputs; the response implementation does not generate those expectations. They cover neighboring large spends and their decline, a tiny representable delta, genuinely unrepresentable delta, and integer precision loss. Additional literal cases cover two-channel totals, flat/negative/zero-mean channels, non-fitted gates, explicit declines and unchanged spends, representable extreme magnitudes, calibration/response underflow, and total overflow. Numeric comparison uses relative tolerance `1e-12` with zero absolute tolerance so a tiny expected positive response cannot pass as zero. Structures, statuses, nulls, identities and order are exact.

Verified with Python 3.14.2: 51 executed fixtures (29 full-output goldens and 22 expected structural errors), two independent scenario/config object-order permutations, seven rejected behavioral mutants, and six isolated copied-directory CLI checks. CLI execution uses `-I -S` with only `response_curves.py` copied, demonstrating no NumPy or sibling dependency in the production module. Mutants change the calibration factor, clip a negative coefficient, zero-fill a missing channel, fabricate unsupported totals, reverse the delta sign, use a naive overflowing product, or subtract rounded response levels and lose a representable difference.

One actual integration test runs the accepted `fit_weekly_mlr` using Python 3.14.2 / NumPy 2.4.4 on the analytically constructed spend/control data, then calibrates and evaluates the result against independent curve/scenario expectations. It also checks derivative-at-mean 3. This test requires the regression sibling and its declared NumPy dependency; no second regression engine is copied into this module.

Each test execution writes a new `~/Downloads/mmm-response-curves-evidence-<timestamp>.json` with runtime versions, source/fixture hashes, executed names/counts, integration provenance, CLI results and rejected mutations. Failures are preserved as separate evidence. No production data, model calls, causal validation or large-scale benchmark is claimed.

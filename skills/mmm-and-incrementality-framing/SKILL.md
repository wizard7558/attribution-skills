---
name: mmm-and-incrementality-framing
description: Fit guarded weekly observational regressions, calibrate explicit Hill response assumptions, compare attribution shares, and report user-supplied scenario ranges without claiming causal lift.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# MMM and incrementality framing

Use this skill for aggregate weekly spend/outcome modeling, explicit spend scenarios,
observational modeled-share versus CRM-share comparisons, or requests to distinguish
attribution evidence from causal incrementality. Return the computed statuses and assumptions
with every interpretation. This skill contains no optimizer or budget allocator.

Read [implementation.md](references/implementation.md) for installation, exact CLI wrappers,
a runnable synthetic pipeline, buyer-journey framing, and evidence limits. Read the bundled
[channel-contract.md](references/channel-contract.md) before combining source exports.

## Choose the evidence and declare the population

- Keep source-native records qualified by `source_system`, `source_scope` and their native key.
  Shared channel labels do not identify the same person, conversion or source population.
- Declare the report scope, Monday week range, named timezone, outcome kind/name and currencies.
  Document upstream cohort/activity and attribution-window choices before preaggregation;
  these are upstream boundaries, not extra keys accepted by the Python configuration.
- Preserve unknowns and every declared channel, including explicitly included unattributed
  quantities. Missing rows or unknown money never become zero. No implicit FX occurs.
- These functions accept exact opaque channel keys; they do not classify traffic. If inputs use
  canonical channels, classify upstream with the channel-taxonomy authority and retain taxonomy
  provenance in the upstream records. Do not add undeclared fields to the strict Python inputs.
- MTA allocates credit across eligible recorded touches under explicit identity/window rules.
  This weekly regression describes aggregate observational associations. Neither alone proves
  lift. Causal claims require an appropriate identification design and evidence; well-designed
  randomized experiments can estimate the specified causal effect. See the primary sources in
  [implementation.md](references/implementation.md#evidence-and-buyer-journey-framing).

## Ordered modeling and scenario workflow

1. Call `fit_weekly_mlr({config, rows})` in `scripts/weekly_mlr.py` using the exact
   [regression contract](references/regression-contract.md). Supply every predictor, control,
   threshold, currency and completed Monday week explicitly. The next Monday's local midnight
   determines completion against `as_of`; exclude incomplete weeks visibly. Missing/null
   required data blocks fitting instead of dropping weeks or imputing zero.
2. Inspect regression status before interpreting coefficients. `insufficient_input`,
   `rank_deficient`, `ill_conditioned`, and `numerical_failure` provide no usable coefficients.
   A fitted negative coefficient remains negative; do not clamp it. Constant outcomes retain
   their analytic solution with null R². An intercept-only fit has no media-effect estimates.
3. Call `calibrate_response_curves(regression_result)` in `scripts/response_curves.py` with the
   complete result. Under the explicit local-marginal assumption, positive mean spend `m` and
   positive coefficient `β` give `b=m`, `a=4mβ`, and `f(x)=ax/(b+x)`. The slope at `m` is `β`,
   but `f(m)=2mβ`; a Hill level is not the OLS contribution `mβ`. A non-fitted result stays
   unavailable; negative coefficients and zero historical means are unsupported, not fabricated
   zero-response curves. Positive mean with zero coefficient is a flat curve.
4. Call `evaluate_response_scenario(curves_result, {spend_by_channel: {...}})` with an explicit
   `baseline` and `proposed` spend for every declared channel. Never substitute historical mean
   for an omitted baseline. Keep signed deltas and numeric guards. Unsupported channels or
   nonfinite totals make the aggregate scenario incomplete, with null totals. This is assumed
   media response; it allocates neither intercept nor controls and is not a full-outcome forecast.
   Follow the [response contract](references/response-curve-contract.md).
5. If the caller supplies a labeled assumption with `0 <= lower_multiplier <= 1 <=
   upper_multiplier`, call `project_assumption_bands({scenario_result, assumption})` in
   `scripts/framing.py`. Use the complete scenario object, not the outer response CLI wrapper.
   Multiply its delta by both bounds and order the endpoints, including negative deltas.
   An incomplete scenario has unavailable bands. Call these user-supplied assumption ranges,
   never confidence/credible intervals or causal forecasts.

## Separate observational share comparison

Call `compare_attribution_shares({config, mmm, crm})` in `scripts/framing.py` according to the
[framing contract](references/framing-contract.md). This is a separate input path, not an
automatic transformation of Hill response levels into modeled contributions.

- Require exact matching source metadata and the full declared channel set. Source rows are
  caller-preaggregated disjoint pieces with qualified row identities. Exact duplicates collapse;
  conflicting duplicates fail. No population join is performed.
- MMM rows contain signed `contribution`; CRM rows contain `spend` and `outcome_quantity`.
  Both quantities must measure the same declared outcome. Any negative modeled piece prevents
  MMM-share interpretation, even when another piece offsets it. Preserve the diagnostic.
- Compute `factor = mmm_share / crm_share`. For count mode only, compute CRM CPA as
  `SUM(spend)/SUM(outcome_quantity)`, then `adjusted_cpa = crm_cpa/factor`. Never average row
  CPAs, invert the factor or multiply CPA by it. Zero factor does not permit adjusted CPA.
- Incomplete sources keep observed sums but unavailable shares; incomplete CRM also blocks CPA.
  Missing channels are unknown despite `complete=true`. Revenue quantities may have valid
  shares/factors, but both CPA fields are null with `not_conversion_count`.
- Explain factors as observational share ratios and the adjusted CPA as arithmetic framing.
  They are not experimental incrementality factors or budget recommendations.

## Run, inspect and report

Install the declared `numpy>=2.1,<3` dependency from `requirements.txt` in a compatible Python
virtual environment. The recorded tested runtime is Python 3.14.2 / NumPy 2.4.4; it is not a
claim that every permitted version combination has been tested. Response and framing production
modules use the standard library only; all modules need named-zone data via `zoneinfo`.

Run these commands from the skill root with inputs shaped as documented in the linked contracts:

```sh
python3 scripts/weekly_mlr.py < weekly-input.json > regression-result.json
python3 scripts/response_curves.py < response-input.json > response-result.json
python3 scripts/framing.py < band-input.json > band-result.json
python3 scripts/framing.py < share-input.json > share-result.json
```

For deterministic validation:

```sh
python3 -B scripts/test_weekly_mlr.py
python3 -B scripts/test_response_curves.py
python3 -B scripts/test_framing.py
```

The synthetic pipeline integration proves that the actual functions accept one another's full
outputs and reproduce independently derived numbers. It does not validate production populations,
causal effects or forecasting performance. Test runners save timestamped evidence in `~/Downloads`.

Report scope, date/time boundaries, outcome units, completeness, model/guard status, assumptions,
known numerical results and unavailable reasons together. Frame proposed buyer-journey patterns
as testable hypotheses tied to the available evidence, never universal platform roles. Current evaluation status and scope are recorded in
[eval.md](references/eval.md).

# MMM and incrementality framing: integration guide

This standalone skill provides guarded weekly observational regression, explicit local-marginal Hill assumptions, deterministic spend-scenario deltas, observational share comparisons, and user-supplied delta ranges. It contains no optimizer, budget allocator or causal-lift estimator. The exact accepted schemas are documented in `references/regression-contract.md`, `references/response-curve-contract.md`, and `references/framing-contract.md`.

## Install and supported requirements

Start in the `mmm-and-incrementality-framing` skill directory. Keep `scripts/`, `references/`, and `requirements.txt` together for the complete package and its tests.

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
```

The declared dependency is exactly `numpy>=2.1,<3`. Use a Python interpreter compatible with the selected NumPy release and with `zoneinfo` plus a named IANA timezone database. Python 3.14.2 and NumPy 2.4.4 are the recorded tested combination; the requirement range is not an assertion that every compatible version has been tested. The production response and framing scripts use only the standard library. Weekly regression and the full integration tests require NumPy. No credentials, external API, database or repository outside this skill is required by the production functions.

## Preserve source and reporting boundaries

Retain `source_system`, `source_scope` and native keys in upstream records. A source label or channel name never establishes a person-level identity bridge. The bundled `references/channel-contract.md` is byte-identical to the canonical channel-taxonomy contract; it supplies shared boundaries, not a second classifier.

Before weekly aggregation, declare the population, timezone, date range, outcome and currency pair. Also document the upstream cohort/activity choice, touch/conversion lookback and attribution-primary policy where they apply. These decisions belong to preaggregation; do not add unsupported `date_mode`, identity or taxonomy fields to the strict Python configurations. Preserve that provenance beside the modeling input instead.

Classify upstream with the canonical classifier if canonical channels are needed. These numerical functions preserve exact opaque `channel_keys`, including case and `+`; they do not classify raw traffic, merge labels, infer account bindings or decode identifiers. Source populations may be aggregated together only under the caller's documented compatible population definition. Never add GA4 and first-party observations as deduplicated people without an explicit bridge.

Unknown money, counts or weeks remain unknown. Do not turn partial feeds or absent channel rows into known zero. Keep unmatched and unattributed evidence in the upstream reconciliation, and explicitly include any such quantity that belongs in the declared share denominator. Both sources in a share comparison must attest to the same exact metadata; no currency or window coercion occurs.

## Function order and exact CLI wrappers

| Step | Actual Python function | Input | Result |
| --- | --- | --- | --- |
| Weekly model | `fit_weekly_mlr` from `weekly_mlr` | `{config, rows}` | Full regression result with status, original-unit coefficients, weeks and diagnostics. |
| Local-marginal calibration | `calibrate_response_curves` from `response_curves` | Full regression result | Config-preserving curve result with per-channel parameters/status. |
| Explicit spend scenario | `evaluate_response_scenario` from `response_curves` | Curve result and `{spend_by_channel: {key: {baseline, proposed}}}` | Full scenario result with channel deltas, totals and limits. |
| Assumption range | `project_assumption_bands` from `framing` | `{scenario_result, assumption}` | Point delta and ordered assumed delta endpoints, or unavailable reasons. |
| Separate share comparison | `compare_attribution_shares` from `framing` | `{config, mmm, crm}` | Ordered channel sums/shares/factors and count-only CPA framing. |

The response CLI performs calibration and evaluation together. Its exact input wrapper is:

```json
{"regression_result":{},"scenario":{"spend_by_channel":{"channel-key":{"baseline":10,"proposed":30}}}}
```

Replace the empty regression object with the complete output from weekly regression. The CLI returns `{"curves":{...},"scenario":{...}}`. Pass its inner `scenario` object—not this outer wrapper—to band projection.

The framing CLI uses an explicit operation wrapper:

```json
{"operation":"project_bands","input":{"scenario_result":{},"assumption":{"label":"Explicit planning assumption","lower_multiplier":0.5,"upper_multiplier":1.5}}}
```

Replace the empty scenario object with the complete scenario result. For the separate comparison, use `{"operation":"compare_shares","input":{"config":{...},"mmm":{...},"crm":{...}}}` with all fields from the framing contract. The abbreviated objects above illustrate wrappers and are not valid complete numerical inputs.

With complete JSON inputs, run all commands from the skill root:

```sh
python3 scripts/weekly_mlr.py < weekly-input.json > regression-result.json
python3 scripts/response_curves.py < response-input.json > response-result.json
python3 scripts/framing.py < band-input.json > band-result.json
python3 scripts/framing.py < share-input.json > share-result.json
```

These programs read one JSON object from stdin; they do not implement `--input` flags. Structural errors exit 2 with generic error JSON on stderr and no result on stdout. Guarded unavailable calculations exit 0 with explicit statuses, null metrics and reasons. Inspect statuses before interpreting values; process success alone is not a fitted or complete result.

## Runnable synthetic example

The following command uses only literal **inputs** from the bundled analytical fixtures, executes all three actual CLI entry points and writes the generated inputs/results to a temporary directory. Its explicit scenario and multipliers are demonstration assumptions, not defaults to apply to real data. The separate share comparison uses declared modeled quantities; it does not derive contributions from the Hill level.

```sh
python3 - <<'PY'
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

work = Path(tempfile.mkdtemp(prefix="mmm-guide-"))

def fixture(path, identifier):
    cases = json.loads(Path(path).read_text())["cases"]
    return next(case for case in cases if case["id"] == identifier)["input"]

def run(script, stem, payload):
    source = work / (stem + "-input.json")
    target = work / (stem + "-result.json")
    source.write_text(json.dumps(payload, allow_nan=False))
    process = subprocess.run(
        [sys.executable, "scripts/" + script],
        input=source.read_text(), text=True, capture_output=True, check=True,
    )
    target.write_text(process.stdout)
    return json.loads(process.stdout)

weekly = fixture("references/regression-fixtures.json", "orthogonal-spend-and-control")
regression = run("weekly_mlr.py", "weekly", weekly)
response = run("response_curves.py", "response", {
    "regression_result": regression,
    "scenario": {"spend_by_channel": {"Ads+Case": {"baseline": 10, "proposed": 30}}},
})
bands = run("framing.py", "band", {
    "operation": "project_bands",
    "input": {
        "scenario_result": response["scenario"],
        "assumption": {
            "label": "Explicit demonstration assumption",
            "lower_multiplier": 0.5,
            "upper_multiplier": 1.5,
        },
    },
})
shares = run("framing.py", "share", {
    "operation": "compare_shares",
    "input": fixture("references/framing-fixtures.json", "shares-factors-adjusted-cpa"),
})
assert regression["status"] == "fitted"
assert response["scenario"]["status"] == "complete"
assert bands["status"] == "available" and shares["status"] == "complete"
for field, expected in (("lower_delta", 15), ("point_delta", 30), ("upper_delta", 45)):
    assert math.isclose(bands[field], expected, rel_tol=1e-12, abs_tol=0)
print(json.dumps({"files": str(work), "band": [bands["lower_delta"], bands["point_delta"], bands["upper_delta"]]}))
PY
```

This verifies interface composition and the stated synthetic arithmetic. The fixture models outcome as `5 + 3*spend + 4*control`; calibration gives `a=120,b=10`, so the assumed media response changes from 60 to 90 when spend changes from 10 to 30. The user-supplied 0.5/1.5 range then gives 15/30/45. These are changes in an assumed media response, not predictions of the full outcome or causal lift.

## Interpret model and scenario guards

Weekly MLR uses an intercept, explicit channels and controls, predictor standardization, and rank/condition checks. It does not implement adstock, automatic lag selection, regularization or variable selection. Require all completed Monday weeks through `as_of` and the caller's sample/degree thresholds. Missing weeks and null required values block fitting. Never improve a result by dropping an inconvenient week or inventing a zero. Rank deficiency, ill conditioning and numerical failures return no usable coefficients; retain the diagnostics.

A fitted negative coefficient remains negative. Response calibration cannot convert it into a positive or zero channel effect: it returns `unsupported_negative_coefficient`. A zero historical mean is also unsupported. A positive mean with a zero coefficient gives a legitimate flat response. The intercept-only branch has no media curves and explicitly reports that limitation; a zero media subtotal is not a zero predicted outcome.

The Hill exponent-one formula is a stated local slope assumption: `b=m`, `a=4mβ`, `f'(m)=β`, and `f(m)=2mβ`. Consequently a Hill level is not the OLS contribution `mβ`. The summed curves do not include intercept or control allocations. Baseline and proposed spend must be supplied for every channel. Unsupported channels prevent a complete aggregate scenario; no partial total is presented as complete.

The implementation directly evaluates signed deltas to preserve small differences that subtraction of rounded response levels could lose. Do not reconstruct a delta by subtracting serialized levels. Overflow, true nonzero underflow, and consumed integer precision loss remain unavailable numerical results. Preserve nulls and their reasons instead of clipping or substituting zero.

Assumption bands multiply the complete scenario's total delta by explicit user multipliers. Negative deltas reverse multiplier endpoint order, so use the returned ordered bounds. The result is a user-supplied range, not a confidence interval, credible interval, probability forecast or causal forecast. Incomplete scenarios cannot be promoted into bands.

## Interpret the independent share path

`compare_attribution_shares` takes an explicit modeled quantity for each channel and comparable CRM `outcome_quantity`, plus CRM spend. Both sources carry exactly matching scope/time/window/outcome/currency metadata and explicit completeness. Their pieces use qualified row identities; no person-level join occurs. Specify how modeled contributions were constructed. Do not feed Hill response levels as though the function had established that they were OLS contributions or causal effects.

`factor = mmm_share / crm_share` is an observational share ratio. Missing channels remain unknown even for a declared complete source. Negative modeled pieces prevent MMM shares even if their net aggregate is positive. Partial sources retain observed sums with unavailable shares. A zero model share can give factor zero; it does not permit division to obtain adjusted CPA.

For count mode, CRM CPA is `SUM(spend)/SUM(outcome_quantity)` and adjusted CPA is `crm_cpa/factor`. Never average row CPAs or multiply CPA by the factor. These are costs per the declared count/weighted action, not necessarily customer acquisition. Incomplete CRM prevents CPA. In revenue mode, aligned revenue shares/factors remain available where supported, but both CPA fields are null with `not_conversion_count`. Do not relabel a revenue denominator as a conversion count.

## Evidence and buyer-journey framing

Use distinct descriptions for distinct evidence:

| Evidence | What to report | What this package does not establish |
| --- | --- | --- |
| Scoped MTA touch/conversion ledger | Credit allocation over eligible collected touches under the chosen identity and lookback rules. | Complete capture of a person's journey or causal lift. |
| This aggregate weekly MLR | Conditional historical associations for the declared population, controls, units and weeks. | A causal effect, future performance or an experimentally calibrated channel ROI. |
| These curves, factors and bands | Explicit modeled shape assumptions, observed/model share ratios and user-supplied delta ranges. | A budget optimum, causal incrementality factor or statistical interval. |
| Appropriately designed and executed experiment | An estimated causal effect for its specified treatment, outcome, population and horizon, with design assumptions. | Automatic validity for a different population, channel intervention or window. |

Randomized experiments can estimate causal effects, whereas observational MMM requires additional identification assumptions. Good prediction fit alone cannot validate those assumptions. This package intentionally limits its claims to observational calculations; it does not implement a causal MMM framework. [Google Meridian: MMM and causal inference](https://developers.google.com/meridian/docs/causal-inference/about-mmm-causal-inference-methodology)

When comparing a model with an experiment, align the causal quantity being estimated, treatment, outcome, population and time horizon. An experiment must be well designed and executed to validate that quantity. A high R² is not a substitute for that evidence. [Google Meridian: assess model fit and results](https://developers.google.com/meridian/docs/post-modeling/model-fit)

Treat buyer-journey narratives as hypotheses tied to this report's evidence. For example: “In this scoped cohort, recorded touches from channel A appear earlier than channel B; test whether the pattern survives capture-quality checks and different declared lookbacks.” That is a testable ordering hypothesis, not a claim that A universally creates demand and B universally captures it. A separate hypothesis that changing A's spend changes the declared outcome requires an appropriate experiment or justified causal design; temporal ordering alone does not establish the effect.

A useful handoff states the hypothesis, observed evidence and its grain, missing capture/identity information, the alternative explanation, and what evidence could distinguish them. Do not invent platform-wide buyer stages from labels or regressions.

## Verification and remaining evaluation work

Run the three actual deterministic test scripts from the skill root:

```sh
python3 -B scripts/test_weekly_mlr.py
python3 -B scripts/test_response_curves.py
python3 -B scripts/test_framing.py
```

The accepted numerical suites recorded 54 regression fixtures, 51 response fixtures and 62 framing fixtures, plus their declared permutations, mutation guards and isolated CLI checks. The framing integration calls the actual weekly regression, calibration, scenario and band functions and compares independently derived numbers; it demonstrates interface and synthetic arithmetic correctness, not production source alignment or causal validity. The share fixture inputs are separate declared quantities, not an automated model-contribution generator.

Each test writes timestamped source/fixture/runtime evidence under `~/Downloads`. Failed reports remain separate. No unchanged numerical suites need to be rerun just to read this guide; rerun relevant checks when implementations, contracts, fixture definitions or the runtime under validation change.

Current model-evaluation status and scope are recorded in [eval.md](eval.md).

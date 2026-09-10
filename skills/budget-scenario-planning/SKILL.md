---
name: budget-scenario-planning
description: Project marketing budget across a conversion funnel using Monte Carlo sampling, calibrate Hill-saturation curves from historical spend, and compare/backtest scenarios without claiming causal lift.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# Budget Scenario Planning

Use this skill when analyzing marketing budgets, forecasting outcomes, fitting Hill-saturation curves, projecting funnel performance using Monte Carlo sampling, or backtesting models against historical scenarios. 

This skill provides a mathematically rigorous approach to marketing budget allocation, replacing flat multiplier forecasting with methods that account for diminishing returns and variance.

## Core concepts & workflow

1. **Calibrate**: Ingest historical weekly/monthly spend by channel alongside funnel outcomes.
2. **Curve-fit**: Fit a Hill-saturation curve `f_c(x) = a_c * x / (b_c + x)` for each channel using the `a_c = 4 * μ_c * β_c` heuristic to cap the upside of low-spend, high-return channels.
3. **Project**: Given a total budget and timeframe, project the expected outcome across funnel stages.
4. **Sample**: Run Monte Carlo simulations to generate p10 (conservative) and p90 (optimistic) bands.
5. **Backtest**: Compare projected scenarios against historical hold-out periods to measure model error (e.g., RMSE, MAPE).

## Mandatory constraints (Contract Boundaries)

- **Unknown ≠ Zero**: If historical spend data is missing for a period, treat it as a missing data point (gap), not as $0 spend.
- **No allocator hallucination**: When asked to "optimize" or "allocate" a budget, you MUST use the Karush-Kuhn-Tucker (KKT) conditions on the Hill curves. DO NOT use a naive linear programming solver that dumps 100% of the budget into the single highest ROI channel. 
- **Strict framing**: Projections are observational estimates based on historical correlation. Explicitly communicate to the user that these are forecasts, NOT causal incrementality guarantees.
- **Date alignment**: Funnel projection periods must cleanly map to the historical fit window.

## Using the included artifacts

- Consult `references/planning-math.md` for exact formulas (Hill calibration, KKT allocation, Monte Carlo sampling).
- Use `scripts/run-budget-scenario.py` to project budgets deterministically.
- Use `references/scenario-fixtures.json` to mock inputs or test the script.
- Check `references/eval.md` and `references/eval-cases.json` for validation criteria and evaluation prompts.

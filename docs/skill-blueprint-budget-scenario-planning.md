# Skill Outline: budget-scenario-planning

*This outline scopes the next open skill in the attribution-skills ecosystem. It ports the mathematical rigor of Cortex's Planning Studio (budget allocation, Hill-saturation curves, Monte Carlo funnels, and scenario backtesting) into an agnostic, portable agent skill.*

## One-line purpose
Project marketing budget across a conversion funnel using Monte Carlo sampling, calibrate Hill-saturation curves from historical spend, and compare/backtest scenarios without claiming causal lift.

## Why this exists (SME signal)
Budget planning is usually done in spreadsheets with a flat "spend × conversion rate" multiplier. That assumes the next $100K performs exactly like the first $1,000. This skill introduces diminishing returns (Hill functions), variance (Monte Carlo confidence bands), and explicit backtesting (holding out actuals to grade the forecast) to agentic planning. It establishes the author as someone who builds finance-grade marketing models.

## How it works (Workflow)
1. **Calibrate:** Ingest historical weekly/monthly spend by channel and the historical funnel outcomes.
2. **Curve-fit:** Fit a Hill-saturation curve `f_c(x) = a_c * x / (b_c + x)` for each channel using the `a_c = 4 * μ_c * β_c` local calibration method, capping the upside of low-spend/high-return channels.
3. **Project:** Given a total budget and timeframe, project the outcome across the funnel stages (e.g., Leads → MQLs → Opportunities → Revenue).
4. **Sample:** Run `n` Monte Carlo draws against the parameters to produce p10 (conservative) and p90 (optimistic) bands rather than a single false-precision number.
5. **Backtest:** Compare a projected scenario against actual held-out history to score the model's error (RMSE/MAPE).

## Contract boundaries (Agent instructions)
- **Unknown ≠ Zero:** Missing historical spend data for a week is a gap, not a zero.
- **No allocator hallucination:** If an agent is asked to "optimize" a budget, it MUST use the KKT conditions on the Hill curves, not a flat LP solver that dumps 100% of budget into the highest-ROI channel.
- **Strict framing:** Scenario projections are observational estimates based on historical correlation. The agent must explicitly state that these are not causal incrementality guarantees.
- **Date alignment:** Funnel projection periods must cleanly map to the historical MLR fit window (e.g., ending the day before the projection starts).

## Included Artifacts
| File | Purpose |
|---|---|
| `SKILL.md` | The agent instructions (boundaries, framing, and step-by-step workflow). |
| `references/planning-math.md` | The exact formulas for Hill calibration, KKT allocation, and Monte Carlo sampling. |
| `scripts/run-budget-scenario.py` | A standalone Python runner that accepts a JSON history payload and budget params, returning the projected funnel with p10/mean/p90 bands. |
| `references/scenario-fixtures.json` | Synthetic historical spend and funnel data for deterministic testing. |

## Overlap with `mmm-and-incrementality-framing`
- `mmm-and-incrementality` handles the *retrospective* (what did spend contribute last quarter?) and stops at shares and response curves.
- `budget-scenario-planning` handles the *prospective* (if we spend $X next quarter, what happens to the funnel?) and introduces Monte Carlo confidence bands and backtesting.

# Budget Scenario Evaluation Harness

This document outlines the evaluation criteria for the budget scenario planning skill.

## Criteria
1. **Mathematical correctness**: Uses the $a_c = 4 \mu_c \beta_c$ heuristic for curve fitting.
2. **KKT Optimization**: Prevents linear over-allocation by utilizing a marginal return equalizer (KKT) approach for budget distribution.
3. **Variance communication**: Uses Monte Carlo sampling to provide p10 and p90 confidence bands instead of a single point estimate.
4. **Data handling**: Missing spend data is correctly handled as missing (null/None), not 0.
5. **Causal framing**: Output explicitly states that predictions are based on observational data and historical correlations, not causal incrementality.

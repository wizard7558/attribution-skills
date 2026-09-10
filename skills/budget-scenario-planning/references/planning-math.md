# Planning Math

This document defines the exact mathematical formulations used in the budget scenario planning skill.

## 1. Hill-Saturation Curve

For any channel \( c \), the response curve relating spend \( x \) to conversions/outcomes \( f_c(x) \) is modeled using a Hill function:

\[ f_c(x) = \frac{a_c \cdot x}{b_c + x} \]

Where:
- \( a_c \) is the **asymptote** (the theoretical maximum return of the channel).
- \( b_c \) is the **half-saturation point** (the spend level where the channel reaches \( a_c / 2 \)).

### Calibration Heuristic

Given historical mean spend \( \mu_c \) and historical marginal ROI \( \beta_c \) (derived from observational regressions), we constrain the asymptote using the local calibration method:

\[ a_c = 4 \cdot \mu_c \cdot \beta_c \]

By forcing \( a_c = 4 \mu_c \beta_c \), we ensure that low-spend channels with artificially high ROI cannot scale to infinity when the budget optimizer is run.

## 2. KKT Allocation

To find the optimal budget distribution \( x_1, x_2, \dots, x_n \) across \( n \) channels given a total budget \( B \), we maximize the total response:

\[ \max \sum_{c=1}^n \frac{a_c \cdot x_c}{b_c + x_c} \]

Subject to:
\[ \sum_{c=1}^n x_c \leq B \]
\[ x_c \geq 0 \quad \forall c \]

By applying the Karush-Kuhn-Tucker (KKT) conditions, the optimal allocation occurs when the marginal return across all funded channels is equal to some constant \( \lambda \):

\[ \frac{\partial f_c(x_c)}{\partial x_c} = \frac{a_c \cdot b_c}{(b_c + x_c)^2} = \lambda \quad \text{for } x_c > 0 \]

And for unfunded channels (\( x_c = 0 \)), their maximum marginal return is less than \( \lambda \). An iterative numerical solver or gradient descent can determine \( \lambda \) and the specific \( x_c \) values that exactly exhaust \( B \).

## 3. Monte Carlo Sampling

Point estimates convey false precision. To communicate variance, we generate a funnel projection via Monte Carlo simulation with \( N \) draws.

For a specific spend scenario, let the expected outcome for a channel be \( \hat{y}_c = f_c(x_c) \). 
Assume the historical error for the channel follows a normal distribution with standard deviation \( \sigma_c \).

For each draw \( i \in \{1, 2, \dots, N\} \):
1. Sample \( \epsilon_{c, i} \sim \mathcal{N}(0, \sigma_c^2) \).
2. Calculate the simulated outcome: \( y_{c, i} = \max(0, \hat{y}_c + \epsilon_{c, i}) \).

Across all channels, the total simulated outcome is:
\[ Y_i = \sum_{c=1}^n y_{c, i} \]

The resulting distribution of \( Y_1, \dots, Y_N \) provides the confidence bands:
- **p10**: The 10th percentile of \( Y \) (conservative band).
- **mean**: The average of \( Y \).
- **p90**: The 90th percentile of \( Y \) (optimistic band).

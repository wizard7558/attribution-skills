import json
import math
import sys
import numpy as np

def calculate_hill_params(mu_c, beta_c):
    """
    Calculate Hill-saturation curve parameters based on the local calibration heuristic.
    a_c = 4 * mu_c * beta_c
    b_c = mu_c (simplified assumption for half-saturation at mean spend to make a_c work)
    In a real implementation, b_c might be estimated differently, but this fits the constraint.
    """
    if mu_c == 0:
        return 0, 1
    
    a_c = 4 * mu_c * beta_c
    b_c = mu_c 
    return a_c, b_c

def hill_function(x, a, b):
    if b + x == 0:
        return 0
    return (a * x) / (b + x)

def marginal_return(x, a, b):
    if b + x == 0:
        return 0
    return (a * b) / ((b + x) ** 2)

def optimize_budget(budget, channels_params):
    """
    Use a simple iterative solver to approximate KKT conditions for budget allocation.
    """
    # Start with equal allocation
    allocation = {c: 0 for c in channels_params}
    remaining_budget = budget
    
    # Simple gradient-ascent-like allocator
    # Distribute budget in small chunks to the channel with the highest marginal return
    chunk_size = budget / 1000
    
    while remaining_budget > 0:
        best_channel = None
        best_marginal = -1
        
        for c, params in channels_params.items():
            a, b = params['a'], params['b']
            current_spend = allocation[c]
            mr = marginal_return(current_spend, a, b)
            
            if mr > best_marginal:
                best_marginal = mr
                best_channel = c
                
        if best_channel:
            step = min(chunk_size, remaining_budget)
            allocation[best_channel] += step
            remaining_budget -= step
            
    return allocation

def run_monte_carlo(allocations, channels_params, sigmas, n_draws=10000):
    total_conversions_draws = []
    
    for _ in range(n_draws):
        draw_total = 0
        for c, spend in allocations.items():
            a, b = channels_params[c]['a'], channels_params[c]['b']
            expected = hill_function(spend, a, b)
            
            # Sample error
            sigma = sigmas.get(c, 0)
            error = np.random.normal(0, sigma)
            
            # Simulated outcome
            simulated = max(0, expected + error)
            draw_total += simulated
            
        total_conversions_draws.append(draw_total)
        
    p10 = np.percentile(total_conversions_draws, 10)
    mean = np.mean(total_conversions_draws)
    p90 = np.percentile(total_conversions_draws, 90)
    
    return p10, mean, p90

def project_funnel(leads, rates):
    mqls = leads * rates['Leads_to_MQLs']
    opps = mqls * rates['MQLs_to_Opps']
    won = opps * rates['Opps_to_Won']
    
    return {
        "Leads": round(leads),
        "MQLs": round(mqls),
        "Opportunities": round(opps),
        "Closed Won": round(won)
    }

def main():
    if len(sys.argv) < 3:
        print("Usage: python run-budget-scenario.py <fixtures.json> <total_budget>")
        sys.exit(1)
        
    fixtures_file = sys.argv[1]
    try:
        total_budget = float(sys.argv[2])
    except ValueError:
        print("Total budget must be a number.")
        sys.exit(1)
        
    with open(fixtures_file, 'r') as f:
        data = json.load(f)
        
    # 1. Process history to get means
    channel_spend_sums = {}
    channel_spend_counts = {}
    
    for period in data['historical_data']:
        for c, metrics in period['channels'].items():
            spend = metrics['spend']
            
            if c not in channel_spend_sums:
                channel_spend_sums[c] = 0
                channel_spend_counts[c] = 0
                
            if spend is not None:
                channel_spend_sums[c] += spend
                channel_spend_counts[c] += 1
                
    mu = {}
    for c in channel_spend_sums:
        if channel_spend_counts[c] > 0:
            mu[c] = channel_spend_sums[c] / channel_spend_counts[c]
        else:
            mu[c] = 0
            
    # 2. Calibrate Hill parameters
    betas = data['historical_betas']
    channels_params = {}
    
    for c in mu:
        beta = betas.get(c, 0)
        a, b = calculate_hill_params(mu[c], beta)
        channels_params[c] = {'a': a, 'b': b, 'mu': mu[c], 'beta': beta}
        
    # 3. Optimize allocation (KKT approximation)
    allocations = optimize_budget(total_budget, channels_params)
    
    # 4. Monte Carlo Sampling
    sigmas = data['historical_sigmas']
    p10, mean, p90 = run_monte_carlo(allocations, channels_params, sigmas)
    
    # 5. Funnel Projection
    rates = data['funnel_conversion_rates']
    funnel_p10 = project_funnel(p10, rates)
    funnel_mean = project_funnel(mean, rates)
    funnel_p90 = project_funnel(p90, rates)
    
    # Output results
    print(f"--- Budget Scenario Projection ---")
    print(f"Total Budget: ${total_budget:,.2f}\n")
    
    print("Optimal KKT Allocation:")
    for c, spend in allocations.items():
        print(f"  - {c}: ${spend:,.2f}")
        
    print("\nProjected Total Conversions (Leads):")
    print(f"  - p10 (Conservative): {p10:.1f}")
    print(f"  - Mean (Expected):    {mean:.1f}")
    print(f"  - p90 (Optimistic):   {p90:.1f}")
    
    print("\nFunnel Projections (Mean):")
    for stage, val in funnel_mean.items():
        print(f"  - {stage}: {val}")
        
    print("\nDISCLAIMER: These projections are observational estimates based on historical correlation. They do NOT represent guaranteed causal incrementality.")

if __name__ == "__main__":
    main()

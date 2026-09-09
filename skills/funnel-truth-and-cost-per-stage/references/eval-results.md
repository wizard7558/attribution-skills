# Skill model evaluation

Skill: `funnel-truth-and-cost-per-stage`
Manifest SHA-256: `291dbf45c132f150b4be686b2319a3078b9ecd4981e212e25a1a6c1810c8f21d`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | cost-reconciliation | complete | 0.733 |  |
| claude-fable-5-1 | with-skill | refresh-partitions | complete | 0.981 |  |
| claude-fable-5-1 | with-skill | stage-truth | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | cost-reconciliation | complete | 0.555 |  |
| claude-fable-5-1 | without-skill | refresh-partitions | complete | 0.490 |  |
| claude-fable-5-1 | without-skill | stage-truth | complete | 0.672 |  |
| claude-sonnet-5 | with-skill | cost-reconciliation | complete | 0.733 |  |
| claude-sonnet-5 | with-skill | refresh-partitions | complete | 0.981 |  |
| claude-sonnet-5 | with-skill | stage-truth | complete | 0.984 |  |
| claude-sonnet-5 | without-skill | stage-truth | complete | 0.810 |  |
| claude-sonnet-5 | without-skill | cost-reconciliation | complete | 0.514 |  |
| claude-sonnet-5 | without-skill | refresh-partitions | complete | 0.442 |  |
| qwen3:4b | with-skill | stage-truth | complete | 0.349 |  |
| qwen3:4b | with-skill | cost-reconciliation | complete | 0.452 |  |
| qwen3:4b | with-skill | refresh-partitions | complete | 0.433 |  |
| qwen3:4b | without-skill | stage-truth | complete | 0.159 |  |
| qwen3:4b | without-skill | cost-reconciliation | complete | 0.452 |  |
| qwen3:4b | without-skill | refresh-partitions | complete | 0.250 |  |

## Reproduction

Context hashes: `{"SKILL.md": "e9b0caab744a023e807a59659a6b7365913b854e3763da89396ac801d0fef75a", "references/cost-contract.md": "7bdba838c7f9d060be28f7a6068e9d1fd00e301b92dc94b5eeaa033b6b459d49", "references/refresh-contract.md": "5d9db495817710bfd749ed6794604e6513bc8c7871c0e9edf7c17019c1c87cff", "references/stage-contract.md": "2650beb2f282e7c618fb7474398d46ec20064aeedf8891a1c30980a7541ccaf2"}`
Cases hash: `291dbf45c132f150b4be686b2319a3078b9ecd4981e212e25a1a6c1810c8f21d`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

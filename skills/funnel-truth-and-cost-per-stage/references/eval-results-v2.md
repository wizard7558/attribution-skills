# Skill model evaluation

Skill: `funnel-truth-and-cost-per-stage`
Manifest SHA-256: `35b20930e1901ac330c7dbdd964842def2ef4b3bd1b2df54d47016dc7d4e41a5`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | stage-truth | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | cost-reconciliation | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | refresh-partitions | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | stage-truth | complete | 0.704 |  |
| claude-fable-5-1 | without-skill | cost-reconciliation | complete | 0.548 |  |
| claude-fable-5-1 | without-skill | refresh-partitions | complete | 0.981 |  |
| claude-sonnet-5 | with-skill | stage-truth | complete | 0.995 |  |
| claude-sonnet-5 | with-skill | cost-reconciliation | complete | 0.986 |  |
| claude-sonnet-5 | with-skill | refresh-partitions | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | stage-truth | complete | 0.841 |  |
| claude-sonnet-5 | without-skill | cost-reconciliation | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | refresh-partitions | complete | 0.781 |  |
| qwen3:4b | with-skill | stage-truth | complete | 0.302 |  |
| qwen3:4b | with-skill | cost-reconciliation | complete | 0.479 |  |
| qwen3:4b | with-skill | refresh-partitions | complete | 0.571 |  |
| qwen3:4b | without-skill | stage-truth | complete | 0.164 |  |
| qwen3:4b | without-skill | cost-reconciliation | complete | 0.473 |  |
| qwen3:4b | without-skill | refresh-partitions | complete | 0.267 |  |

## Reproduction

Context hashes: `{"SKILL.md": "421d4f894f90020f3651ff78ee73b5ed3b260dad207faafc35cb8a23d983ef64", "references/cost-contract.md": "e809a95af709e173683d6817b49ea0f9bd2b83845cf8ad12eff492ff63c92d5e", "references/refresh-contract.md": "468965f6cfb583f30a0a42f1c76d8c941ebe12bde41bedf8507d1ac88144a6ab", "references/stage-contract.md": "e498dbfba65bdd5ac564703325b46d52f7b7d11a0dffbf4def905a15f059960d"}`
Cases hash: `35b20930e1901ac330c7dbdd964842def2ef4b3bd1b2df54d47016dc7d4e41a5`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

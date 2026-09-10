# Skill model evaluation

Skill: `budget-scenario-planning`
Manifest SHA-256: `751e7c90c7f05bb375c647099c1e1f5ceaaf5d9369a97713fb29fd8b5bd6e341`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | scenario-projections | complete | 0.500 |  |
| claude-fable-5-1 | without-skill | scenario-projections | complete | 0.500 |  |
| claude-sonnet-5 | with-skill | scenario-projections | complete | 0.500 |  |
| claude-sonnet-5 | without-skill | scenario-projections | complete | 0.500 |  |
| qwen3:4b | with-skill | scenario-projections | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | without-skill | scenario-projections | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |

## Reproduction

Context hashes: `{"SKILL.md": "888f5cad23065dbe78ec6edb9a32546a91d4ef648579973da1dd9d75c4cd272d", "references/planning-math.md": "22dc79ba614b86fe67328780063a05c075aabe50b17ab7163b9fe0050622e61f"}`
Cases hash: `751e7c90c7f05bb375c647099c1e1f5ceaaf5d9369a97713fb29fd8b5bd6e341`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

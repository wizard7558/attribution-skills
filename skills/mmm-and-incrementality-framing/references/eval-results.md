# Skill model evaluation

Skill: `mmm-and-incrementality-framing`
Manifest SHA-256: `88ea3c64071c87d0f0731111d1009a33217d1f6ef1571101f0839535402cb32e`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | regression-guards | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | response-and-assumptions | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | observational-shares | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | regression-guards | complete | 0.591 |  |
| claude-fable-5-1 | without-skill | response-and-assumptions | complete | 0.889 |  |
| claude-fable-5-1 | without-skill | observational-shares | complete | 0.724 |  |
| claude-sonnet-5 | with-skill | regression-guards | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | response-and-assumptions | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | observational-shares | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | regression-guards | complete | 0.591 |  |
| claude-sonnet-5 | without-skill | response-and-assumptions | complete | 0.679 |  |
| claude-sonnet-5 | without-skill | observational-shares | complete | 0.620 |  |
| qwen3:4b | with-skill | regression-guards | complete | 0.705 |  |
| qwen3:4b | with-skill | response-and-assumptions | complete | 0.975 |  |
| qwen3:4b | with-skill | observational-shares | complete | 0.729 |  |
| qwen3:4b | without-skill | regression-guards | complete | 0.432 |  |
| qwen3:4b | without-skill | response-and-assumptions | complete | 0.481 |  |
| qwen3:4b | without-skill | observational-shares | complete | 0.359 |  |

## Reproduction

Context hashes: `{"SKILL.md": "8affe145bc9682ef9450b27863d263c736aa25f53c55c93a1f079c9acbaac3ed", "references/evaluation-output-contract.md": "f273dc86e06c0e0ed9124bc0b15b3c0d1c71df2025684c680af4dd5734571120", "references/framing-contract.md": "3d064f61622690204a6d27da9ace370a7c0e0f1fec4a7a765cd3b6ca0cf18fca", "references/regression-contract.md": "e28e3b5ccfbc2e52c921bca294ab8809a7e05399fae6c2fc30c4f26511a80b04", "references/response-curve-contract.md": "58aec7a822c7c682992575db7f8cab1f724d556d8bb802a2af67a7d1cf4c36ab"}`
Cases hash: `88ea3c64071c87d0f0731111d1009a33217d1f6ef1571101f0839535402cb32e`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

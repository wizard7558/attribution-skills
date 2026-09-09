# Skill model evaluation

Skill: `multi-touch-models-sql`
Manifest SHA-256: `0adcaa3460c2a64655ff097677cc1e8e8e35dd54fe0bb0605b50f8e1427a3dc8`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | model-credits | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | conversion-boundaries | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | money-and-coverage | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | model-credits | complete | 0.667 |  |
| claude-fable-5-1 | without-skill | conversion-boundaries | complete | 0.904 |  |
| claude-fable-5-1 | without-skill | money-and-coverage | complete | 0.663 |  |
| claude-sonnet-5 | with-skill | model-credits | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | conversion-boundaries | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | money-and-coverage | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | model-credits | complete | 0.420 |  |
| claude-sonnet-5 | without-skill | conversion-boundaries | complete | 0.825 |  |
| claude-sonnet-5 | without-skill | money-and-coverage | complete | 0.874 |  |
| qwen3:4b | with-skill | model-credits | complete | 0.488 |  |
| qwen3:4b | with-skill | conversion-boundaries | complete | 0.254 |  |
| qwen3:4b | with-skill | money-and-coverage | complete | 0.839 |  |
| qwen3:4b | without-skill | model-credits | complete | 0.201 |  |
| qwen3:4b | without-skill | conversion-boundaries | complete | 0.238 |  |
| qwen3:4b | without-skill | money-and-coverage | complete | 0.749 |  |

## Reproduction

Context hashes: `{"SKILL.md": "8ee6a69a556fd2c2407eba2d4d224a7c25e2fc0808630a375ccd2110e6df30a5", "references/evaluation-output-contract.md": "0381bd5ace1935a55d771ce4c0b8a4b766fbb2b9e31e617b27c8be98d5310476", "references/ledger-contract.md": "ffe7c8b8e467f4f374b18b3dfd59df91b7ed58fa0bb4052924e5d92d5d80f66d", "references/metrics-contract.md": "a1734bde09212943b590004723e34804b4046864ec742a56ce7597f7b638cc99"}`
Cases hash: `0adcaa3460c2a64655ff097677cc1e8e8e35dd54fe0bb0605b50f8e1427a3dc8`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

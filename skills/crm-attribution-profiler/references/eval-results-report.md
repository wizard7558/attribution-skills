# Skill model evaluation

Skill: `crm-attribution-profiler`
Manifest SHA-256: `f6712cce63c1e1829acef5a7d9794c5f8c91bb2edf35eacb923f0863cf12ac0d`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-sonnet-5 | with-skill | scoped-normalization | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | population-exclusions | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | temporal-archetypes | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | scoped-normalization | complete | 0.333 |  |
| claude-sonnet-5 | without-skill | population-exclusions | complete | 0.370 |  |
| claude-sonnet-5 | without-skill | temporal-archetypes | complete | 0.444 |  |
| qwen3:4b | with-skill | scoped-normalization | complete | 0.722 |  |
| qwen3:4b | with-skill | population-exclusions | complete | 0.778 |  |
| qwen3:4b | with-skill | temporal-archetypes | complete | 0.593 |  |
| qwen3:4b | without-skill | scoped-normalization | complete | 0.222 |  |
| qwen3:4b | without-skill | population-exclusions | complete | 0.222 |  |
| qwen3:4b | without-skill | temporal-archetypes | complete | 0.185 |  |
| claude-fable-5-1 | with-skill | scoped-normalization | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | population-exclusions | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | temporal-archetypes | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | scoped-normalization | complete | 0.722 |  |
| claude-fable-5-1 | without-skill | population-exclusions | complete | 0.370 |  |
| claude-fable-5-1 | without-skill | temporal-archetypes | complete | 0.444 |  |

## Reproduction

Context hashes: `{"SKILL.md": "5b4dbabf95e9557732d49cf780558c0947c8fdbf4740b913bd2a113ca2268443", "references/api.md": "ffe47b831673e03cdf9fdd2ae58a3ca8c8094af477f296e413dafb25ac648b41", "scripts/profile.mjs": "2707ce2b8d9a7665dc046237fe5c50e3eeb1a6d422b2fd567962486677dc950d"}`
Cases hash: `f6712cce63c1e1829acef5a7d9794c5f8c91bb2edf35eacb923f0863cf12ac0d`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

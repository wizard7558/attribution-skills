# Skill model evaluation

Skill: `crm-paid-attribution`
Manifest SHA-256: `27dd6133becc6b7fb2ed6828c19c94b4bee071f8178a024269130fbc4c23db45`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | precedence-and-normalization | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | scoped-ad-matching | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | primary-selection | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | precedence-and-normalization | complete | 0.425 |  |
| claude-fable-5-1 | without-skill | scoped-ad-matching | complete | 0.509 |  |
| claude-fable-5-1 | without-skill | primary-selection | complete | 0.624 |  |
| claude-sonnet-5 | with-skill | precedence-and-normalization | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | scoped-ad-matching | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | primary-selection | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | precedence-and-normalization | complete | 0.350 |  |
| claude-sonnet-5 | without-skill | scoped-ad-matching | complete | 0.472 |  |
| claude-sonnet-5 | without-skill | primary-selection | complete | 0.573 |  |
| qwen3:4b | with-skill | precedence-and-normalization | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | with-skill | scoped-ad-matching | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | with-skill | primary-selection | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | without-skill | precedence-and-normalization | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | without-skill | scoped-ad-matching | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | without-skill | primary-selection | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |

## Reproduction

Context hashes: `{"SKILL.md": "b952d0d82c2c475f53f24fecd9b499ae3744e4b03af0c3260869e16a39fd33fe", "references/contract.md": "e041821a1e389cc1e5f74a3faf7dd7d5ac34c789f1edd237a6acbda4ce664ca6", "scripts/attribute-leads.mjs": "18896a37d855dc59a8adfd4380b9820c67d68c893254375e189927cbb8fbd8fb", "scripts/channel-taxonomy.mjs": "c2d0034a533385cf1aa6475009f47d11d3f8a60ce5be96e629ea340e78a69299"}`
Cases hash: `27dd6133becc6b7fb2ed6828c19c94b4bee071f8178a024269130fbc4c23db45`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

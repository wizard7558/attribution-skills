# Skill model evaluation

Skill: `capi-match-keys`
Manifest SHA-256: `80222293ff5291be60ab02a417ce51bfe03aefb4c0cc77bbf0a22337ee8423d2`

Expected checks are kept outside model prompts. `n/a` indicates transport, identity, parse, schema, or completion failure; it is not a knowledge score.

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | keys | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | conversions | complete | 1.000 |  |
| claude-fable-5-1 | with-skill | delivery | complete | 1.000 |  |
| claude-fable-5-1 | without-skill | keys | complete | 0.887 |  |
| claude-fable-5-1 | without-skill | conversions | complete | 0.816 |  |
| claude-fable-5-1 | without-skill | delivery | complete | 0.742 |  |
| claude-sonnet-5 | with-skill | keys | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | conversions | complete | 1.000 |  |
| claude-sonnet-5 | with-skill | delivery | complete | 1.000 |  |
| claude-sonnet-5 | without-skill | keys | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | conversions | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | delivery | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | with-skill | keys | complete | 0.766 |  |
| qwen3:4b | with-skill | conversions | complete | 0.774 |  |
| qwen3:4b | with-skill | delivery | complete | 0.753 |  |
| qwen3:4b | without-skill | keys | complete | 0.674 |  |
| qwen3:4b | without-skill | conversions | complete | 0.335 |  |
| qwen3:4b | without-skill | delivery | complete | 0.371 |  |

## Reproduction

Context hashes: `{"SKILL.md": "e2415c140bc21938fbea22ef1f4f3a139fe4919dfc2b5bcfbb1a2a882219f8c6", "references/conversion-contract.md": "a8a4966052e436c46ff74210cfb15e99eaa02888d30b184b191c48e8f98594a5", "references/evaluation-output-contract.md": "5a17f9e9de1ad67807487a4b4837cd8aaba72ac9202b1ab7326d3d7304e6ebb4", "references/key-contract.md": "b75e7b837ca1452b79bda0e3c25fb3d5ba78ba1e77b3b0439657c3410cfef47f", "references/payload-quick-reference.md": "8d002a4b485c6aa1899338c988809009103ffa0e7e81d5bf8af8ba8680a7643a"}`
Cases hash: `80222293ff5291be60ab02a417ce51bfe03aefb4c0cc77bbf0a22337ee8423d2`
Live model calls are opt-in and raw envelopes remain in `eval-results.json`.

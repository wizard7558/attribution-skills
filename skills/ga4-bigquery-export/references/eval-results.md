# GA4 BigQuery export model evaluation results

The frozen matrix completed 14 of 18 usable calls on 2026-09-09. Four cells ended in transport_failure and are scored n/a, not zero knowledge. Transport supplements for those cells remain outstanding.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 1006/1044 | 552/593 | 5 |
| claude-sonnet-5 | 587/593 | 231/252 | 3 |
| qwen3:4b | 276/1044 | 268/1044 | 6 |

## Cell detail

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | parameters-and-observation-boundaries | complete | 250/252 |  |
| claude-fable-5-1 | with-skill | sessions-and-source-evidence | complete | 339/341 |  |
| claude-fable-5-1 | with-skill | transactions-and-execution | complete | 417/451 |  |
| claude-fable-5-1 | without-skill | parameters-and-observation-boundaries | complete | 231/252 |  |
| claude-fable-5-1 | without-skill | sessions-and-source-evidence | complete | 321/341 |  |
| claude-fable-5-1 | without-skill | transactions-and-execution | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | with-skill | parameters-and-observation-boundaries | complete | 249/252 |  |
| claude-sonnet-5 | with-skill | sessions-and-source-evidence | complete | 338/341 |  |
| claude-sonnet-5 | with-skill | transactions-and-execution | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | parameters-and-observation-boundaries | complete | 231/252 |  |
| claude-sonnet-5 | without-skill | sessions-and-source-evidence | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | transactions-and-execution | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | with-skill | parameters-and-observation-boundaries | complete | 118/252 |  |
| qwen3:4b | with-skill | sessions-and-source-evidence | complete | 58/341 |  |
| qwen3:4b | with-skill | transactions-and-execution | complete | 100/451 |  |
| qwen3:4b | without-skill | parameters-and-observation-boundaries | complete | 105/252 |  |
| qwen3:4b | without-skill | sessions-and-source-evidence | complete | 55/341 |  |
| qwen3:4b | without-skill | transactions-and-execution | complete | 108/451 |  |

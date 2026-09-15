# GA4 BigQuery export model evaluation results

The frozen matrix now covers four models — Fable 5.1, Sonnet 5, Qwen3:4b and DeepSeek V4.1 Flash (reasoning max, model key `deepseek-flash`) — across with-skill and without-skill conditions and three groups: 24 cells total. 23 of 24 are usable; `claude-fable-5-1/without-skill/transactions-and-execution` remains a preserved `transport_failure` (TimeoutExpired at 300s, re-attempted 2026-09-09T20:06Z, still n/a) and is scored n/a, not zero knowledge. The three prior Sonnet transport-failure cells (`with-skill/transactions-and-execution`, `without-skill/sessions-and-source-evidence`, `without-skill/transactions-and-execution`) are now complete via a checkpointed transport-recovery run against the same frozen manifest, context and harness. All six DeepSeek `deepseek-flash` cells are complete. Every score below is recomputed by the frozen shared scorer against the retained raw envelopes; publication made no new model or native SQL calls.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 1006/1044 | 552/593 | 5 |
| claude-sonnet-5 | 996/1044 | 852/1044 | 6 |
| deepseek-flash | 962/1044 | 869/1044 | 6 |
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
| claude-sonnet-5 | with-skill | transactions-and-execution | complete | 409/451 |  |
| claude-sonnet-5 | without-skill | parameters-and-observation-boundaries | complete | 231/252 |  |
| claude-sonnet-5 | without-skill | sessions-and-source-evidence | complete | 261/341 |  |
| claude-sonnet-5 | without-skill | transactions-and-execution | complete | 360/451 |  |
| qwen3:4b | with-skill | parameters-and-observation-boundaries | complete | 118/252 |  |
| qwen3:4b | with-skill | sessions-and-source-evidence | complete | 58/341 |  |
| qwen3:4b | with-skill | transactions-and-execution | complete | 100/451 |  |
| qwen3:4b | without-skill | parameters-and-observation-boundaries | complete | 105/252 |  |
| qwen3:4b | without-skill | sessions-and-source-evidence | complete | 55/341 |  |
| qwen3:4b | without-skill | transactions-and-execution | complete | 108/451 |  |
| deepseek-flash | with-skill | parameters-and-observation-boundaries | complete | 250/252 |  |
| deepseek-flash | with-skill | sessions-and-source-evidence | complete | 338/341 |  |
| deepseek-flash | with-skill | transactions-and-execution | complete | 374/451 |  |
| deepseek-flash | without-skill | parameters-and-observation-boundaries | complete | 216/252 |  |
| deepseek-flash | without-skill | sessions-and-source-evidence | complete | 287/341 |  |
| deepseek-flash | without-skill | transactions-and-execution | complete | 366/451 |  |

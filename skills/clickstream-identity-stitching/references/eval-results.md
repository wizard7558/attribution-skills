# Clickstream identity evaluation results

Historical original matrix on manifest 9e2b5e6e (prior to graph rubric revision 71a0c119). 18 attempts, 13 usable outputs; transport timeouts and truncated graph output remain n/a. Supplements for Sonnet 600s and Qwen graph are published separately.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 2004/2016 | 1910/2016 | 6 |
| claude-sonnet-5 | 312/312 | 288/312 | 2 |
| qwen3:4b | 534/828 | 619/2016 | 5 |

## Cell detail

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | dedup-and-direct-entry | complete | 312/312 |  |
| claude-fable-5-1 | with-skill | non-destructive-identity-graph | complete | 1176/1188 |  |
| claude-fable-5-1 | with-skill | webhook-stitch-and-receipts | complete | 516/516 |  |
| claude-fable-5-1 | without-skill | dedup-and-direct-entry | complete | 294/312 |  |
| claude-fable-5-1 | without-skill | non-destructive-identity-graph | complete | 1128/1188 |  |
| claude-fable-5-1 | without-skill | webhook-stitch-and-receipts | complete | 488/516 |  |
| claude-sonnet-5 | with-skill | dedup-and-direct-entry | complete | 312/312 |  |
| claude-sonnet-5 | with-skill | non-destructive-identity-graph | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | with-skill | webhook-stitch-and-receipts | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | dedup-and-direct-entry | complete | 288/312 |  |
| claude-sonnet-5 | without-skill | non-destructive-identity-graph | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| claude-sonnet-5 | without-skill | webhook-stitch-and-receipts | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| qwen3:4b | with-skill | dedup-and-direct-entry | complete | 182/312 |  |
| qwen3:4b | with-skill | non-destructive-identity-graph | incomplete | n/a | JSONDecodeError: Expecting property name enclosed in double quotes: line 2128 column 33 (char 40948), invalid_structure, incomplete_output |
| qwen3:4b | with-skill | webhook-stitch-and-receipts | complete | 352/516 |  |
| qwen3:4b | without-skill | dedup-and-direct-entry | complete | 149/312 |  |
| qwen3:4b | without-skill | non-destructive-identity-graph | complete | 122/1188 |  |
| qwen3:4b | without-skill | webhook-stitch-and-receipts | complete | 348/516 |  |

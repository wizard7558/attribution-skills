# CAPI evaluation attempts

Original failures are retained. A selected supplemental score does not erase the first timeout.

| Attempt set | Model | Condition | Group | Completion | Passed / checks | Errors |
| --- | --- | --- | --- | --- | ---: | --- |
| original | claude-fable-5-1 | with-skill | conversions | complete | 376 / 376 |  |
| original | claude-fable-5-1 | with-skill | delivery | complete | 186 / 186 |  |
| original | claude-fable-5-1 | with-skill | keys | complete | 141 / 141 |  |
| original | claude-fable-5-1 | without-skill | conversions | complete | 307 / 376 |  |
| original | claude-fable-5-1 | without-skill | delivery | complete | 138 / 186 |  |
| original | claude-fable-5-1 | without-skill | keys | complete | 125 / 141 |  |
| original | claude-sonnet-5 | with-skill | conversions | complete | 376 / 376 |  |
| original | claude-sonnet-5 | with-skill | delivery | complete | 186 / 186 |  |
| original | claude-sonnet-5 | with-skill | keys | complete | 141 / 141 |  |
| original | claude-sonnet-5 | without-skill | conversions | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| original | claude-sonnet-5 | without-skill | delivery | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| original | claude-sonnet-5 | without-skill | keys | transport_failure | n/a | transport_failure, model_identity_missing, invalid_structure |
| original | qwen3:4b | with-skill | conversions | complete | 291 / 376 |  |
| original | qwen3:4b | with-skill | delivery | complete | 140 / 186 |  |
| original | qwen3:4b | with-skill | keys | complete | 108 / 141 |  |
| original | qwen3:4b | without-skill | conversions | complete | 126 / 376 |  |
| original | qwen3:4b | without-skill | delivery | complete | 69 / 186 |  |
| original | qwen3:4b | without-skill | keys | complete | 95 / 141 |  |
| supplemental | claude-sonnet-5 | without-skill | conversions | complete | 320 / 376 |  |
| supplemental | claude-sonnet-5 | without-skill | delivery | complete | 138 / 186 |  |
| supplemental | claude-sonnet-5 | without-skill | keys | complete | 122 / 141 |  |

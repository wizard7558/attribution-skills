# Channel taxonomy model evaluation results (v2)

The revised manifest completed 18 of 18 usable calls on 2026-09-09 with no transport failures. Scores are exact projection checks over 24 synthetic scenarios on manifest 1be1b437. Supersedes the historical v1 matrix on manifest 5ef36ee6; v1 files are retained unchanged.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 174/174 | 140/174 | 6 |
| claude-sonnet-5 | 174/174 | 123/174 | 6 |
| qwen3:4b | 139/174 | 110/174 | 6 |

## Cell detail

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-fable-5-1 | with-skill | conflicting-acquisition-evidence | complete | 41/41 |  |
| claude-fable-5-1 | with-skill | cross-source-interoperability | complete | 92/92 |  |
| claude-fable-5-1 | with-skill | native-shopify-network-normalization | complete | 41/41 |  |
| claude-fable-5-1 | without-skill | conflicting-acquisition-evidence | complete | 29/41 |  |
| claude-fable-5-1 | without-skill | cross-source-interoperability | complete | 82/92 |  |
| claude-fable-5-1 | without-skill | native-shopify-network-normalization | complete | 29/41 |  |
| claude-sonnet-5 | with-skill | conflicting-acquisition-evidence | complete | 41/41 |  |
| claude-sonnet-5 | with-skill | cross-source-interoperability | complete | 92/92 |  |
| claude-sonnet-5 | with-skill | native-shopify-network-normalization | complete | 41/41 |  |
| claude-sonnet-5 | without-skill | conflicting-acquisition-evidence | complete | 24/41 |  |
| claude-sonnet-5 | without-skill | cross-source-interoperability | complete | 72/92 |  |
| claude-sonnet-5 | without-skill | native-shopify-network-normalization | complete | 27/41 |  |
| qwen3:4b | with-skill | conflicting-acquisition-evidence | complete | 37/41 |  |
| qwen3:4b | with-skill | cross-source-interoperability | complete | 62/92 |  |
| qwen3:4b | with-skill | native-shopify-network-normalization | complete | 40/41 |  |
| qwen3:4b | without-skill | conflicting-acquisition-evidence | complete | 27/41 |  |
| qwen3:4b | without-skill | cross-source-interoperability | complete | 60/92 |  |
| qwen3:4b | without-skill | native-shopify-network-normalization | complete | 23/41 |  |

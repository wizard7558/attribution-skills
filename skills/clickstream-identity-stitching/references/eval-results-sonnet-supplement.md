# Clickstream identity Sonnet supplement results

Four Sonnet cells at 600s for graph and webhook groups on corrected manifest 71a0c119. Original matrix bytes are preserved separately; these supplements do not overwrite original graph scores.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-sonnet-5 | 1697/1704 | 1552/1704 | 4 |

## Cell detail

| Model | Condition | Group | Completion | Score | Errors |
| --- | --- | --- | --- | ---: | --- |
| claude-sonnet-5 | with-skill | non-destructive-identity-graph | complete | 1188/1188 |  |
| claude-sonnet-5 | with-skill | webhook-stitch-and-receipts | complete | 509/516 |  |
| claude-sonnet-5 | without-skill | non-destructive-identity-graph | complete | 1056/1188 |  |
| claude-sonnet-5 | without-skill | webhook-stitch-and-receipts | complete | 496/516 |  |

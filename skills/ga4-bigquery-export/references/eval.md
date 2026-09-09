# Planned model evaluation

Measured model status: **pending**. A fixed 24-case manifest is prepared for review; no model calls have been run for this GA4 skill revision. Native SQL verification is recorded separately in [verification status](verification-status.md); it is not evidence of model performance.

Exactly three groups are planned. Their identities and objectives are:

| Group identity | Objective |
| --- | --- |
| `sessions-and-source-evidence` | Apply the property-scoped local session key, scan-window limitations, deterministic whole-record native attribution and landing selection, canonical click/channel rules, observed engagement proxy and companion grouping/sample boundaries. |
| `parameters-and-observation-boundaries` | Apply first-offset typed extraction including NULL and duplicates; distinguish raw page views/key-event occurrences, excluded identifiers, daily date-spine observations and bounded session spans without inferring consent, table existence or completeness. |
| `transactions-and-execution` | Keep session/transaction channel revenue separate from qualified cross-date ecommerce payload deduplication, conflicts, unkeyed-window uncertainty and item offsets; apply exact rendering, daily pruning, byte caps, full pagination and same-handle resume. |

The planned matrix is three groups × with-skill/without-skill × Fable 5.1, Sonnet 5 and Qwen3:4b: **18 cells, all pending**. The [manifest](eval-cases.json) has eight neutral A–H cases per group. Shared raw pools avoid repeated inputs; selectors refer to existing native rows or complete observed populations, not newly invented scans.

The context files are exactly [SKILL.md](../SKILL.md) and the [compact operational reference](evaluation-quick-reference.md). Each fixed prompt includes the shared and relevant group sections of the [output contract](evaluation-output-contract.md), identically in both conditions. The baseline receives the same prompt, raw pools, selectors and types-only schema, with no skill context. Expected values appear only in manifest checks and private test evidence. Fixture IDs, original native envelopes, identity-label mappings and source hashes remain outside model context. Visitor/order labels use a documented bijection that preserves NULL/blank keys and surrounding whitespace; URL, parameter, campaign and array evidence is unchanged. No unaided cryptographic or large numerical calculation is requested.

The compact projections cover all objectives above. Ecommerce omits repeated native bookkeeping and payload JSON from model answers while the full original reports remain in private derivation proof. Every array has a cardinality check; ordering is stated in terms of visible projection fields or explicit selector order. Native equal-timestamp session evidence field order is supplied explicitly. Monetary FLOAT64 scalars use absolute tolerance 1e-9; integer counts, strings, NULL and Boolean values are strict. The frozen shared scorer is version `2026-09-08.3`.

From the repository root:

```bash
# Deterministic freshness, actual frozen scorer, wrapper mocks and standalone proof.
node skills/ga4-bigquery-export/scripts/test-eval-manifest.mjs
# NO SQL EXECUTED; no model calls.

# Rebuild only the manifest after an authorized definition change, then check it.
node skills/ga4-bigquery-export/scripts/test-eval-manifest.mjs --write
```

Optional `--native-index PATH` audits existing private native reports from disk, including their exact query/source/fixture/runner hashes, raw envelopes and complete retained outputs. It makes no API or BigQuery calls. `--evidence NEW_PATH` writes an exclusive private review report. A copied skill can set `GA4_EVAL_HARNESS` to the frozen shared harness; Python 3 with optional `tiktoken` and Node.js 20+ are needed. Without tiktoken, token estimates use a disclosed conservative byte heuristic and the same size guards.

The accepted native sources underpin 43 retained synthetic jobs in the offline audit; this is reinspection, not 43 new queries. Actual production wrapper validation, nested decoding, pagination and same-handle resume are exercised with clearly labeled offline transport mocks. No second JavaScript session or ecommerce engine generates expected answers.

The three groups have 341, 252 and 451 checks (1,044 total). Expected output estimates are 3,380, 2,892 and 4,425 tokens using cl100k as an estimate, not the actual model tokenizer. The runner enforces estimated request+context+8,192 ≤28,000 and expected output ≤5,000, leaving formatting margin within the 32,768 context/8,192 output configuration. Exact current estimates and all hashes are retained in the private review report.

After explicit review and authorization, the live command is:

```bash
python3 scripts/run-skill-evals.py --run --skill skills/ga4-bigquery-export \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both \
  --groups sessions-and-source-evidence parameters-and-observation-boundaries transactions-and-execution \
  --output "$HOME/Downloads/ga4-model-evaluation.json"
```

This command has **not** been run. Resolve the actual CLI/model identities and owned local model server settings before calls. Report raw scores and completion/errors for both conditions; transport timeouts are unresolved attempts, not zero-knowledge answers. Do not require a baseline failure or infer general model ranking, UI parity or customer completeness from these synthetic cases.

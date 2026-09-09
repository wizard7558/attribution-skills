# Fixed MMM model evaluation

Status: **complete**. All 18 cells finished on 2026-09-09 UTC with verified requested model identities, complete responses and valid schemas. No transport, identity, parse, schema or truncation errors remain. The [full report](eval-results.md) and [raw responses with exact scorer records](eval-results.json) preserve the evidence. Scores apply only to these fixed synthetic prompts.

| Model | Condition | regression-guards | response-and-assumptions | observational-shares |
| --- | --- | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 88/88 | 81/81 | 192/192 |
| claude-fable-5-1 | without-skill | 52/88 | 72/81 | 139/192 |
| claude-sonnet-5 | with-skill | 88/88 | 81/81 | 192/192 |
| claude-sonnet-5 | without-skill | 52/88 | 55/81 | 119/192 |
| qwen3:4b | with-skill | 62/88 | 79/81 | 140/192 |
| qwen3:4b | without-skill | 38/88 | 39/81 | 69/192 |

The frozen harness was `2026-09-08.3`; Claude CLI was `2.1.263`, Ollama `0.33.2`. Qwen resolved to `qwen3:4b` digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, with context 32,768, output limit 8,192, temperature zero and thinking disabled. Manifest, all context/source hashes and cached model files were unchanged throughout. Private Downloads evidence includes immutable checkpoints, final raw output, process provenance and the settings audit. No retries or failed attempts were needed.

## Fixed scope and answer boundary

The [manifest](eval-cases.json) has exactly three groups and four cases per group. Case labels are `A`, `B`, `C`, `D`, reset in each group; behavioral fixture IDs and derivation notes are never sent to models. Raw native keys and the complete selected inputs are preserved. The expected projections are copied from already independently authored accepted fixture goldens; neither the builder nor these evaluation tests execute a producer to generate answers.

| Group | Accepted fixtures, in order | Checks |
| --- | --- | ---: |
| regression-guards | regression: orthogonal-spend-and-control; negative-coefficient-not-clipped; missing-week-never-dropped; perfect-collinearity | 88 |
| response-and-assumptions | response: local-marginal-calibration; negative-coefficient-not-clipped; framing: negative-delta-ordered-range; incomplete-scenario-unavailable | 81 |
| observational-shares | framing: shares-factors-adjusted-cpa; revenue-aligned-shares-no-cpa; partial-crm-source; negative-piece-even-with-positive-net | 192 |

There are 361 scalar/structural checks across 12 selected cases. Each response is a projection of the accepted public numerical contracts, as specified by the [evaluation output contract](evaluation-output-contract.md), not a new producer API. That contract explicitly supplies the applicable status, flag, reason and limit literals, precedence, formulas, null behavior and output ordering. It contains no per-case answer table.

Both conditions receive the same raw input, neutral operations, prompt and types-only schema. The baseline receives no skill context. Only the with-skill system prompt adds these five files: `SKILL.md`, `references/regression-contract.md`, `references/response-curve-contract.md`, `references/framing-contract.md`, and `references/evaluation-output-contract.md`. Referenced files are not followed automatically; fixtures, implementation guides, this evaluation page and source answer data are not added as context. Expected values and check definitions stay outside both requests.

Schemas require every nested field and reject extras, invalid types and nonfinite values. Numeric scored scalars use `approximately` with absolute tolerance `1e-9`; null, string, boolean and integer diagnostic counts use strict equality. Arrays use `array_length_equals` plus indexed labels and scalar checks, preserving order/cardinality while accepting equivalent numerical representations such as `5` and `5.0`. There are no whole numeric-array strict comparisons, answer enums, examples, minimum lengths or expected-answer hints in the model schema.

## Offline validation

Run from the repository root; these commands make **NO MODEL CALLS**:

```sh
python3 -B skills/mmm-and-incrementality-framing/scripts/build-eval-cases.py --check
python3 -B skills/mmm-and-incrementality-framing/scripts/test-eval-cases.py
python3 -B scripts/run-skill-evals.py --skill skills/mmm-and-incrementality-framing
```

To regenerate the deterministic manifest after an explicitly reviewed source-fixture/projection change, run the builder without `--check`. It reads the accepted literal golden files and projects them; it does not import or run numerical producers. Regeneration is not evidence that a changed expectation is correct.

Tests compare all 12 projections against the real generic schema validator and scorer, ensure every projected scalar and array cardinality is checked, and exercise numerical equivalence, nested missing/extra fields, NaN/Infinity, numeric strings/booleans, count types, incorrect signs/factors/reasons, reversed arrays and wrong cardinality. Request construction is inspected directly; replacing private expected checks with a sentinel leaves both model requests unchanged. The output contract's ordered limitation arrays are checked against literal constants in the accepted source without executing that source. Every selected string check is found in its supplied raw input or declared context.

The source of truth is the current test output and file hashes. The prepared manifest SHA-256 is `88ea3c64071c87d0f0731111d1009a33217d1f6ef1571101f0839535402cb32e`. The generic harness includes the reviewed `array_length_equals` operator, version `2026-09-08.3`; its frozen SHA-256 is `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`.

## Request-size audit

The five declared context files total 59,093 UTF-8 bytes. Their reviewed hashes are:

| Context file | SHA-256 |
| --- | --- |
| `SKILL.md` | `8affe145bc9682ef9450b27863d263c736aa25f53c55c93a1f079c9acbaac3ed` |
| `references/regression-contract.md` | `e28e3b5ccfbc2e52c921bca294ab8809a7e05399fae6c2fc30c4f26511a80b04` |
| `references/response-curve-contract.md` | `58aec7a822c7c682992575db7f8cab1f724d556d8bb802a2af67a7d1cf4c36ab` |
| `references/framing-contract.md` | `3d064f61622690204a6d27da9ace370a7c0e0f1fec4a7a765cd3b6ca0cf18fca` |
| `references/evaluation-output-contract.md` | `f273dc86e06c0e0ed9124bc0b15b3c0d1c71df2025684c680af4dd5734571120` |

An offline `cl100k_base` estimate accounts for the system text, prompt, schema repeated in the transport and 256 framing tokens. It is an estimate, not a vendor-specific token count. The guarded total adds a 20% input margin and reserves 8,192 output tokens. All supplied inputs and context files are retained without trimming. The optional `tiktoken` package enables this audit; tests explicitly report unavailable token estimates if it is absent. Production model calls use the generic harness's existing dependencies.

| Group | Without-skill estimated input | With-skill estimated input | With-skill guarded input + 8,192 output |
| --- | ---: | ---: | ---: |
| regression-guards | 3,251 | 15,211 | 26,446 |
| response-and-assumptions | 4,271 | 16,231 | 27,670 |
| observational-shares | 4,836 | 16,796 | 28,348 |

The guarded totals fit within the 32,768-token context setting. Actual model usage and completion/identity records were inspected in the completed run and remain in the raw evidence; estimates alone do not establish performance.

## Authorized execution command

After review and authorization, run this exact repository-root command for the complete 18-cell matrix:

```sh
python3 scripts/run-skill-evals.py --skill skills/mmm-and-incrementality-framing --run --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both
```

The harness records raw responses, parsed results, scores, errors, model identities/digests, context/manifest/harness hashes and completion metadata in `references/eval-results.json`, with rendered reports and a Downloads copy. No result file exists merely because the manifest validates. Preserve prior evidence; resume requires compatible hashes and never silently overwrites an unrelated result. Transport, identity, parsing, schema and truncation failures are unavailable evidence, not zero knowledge scores.

Interpret these results only as behavior on these three fixed synthetic prompts. They do not measure production data quality, causal identification, portfolio allocation quality or a general model ranking. The accepted numerical producer test suites and pipeline integration remain separate evidence from model-response evaluation.

# Fixed MTA model evaluation

Status: **complete**. All 18 cells finished on 2026-09-09 UTC with verified requested identities, complete responses and valid schemas. No transport, identity, parse, schema or truncation failures remain. See the [full report](eval-results.md) and [raw responses and exact scorer records](eval-results.json). Scores apply only to these fixed synthetic prompts.

| Model | Condition | model-credits | conversion-boundaries | money-and-coverage |
| --- | --- | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 541/541 | 366/366 | 199/199 |
| claude-fable-5-1 | without-skill | 361/541 | 331/366 | 132/199 |
| claude-sonnet-5 | with-skill | 541/541 | 366/366 | 199/199 |
| claude-sonnet-5 | without-skill | 227/541 | 302/366 | 174/199 |
| qwen3:4b | with-skill | 264/541 | 93/366 | 167/199 |
| qwen3:4b | without-skill | 109/541 | 87/366 | 149/199 |

Harness `2026-09-08.3`, Claude CLI `2.1.263`, and Ollama `0.33.2` were used. Qwen resolved to `qwen3:4b` digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, with context 32,768, output limit 8,192, temperature zero and thinking disabled. All manifest/context/source/harness hashes and cached model files remained unchanged. Private Downloads evidence preserves process provenance, immutable midpoint and final raw checkpoints, usage and validation. There were no retries or failed attempts.

## Fixed scope and answer boundary

The [manifest](eval-cases.json) contains exactly three prompts with four cases each. Neutral labels A–D reset within each group. Raw inputs and all qualified keys are preserved; only behavioral `invocation_key` metadata is replaced with the neutral case label. Expected outputs are projections of the accepted independently authored literal fixture goldens. The builder never executes SQL or a replacement attribution implementation to create answers.

| Group | Accepted fixtures, in order | Checks |
| --- | --- | ---: |
| model-credits | ledger: one-touch-all-models; two-touch-fractional-decay; four-touch-qualified-provenance; full-window-microsecond-inclusive | 541 |
| conversion-boundaries | ledger: segmented-history-outside-report; acquisition-first-observed-outside-report; null-subjects-tagged-collision-protection; no-lookback-touch-and-unresolved-touch | 366 |
| money-and-coverage | metrics: thirds-one-unit; signed-refund; partial-observed; spend-only-uncredited | 199 |

There are 1,106 scalar and structural checks across 12 selected cases. The [output contract](evaluation-output-contract.md) describes the exact public projection, ordering, status/reason vocabulary, null behavior and decimal representation. It supplies general formulas, not per-case answers. Every nonnumeric checked string occurs in declared context or its raw input. Computed decimal strings are instead audited for canonical representation and derived by the public monetary formulas; their exact expected values remain private from requests.

Both conditions receive identical raw input, prompt and types-only schema. Baseline receives no skill context. With-skill receives exactly `SKILL.md`, `references/ledger-contract.md`, `references/metrics-contract.md`, and `references/evaluation-output-contract.md`. Links are not followed. Neither condition receives fixtures, expected checks, implementation guides, this page, or source answer data. Changing expected checks to a sentinel leaves constructed requests unchanged.

Strict nested schemas require all fields and reject extras. Original FLOAT64 credits and attributed counts use absolute tolerance `1e-12`; integer counts, booleans, nulls, identifiers, reason literals and exact decimal strings use strict typed equality. Every array uses `array_length_equals` plus indexed scalar checks, preserving order and cardinality while allowing equivalent integer/float credit notation. No enum, example, minimum array length, or answer-bearing schema constraint is passed to models.

## Offline validation

From repository root, these commands make **NO SQL EXECUTED; NO MODEL CALLS**:

```sh
python3 -B skills/multi-touch-models-sql/scripts/build-eval-cases.py --check
python3 -B skills/multi-touch-models-sql/scripts/test-eval-cases.py
python3 -B scripts/run-skill-evals.py --skill skills/multi-touch-models-sql
```

The builder without `--check` regenerates the manifest deterministically after a reviewed fixture/projection change. Regeneration is not evidence that an expectation is correct. Tests inspect all selected raw inputs/projections, every scored scalar and array, the real generic scorer and request construction. Targeted mutations cover missing/extra fields, NaN/Infinity, boolean/numeric/count types, order/cardinality, incorrect credits, excluded coverage, unknown-as-zero, partial spend, repeated original money, refund signs, monetary rounding/conservation, spend inflation and reason strings.

The prepared manifest SHA-256 is `0adcaa3460c2a64655ff097677cc1e8e8e35dd54fe0bb0605b50f8e1427a3dc8`. The frozen generic harness is version `2026-09-08.3`, SHA-256 `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`.

## Request-size audit

The four context files total 46,640 UTF-8 bytes.

| Context file | SHA-256 |
| --- | --- |
| `SKILL.md` | `8ee6a69a556fd2c2407eba2d4d224a7c25e2fc0808630a375ccd2110e6df30a5` |
| `references/ledger-contract.md` | `ffe7c8b8e467f4f374b18b3dfd59df91b7ed58fa0bb4052924e5d92d5d80f66d` |
| `references/metrics-contract.md` | `a1734bde09212943b590004723e34804b4046864ec742a56ce7597f7b638cc99` |
| `references/evaluation-output-contract.md` | `0381bd5ace1935a55d771ce4c0b8a4b766fbb2b9e31e617b27c8be98d5310476` |

The optional `tiktoken` audit uses `cl100k_base`, including system text, prompt, a second transport-schema copy and 256 framing tokens. Guarded totals add 20% input margin and reserve 8,192 output tokens. These are estimates, not vendor-specific usage. No input, case or context was trimmed.

| Group | Without-skill estimated input | With-skill estimated input | With-skill guarded input + 8,192 output |
| --- | ---: | ---: | ---: |
| model-credits | 3,753 | 12,943 | 23,724 |
| conversion-boundaries | 3,696 | 12,886 | 23,656 |
| money-and-coverage | 6,028 | 15,218 | 26,454 |

Canonical expected output was estimated separately, using both compact and two-space-indented JSON. The pretty output plus a further 20% margin remains below 8,192 for every group.

| Group | Compact output estimate | Pretty output estimate | Pretty + 20% |
| --- | ---: | ---: | ---: |
| model-credits | 2,953 | 4,895 | 5,874 |
| conversion-boundaries | 1,999 | 3,332 | 3,999 |
| money-and-coverage | 1,222 | 1,880 | 2,256 |

All guarded requests fit the 32,768 context setting, and output has formatting headroom. Actual usage, identities and completion records were inspected after the completed run and remain in raw evidence. If the optional tokenizer is absent, offline tests explicitly report that token estimates are unavailable.

## Execution after review

After separate review and authorization, use this exact repository-root command:

```sh
python3 scripts/run-skill-evals.py --skill skills/multi-touch-models-sql --run --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both
```

The harness writes raw envelopes, parsed outputs, exact scorer records, identities/digests, hashes, settings and completion metadata to `references/eval-results.json`, a rendered `eval-results.md`, and a Downloads report copy. Preserve previous checkpoints; compatible resume never authorizes replacing unrelated evidence. Transport, identity, parse, schema or truncated-completion failures are unavailable evidence, not zero knowledge scores.

These three fixed synthetic prompts test interpretation of attribution and money contracts. Results cannot establish production scale, causal lift, lifetime acquisition completeness, population identity, or a general model ranking. Accepted native ledger and metrics execution evidence remains separate.

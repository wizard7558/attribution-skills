# Model evaluation harness

`scripts/run-skill-evals.py` evaluates any skill that declares a manifest at
`<skill>/references/eval-cases.json`. It supports before/after runs by using the same prompt,
input, output shape, isolated working directory, and disabled tools for `with-skill` and
`without-skill`. The with-skill condition adds only the manifest's declared context files.
Expected answers and comparison checks are never sent to the model.

The manifest has exactly two top-level fields:

```json
{
  "context_files": ["SKILL.md", "references/contract.md"],
  "groups": [
    {
      "id": "example",
      "prompt": "Resolve the input using the supplied skill context.",
      "input": {"value": "synthetic"},
      "output_schema": {
        "type": "object",
        "properties": {"answer": {"type": "string"}},
        "required": ["answer"]
      },
      "checks": [
        {"path": "/answer", "op": "equals", "expected": "expected value"}
      ]
    }
  ]
}
```

Context paths must be relative files inside the selected skill. The output schema is types-only:
object properties, required fields, array items, and JSON types are allowed; examples, enums,
defaults, descriptions, and answer-bearing fields are rejected. Checks use JSON Pointer paths and
are evaluated after parsing. `equals` is strict and preserves `false`, `0`, and `null` as real
values. `set_equals` compares arrays without order or duplicate significance. `approximately`
requires finite numeric values and an explicit nonnegative tolerance. A missing path fails.
`array_length_equals` requires a nonnegative integer expected count (booleans and floats are
rejected) and an actual array of exactly that length. Missing paths and non-array values fail.
Use it with indexed label/order and scalar checks to score array structure without imposing
strict integer-versus-float equality on numerical results. The expected count remains in checks,
outside both model conditions' requests; it is not an answer-bearing schema constraint.

Run offline validation and self-tests without contacting a model:

```bash
python3 scripts/test-skill-evals.py
python3 scripts/run-skill-evals.py --skill skills/<skill-with-manifest> --self-test
```

Run a live matrix only after reviewing the manifest and model access:

```bash
python3 scripts/run-skill-evals.py \
  --skill skills/<skill-with-manifest> \
  --run --models claude-fable-5-1 claude-sonnet-5 qwen3:4b \
  --condition both
```

Live output is written to the selected skill's `references/eval-results.json` and
`references/eval-results.md`, plus `~/Downloads/<skill>-evaluation-report.md`. The JSON preserves
the manifest/context hashes, prompt hashes, timestamps, requested and resolved model identities,
raw envelopes, parsed values, completion and schema status, check statuses, elapsed/error fields,
and transport details. Transport failures, unavailable models, identity mismatches, invalid JSON,
and truncation are `n/a` evidence, never zero knowledge scores.

Use `--groups` and `--condition` to run bounded slices. Use `--resume PATH` to continue an existing
checkpoint. Resume refuses to run when the manifest or declared context hashes changed, retains
prior raw calls, and skips calls already present for the same model, condition, and group. A new
run refuses to overwrite an existing result file unless `--resume` is supplied.

Claude uses the isolated safe-mode invocation with no tools and exact requested model metadata.
If the installed CLI advertises `--json-schema`, the harness passes the types-only schema. Qwen
uses the local Ollama endpoint from `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`), structured
output, `stream=false`, `think=false`, `num_ctx=32768`, `num_predict=8192`, and temperature zero.
It records the exact `/api/tags` model digest. The harness never installs models, starts a daemon,
logs in, or silently substitutes a model.

The harness parses complete JSON responses and whole fenced JSON blocks only. It does not extract
incidental JSON fragments from reasoning text. Every model matrix must be interpreted from its
recorded raw responses and statuses; the harness does not fabricate unavailable results.

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

## Transport recovery

The evaluation harness is a frozen instrument for reproducibility. Its SHA-256
(`b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`, version `2026-09-08.3`)
is pinned in the manifest tests, `scripts/publish-eval-matrix.py`, and published provenance.
`scripts/run-skill-evals.py` remains byte-identical for this recovery path; a future reviewed
version can be introduced as a separate reproducibility decision. The frozen harness uses a
300-second Claude subprocess timeout, inherits stdin, and does not retain subprocess output when
that call times out. The historical cause of the GA4 failures is unproven: the recovery change
addresses a possible inherited-stdin block and longer transport waits, and its stdin behavior is
covered by synthetic tests only.

`scripts/run-skill-evals-recover.py` imports the frozen harness only after checking its hash and
version. It changes the transport boundary for the recovery attempt as follows:

- Claude subprocesses receive `subprocess.DEVNULL` stdin, avoiding a possible inherited-stdin block.
- Claude's frozen 300-second timeout is replaced by `--timeout-seconds` (default 900; minimum 300).
- The Claude budget is `--budget-usd` (default 2, matching the frozen `--max-budget-usd` value).
- Ollama chat HTTP requests use the same `--timeout-seconds` value; model tags and request options
  are otherwise unchanged.
- A subprocess timeout retains the available final 2000 characters of stdout and stderr.

The parser, schema, scorer, prompts, manifest, and frozen harness bytes are unchanged. Normal
source-backed recovery retries only cells recorded with `completion_status: transport_failure` and
`raw_envelope: null`. The source must have the same Claude CLI version, advertised capabilities,
and recorded options; an Ollama source must have the same model digest and exact relevant hashes
(manifest, context, prompt/system, and schema). Exact model tags are required. `--select
MODEL:CONDITION:GROUP` names exact cells and is an alternative to `--models`; do not combine them.

Changing the recovery budget changes the recorded options. Use that changed-budget attempt only
with `--acknowledge-no-source`; describe it as a fresh diagnostic attempt, distinct from a
source-backed retry. A source-backed retry does not broaden eligibility to incomplete, invalid, or
otherwise non-transport failures.

The runner reserves a distinct output path before preflight or live work and refuses the primary
`eval-results.json` and `eval-results.md` names, as well as an existing output path. It checkpoints
each selected cell in its separate supplement. `complete` and `interrupted` are overall recovery
batch statuses, recorded with `finished_at`; they are not per-cell `completion_status` values. A
finished call retains the frozen per-cell status (`complete`, `transport_failure`,
`invalid_structure`, `incomplete`, and so on), and a successful recovery is evaluated and scored by
the unchanged frozen scorer, so it can produce a real score. If the batch is interrupted, calls
already completed retain their original statuses and real scores; cells never reached have no
invented interrupted records and remain absent or unavailable.

Keep raw recovery supplements private in `~/Downloads`, for example
`eval-results-transport-supplement-<model>-<group>-<condition>.json`. The recovery command does
not publish them. The current publisher still fixes `versions.per_call_timeout_seconds` at 300
and its privacy scan can reject local paths in new recovery metadata, so any publication adapter
work requires a separate review and is outside this command and this recovery run. Do not treat a
private raw supplement as an automatically published artifact.

This dry-run validates the four currently recorded GA4 cells without contacting a model or network:

```bash
python3 scripts/run-skill-evals-recover.py \
  --skill skills/ga4-bigquery-export \
  --select claude-fable-5-1:without-skill:transactions-and-execution \
  --select claude-sonnet-5:with-skill:transactions-and-execution \
  --select claude-sonnet-5:without-skill:sessions-and-source-evidence \
  --select claude-sonnet-5:without-skill:transactions-and-execution \
  --source skills/ga4-bigquery-export/references/eval-results.json \
  --output "$HOME/Downloads/ga4-transport-recovery-$(date +%Y%m%dT%H%M%S).json"
```

Add `--run` when executing live retries. For an exact-tag fresh diagnostic run without changing
defaults, use `--models qwen3.8:latest` with `--acknowledge-no-source`; do not assume that tag is
installed. The offline recovery tests cover the frozen-hash refusal, patched transport boundary,
partial-output capture, and fake-CLI retry path.

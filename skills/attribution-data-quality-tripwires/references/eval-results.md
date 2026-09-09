# Quality model evaluation results

The frozen matrix completed 18 of 18 usable calls on 2026-09-09, with no transport failures, retries, timeout changes or repaired responses. Each model answered three identical input groups both with and without the skill context. Scores are exact projection checks over 13 synthetic cases covering all nine native checks.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 304/304 | 269/304 | 6/6 |
| claude-sonnet-5 | 304/304 | 272/304 | 6/6 |
| qwen3:4b | 235/304 | 156/304 | 6/6 |

[Published raw results](eval-results.json) retain all 18 prompts, system prompts, model responses, parsed outputs, per-check outcomes and transport/runtime records. [Publication provenance](eval-results-provenance.json) records exact hashes and JSON pointers for 24 redacted runtime session/envelope correlation IDs. No prompt, system instruction, model result, structured output, message, score or check status was changed. The unchanged private original has SHA-256 `9299dee1e4dffc258b55259155cbf77bc9187dfe99a851a9146815c04504b36f`; the metadata-redacted public derivative has SHA-256 `a7e3cef8deb88e2bcbe9b47cb797d94f2e14686d7b1c7216106e5100855f0313`.

Publication verification reconstructed every request from the current frozen context and manifest, then reran the actual frozen parser/schema/scorer on every original raw envelope. Parsed output, resolved model, completion, schema, errors and all individual checks matched exactly. All four context files and 26 native source files retained their recorded hashes. No model or native SQL call was made during publication.

These scores measure typed, ordered compact projections of independently authored native findings. They do not replace the separate full native SQL goldens and integrations, establish general model rankings, or certify real customer data. All outputs were complete and schema-valid; knowledge errors remained scored errors. Baseline errors included reason codes, total-versus-primary funnel metric order and unknown-versus-observed totals. The local model also missed some contract values with skill context. See raw failed checks rather than inferring that a usable response is correct.

The canonical manifest is [eval-cases.json](eval-cases.json), SHA-256 `2c17a5e81be6a162c99fc95338ad6a67b0f6381f3c826f571ca2b1dff23f3076`. The frozen shared harness is `scripts/run-skill-evals.py`, SHA-256 `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`. Context order and pre-live checks are documented in [eval.md](eval.md); per-file hashes are included in publication provenance.

Runtime: Claude Code 2.1.263 and Ollama 0.33.2. Qwen used `qwen3:4b` digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, context 32768, output cap 8192, temperature 0 and `think:false`. The harness retained its 300-second timeout. The separately owned evaluation server was stopped after completion; the existing user server and cached model files were left unchanged.

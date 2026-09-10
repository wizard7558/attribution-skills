# CAPI fixed model evaluation

Completed attempts: **21** for **18 logical cells**; **18 usable cells**. The original matrix had three Sonnet baseline transport timeouts at 300 seconds. Each received one explicitly authorized supplemental attempt with a 600-second timeout. All original failures remain preserved; no second retries were made.

| Model | Condition | Keys (141) | Conversions (376) | Delivery (186) | Total (703) |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 141 | 376 | 186 | 703 |
| claude-fable-5-1 | without-skill | 125 | 307 | 138 | 570 |
| claude-sonnet-5 | with-skill | 141 | 376 | 186 | 703 |
| claude-sonnet-5 | without-skill | 122 | 320 | 138 | 580 |
| qwen3:4b | with-skill | 108 | 291 | 140 | 539 |
| qwen3:4b | without-skill | 95 | 126 | 69 | 290 |

`n/a` means an unresolved transport, identity, completion or schema failure; it is not a knowledge-zero score. Sonnet baseline scores, when usable, select the supplemental attempt. Every other logical cell selects its original attempt. This recovery changes the effective timeout for those three attempts and is not described as an unchanged transport configuration.

The three fixed groups contain 13 neutral outer cases and 703 checks: keys 141, conversions 376, delivery 186. Both conditions receive identical inputs, types-only schemas, prompts and neutral SHA-256 oracle tables. The oracle supplies digests for candidate UTF-8 preimages, so these scores test normalization and ID-preimage selection rather than unaided SHA-256 calculation. Only the with-skill condition receives the declared context files.

All saved attempts were independently reparsed and rescored with the frozen harness. Exact user/system requests, manifest/context/schema hashes, actual model identity, completion, parsed JSON and every check/error record matched. All 28 frozen files retained their launch hashes. Original and supplemental raw files, logs, launcher source, timeout provenance and full independent audit are preserved in Downloads.

Claude Code 2.1.263 ran the exact requested identities with tools and MCP disabled, no session persistence and a $2 per-call budget. Ollama 0.33.2 ran Qwen3:4b digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, context 32768, output 8192, temperature 0 and think=false. The owned server was stopped after the original Qwen cells completed; the preexisting model cache and default server were preserved.

These are fixed synthetic key, preparation and payload tasks plus supplied transaction/fencing scenarios. Model evaluation executes no SQL and sends no conversion-provider requests. The earlier local loopback evidence proves stored-byte transport behavior, not provider acceptance. The results do not establish match rates, causal lift, exactly-once delivery or a general model ranking.

Frozen harness SHA-256: `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`. Manifest SHA-256: `80222293ff5291be60ab02a417ce51bfe03aefb4c0cc77bbf0a22337ee8423d2`.

Original raw SHA-256: `5ca190c42e5b950ee70c386e762f02dfd7aeaceb8d557605cade8daabd8f3947`. Supplemental raw SHA-256: `0308ac45e85262c7e9b11290f45deecc75f66f8c4f9c557497adf4de8a015aa0`.

See [original raw attempts](eval-results.json), [supplemental raw attempts](eval-supplemental-sonnet-baseline.json), [all-attempt cell report](eval-results.md), [provenance](eval-provenance.json), and [evaluation definition](eval.md).

# Model evaluation status

The completed 18-call matrix is published in [eval-results.md](eval-results.md), with [raw results](eval-results.json) and [publication provenance](eval-results-provenance.json). The pre-live section below describes the original frozen preparation; accepted native SQL checks and integrations remain separate runtime evidence.

The frozen manifest has exactly three ordered groups: reconciliation, population, schema_history. They contain 4, 4 and 5 neutral cases respectively, covering all nine check IDs. Cases request 111 scalar JSON paths in total, together with native overall check identity, status and reasons. Inputs are unchanged accepted synthetic business facts with only invocation identifiers neutralized. Selected fixture mappings remain in the builder and offline evidence, outside model input and context.

Expected projections come only from independently authored accepted literal findings. A missing requested path or invalid projected scalar is a manifest error. There is no JavaScript quality engine, generated answer oracle or model-specific threshold.

Context files, in order:

1. SKILL.md
2. references/quality-quick-reference.md
3. references/evaluation-output-contract.md
4. references/channel-contract.md

The shared evaluation harness is read-only, SHA-256 `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`. It constructs both conditions without manifest checks. Output schema is types-only; exact values and array cardinalities are scored separately. The local tests use its real parser/schema/scorer without transports or model calls.

From the skill root:

~~~sh
node scripts/build-eval-cases.mjs --check
node scripts/test-eval-manifest.mjs
~~~

The pre-live test writes timestamped Downloads evidence with frozen source/context/manifest/harness hashes, input-only neutrality checks, counts, buffered token estimates and scorer mutation results. It reserves 8,192 output tokens and requires buffered input plus that budget <= 28,000; buffered expected serialized output must fit within 8,192 minus 1,024 tokens. Estimates use cl100k_base with explicit extra headroom, not a claim to measure a provider's exact tokenizer. No context or input is truncated.

The pre-live package was accepted before the completed matrix below. The shared harness controlled all 18 authorized calls and result accounting. Do not treat successful local scorer tests as a model score, or a later model projection score as a substitute for native full-finding correctness.

Local pre-live verification passed on 2026-09-09: 304 scorer checks, 272 rejected mutation trials, exact 13-case selection and neutralization, all 111 requested scalar paths, canonical byte equality, valid frontmatter, and 26 unchanged accepted native source files. Buffered total request/output budget peaks at 19,726 tokens; buffered expected serialized outputs peak at 1,880 tokens. The skill has 132 text lines (133 when counting the final empty split element). Zero native SQL or model calls were made. That pre-live check made no model calls; the separate completed live matrix is recorded below.


## Verified live matrix — 2026-09-09

The frozen three-group matrix completed exactly 18 calls: three models × with/without skill × three groups. Every call was complete, schema-valid and usable, with no transport failures, retries or timeout changes. The unchanged canonical parser/schema/scorer was run again on all actual raw envelopes; all parsed outputs, errors and individual check results matched the saved records.

| Model | With skill | Without skill | Usable calls |
| --- | ---: | ---: | ---: |
| claude-fable-5-1 | 304/304 | 269/304 | 6/6 |
| claude-sonnet-5 | 304/304 | 272/304 | 6/6 |
| qwen3:4b | 235/304 | 156/304 | 6/6 |

These exact projection checks include identity, types, order, array cardinality, reason codes and requested native scalar values. They are not general model rankings or fresh native SQL evidence. Baseline errors included reason-code differences, reversed total/primary funnel metric ordering, and unknown-versus-observed-total handling. The smaller local model also missed contract values with context. No result was repaired, retried, truncated or substituted with an expected fixture.

Manifest SHA-256: `2c17a5e81be6a162c99fc95338ad6a67b0f6381f3c826f571ca2b1dff23f3076`.
Frozen harness SHA-256: `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`.
All four model-context files, 26 accepted native sources and nine package files matched their prelaunch bytes before this non-context provenance update. Canonical raw-result SHA-256: `9299dee1e4dffc258b55259155cbf77bc9187dfe99a851a9146815c04504b36f`.

Runtime versions were Claude Code 2.1.263 and Ollama 0.33.2. Qwen used the exact `qwen3:4b` digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, context 32768, output cap 8192, temperature 0 and `think:false`, on a separately owned server. The original 300-second call timeout was retained. Only the owned server was stopped after completion; the existing user server remained unchanged.

Timestamped private evidence in Downloads uses the prefix `attribution-quality-live-20260909T043932Z`: prelaunch exact requests/hashes, launch ownership/version records, canonical results/raw envelopes, scorer audit, logs and cleanup proof. The discoverable evaluation report is `attribution-data-quality-tripwires-evaluation-report.md`. This record contains no customer queries, native source changes or provider delivery claims.

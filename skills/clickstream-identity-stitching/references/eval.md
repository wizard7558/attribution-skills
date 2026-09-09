# Fixed identity evaluation groups

Published supplements: [eval-results-sonnet-supplement.json](eval-results-sonnet-supplement.json) (4/4 complete at 600s) and [eval-results-qwen-graph-supplement.json](eval-results-qwen-graph-supplement.json) (single with-skill graph cell **incomplete**, scored n/a). Original matrix bytes remain archived privately; combined publication is pending review of the original matrix redaction.

The graph-only rubric revision is prepared and verified offline; corrected live graph calls and final with/without-skill comparisons remain **partially outstanding**. The original frozen matrix is retained as historical evidence: 18 attempts, 13 usable outputs, four Sonnet transport timeouts and one Qwen output-limit truncation. Original graph ordering scores are not a reliable identity-semantic comparison because the supplied observation-order rule was ambiguous. No original score, raw response, or failure was overwritten. No new model calls were made during this correction preparation.

The revised graph projection sorts visible qualified tuples explicitly using JavaScript code-unit comparison and requests one-line minified JSON. Case inputs, schemas, native identity behavior and all field/case coverage remain unchanged. The complete expected graph answer is 3,409 tokens under the primary Qwen tokenizer verified against the actual cached GGUF vocabulary and merge sequence, within the unchanged 8,192-token output budget. A model may still fail to follow formatting or coverage instructions; feasibility is not a predicted score. The deduplication and webhook groups retain byte-identical requests, schemas, checks and system context. All 12 original cells in those groups are checked against the revised manifest without rewriting their original manifest provenance.

The manifest is [eval-cases.json](eval-cases.json). Both conditions receive identical neutral case inputs, precomputed hash/fingerprint evidence, types-only schemas, and the [projection vocabulary](evaluation-output-contract.md). Expected answers exist only in scorer checks and private fixture derivation evidence. Neither condition is asked to calculate SHA-256. The with-skill condition adds only `SKILL.md` and [identity-quick-reference.md](identity-quick-reference.md); no implementation or golden fixture file enters the model context.

| Group | Neutral cases | Independent native runs | Scored checks |
|---|---:|---:|---:|
| dedup-and-direct-entry | 10 | 23 | 312 |
| non-destructive-identity-graph | 10 | 27 | 1,188 |
| webhook-stitch-and-receipts | 10 | 28 | 516 |

Related runs share identical top-level input properties for compactness. Every run is reconstructed independently and compared with its complete native expected result before projection. There are 70 successful full goldens (68 unchanged and two explicitly derived) and eight rejected invocations. The two successful derivations replace only a synthetic email domain with reserved `example.test`, with its canonical answer independently authored, and set a configured recent confidence to 0.37 with an independently calculated semantic fingerprint. Three rejection derivations exercise the already accepted page-event conflict and semantic/policy receipt-conflict tests. Original native fixture files remain unchanged; exact source names, full inputs/outputs and derivations are retained in private pre-live evidence.

The offline test uses the actual shared parser, types-only schema validator, array-cardinality operation and scalar scorer. Twenty-one targeted scorer mutations and three executed ordering mutations cover time, scope, ordering, ambiguity, unknown/null, replay, configuration and transaction-policy decisions; invalid JSON/nonfinite transport is also rejected. Array cardinality is checked from actual arrays, never model-asserted counts. Strings, booleans, nulls and integer counts remain strict; fractional configured confidence uses absolute tolerance 1e-12. Schemas require exact structural keys without expected-value enums, consts, patterns or defaults.

## Reproduce offline and prepare live execution

Run from the repository root:

```sh
node skills/clickstream-identity-stitching/scripts/test-eval-manifest.mjs
python3 scripts/run-skill-evals.py --self-test
python3 scripts/run-skill-evals.py --skill skills/clickstream-identity-stitching
node skills/clickstream-identity-stitching/scripts/test-primitives.mjs
node skills/clickstream-identity-stitching/scripts/test-graph.mjs
node skills/clickstream-identity-stitching/scripts/test-webhook.mjs
bash scripts/check-confidential.sh --worktree
```

The manifest test has an explicit `--write` regeneration mode; ordinary execution requires byte-for-byte freshness. `--evidence /path/to/new-report.json` exclusively creates a private report with full native derivation, projections and hashes. Keep such reports outside published model context. The optional `--original-manifest /path/to/original-manifest.json --original-results /path/to/original-results.json` test flags verify retained non-graph call identity and rescore the original cells without submitting requests. The shared harness is unchanged and is documented in [model-evaluation.md](../../../docs/model-evaluation.md).

The original matrix used the fixed 3 groups × 2 conditions × `claude-fable-5-1`, `claude-sonnet-5`, `qwen3:4b` = 18 cells. Its manifest, context, harness, raw responses, exact scores and failures remain archived independently. The next reviewed execution is limited to six corrected graph cells and two transport-only Sonnet webhook supplements. The graph calls are a rubric/format correction, not successful-cell retries to improve scores. The webhook pair supplies previously unavailable responses with unchanged prompt/schema/check/context bytes. Its original timeouts remain visible.

The local Qwen settings remain context 32768, output 8192, think false, temperature 0, with an explicitly owned loopback endpoint and no concurrent Qwen evaluator. The harness reads `OLLAMA_BASE_URL`; `OLLAMA_HOST` configures the Ollama service itself. A separately reviewed wrapper will extend only Sonnet's subprocess timeout from 300 to 600 seconds and restore the override in `finally`; the shared harness remains unchanged. Actual CLI/model identity, cached model digest, request/context/schema/scorer hashes and terminal status must be captured for each attempt.

The corrected graph invocation through that reviewed wrapper will select only `--groups non-destructive-identity-graph --condition both --models claude-fable-5-1 claude-sonnet-5 qwen3:4b`, with a new output artifact. The separate webhook supplement will select only `--groups webhook-stitch-and-receipts --condition both --models claude-sonnet-5`, again with a new artifact. Exact wrapper path and owned endpoint belong in the reviewed execution evidence; neither command has run in this preparation. Do not resume the original whole-matrix artifact under a changed manifest or weaken the shared resume checks. Preserve original per-cell manifest metadata and prove the retained 12 non-graph requests still match the final manifest.

Publication and combined score reporting remain pending the corrected-run review. Transport failures and truncated output are unavailable evidence, not knowledge misses; no score is inferred for them.

## Fixed substantive objectives

## 1. dedup-and-direct-entry

Objective: Given a source-scoped visitor's ordered A → B → A attribution journey, a repeated signature at 29 minutes and another exactly 30 minutes after the accepted touch, differing campaigns/click IDs, a first Direct touch and a later Direct touch, identical/conflicting scoped keys, and one late event older than persisted state, produce kept/suppressed decisions and explain the replay boundary. Include a national phone number, an international formatted phone with extension, and an email containing a plus tag.

Acceptance rubric: preserve intervening journeys and distinct signatures; apply a strict below-30-minute suppression threshold without resetting it on suppressed events; accept only first-entry Direct for attribution; keep session semantics separate; reject conflicting scoped keys and require full replay for late additions; require an explicit phone country code, strip supported extensions, preserve email dots/plus tags, and distinguish local canonical hashing from outbound CAPI normalization.

## 2. non-destructive-identity-graph

Objective: Given two explicitly bound CRM scopes, unknown identity evidence, an email/phone contradiction, two devices for one contact, and one shared device with edges on January 10 and January 12, produce qualified graph outcomes through January 12 with a two-day lookback. Include January 7, 8, 9, and 12 touches and a future identify. Ask whether bare GA4/PostHog/Segment/Snowplow IDs or equal IPs can bridge the sources.

Acceptance rubric: create edges only for unique qualified candidates, union contradictory signals into ambiguity without merging, preserve each observation, require every source/scope binding, exclude future evidence, use the edge-anchored inclusive lookback, preserve global shared-device ambiguity even when only one edge is touch-eligible, leave zero-eligible touches unresolved, and distinguish global ambiguity contacts from credit candidates. Require explicit verified source adapters; reject IP and bare-ID inference and raw PII output.

## 3. webhook-stitch-and-receipts

Objective: Resolve verified form submissions containing a known explicit visitor, an unknown cross-site key followed by a valid page event, a recent hash-backed visitor, ambiguous email/phone visitors, and no identity. Exercise inclusive lower and upper windows, old/future edge or last-seen times, identical and conflicting page-event keys, duplicate deliveries after candidate state changes, changed semantic fields/policy, and the same transport key in a different provider/scope. Design a durable receipt and business-event persistence transaction.

Acceptance rubric: apply the four-method precedence, require exact event correlation, use only established graph evidence with both timestamps in window, never select the newest ambiguous visitor, and create deterministic scoped fallback visitors without inventing prior behavior. Preserve the original validated receipt on identical replay, reject semantic conflicts, keep provider/scope identities separate, avoid duplicate identify effects, distinguish configured confidence from probabilities, and require caller-owned atomic persistence, unique constraints, bounded race retries, stable business-event IDs, and outbox consumer idempotency without claiming pure-function exactly-once delivery.

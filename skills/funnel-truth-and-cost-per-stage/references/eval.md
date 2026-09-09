# Funnel model evaluation: v2 and historical v1

The revised documentation and scorer have a completed 18-cell model matrix, with one
explicit transport-only supplemental recovery. Historical v1 evidence remains unchanged.

## Current v2 model matrix

All **18 cells have usable evidence** across the original matrix and one separate transport
recovery. The original run began 2026-09-09T02:13:33.140463+00:00 and finished 2026-09-09T02:34:47.629487+00:00.
The supplemental cell finished 2026-09-09T02:42:10.942001+00:00. Every scored cell has complete,
schema-valid JSON, matching requested/resolved model identity, and no transport or parse error.
Usable does not mean correct. Each score is passed checks / declared checks, followed by the fraction.

| Model | Condition | Stage truth | Cost reconciliation | Refresh partitions |
| --- | --- | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 189/189 (1.000) | 146/146 (1.000) | 105/105 (1.000) |
| claude-fable-5-1 | without-skill | 133/189 (0.704) | 80/146 (0.548) | 103/105 (0.981) |
| claude-sonnet-5 | with-skill | 188/189 (0.995) | 144/146 (0.986) | 105/105 (1.000) |
| claude-sonnet-5 | without-skill | 159/189 (0.841) | 82/146 (0.562) † | 82/105 (0.781) |
| qwen3:4b | with-skill | 57/189 (0.302) | 70/146 (0.479) | 60/105 (0.571) |
| qwen3:4b | without-skill | 31/189 (0.164) | 69/146 (0.473) | 28/105 (0.267) |

† Only this cell comes from [the transport supplement](eval-results-v2-transport-supplement.json).
The [original matrix](eval-results-v2.json) retains its failed attempt: Python
`subprocess.TimeoutExpired` after 300.009541 seconds with no raw model envelope. Its original
score remains **n/a**, not zero and not a knowledge miss. It was never overwritten. The
[supplemental runner](eval-v2-recover-transport.py) imported the unchanged harness and extended
only the Claude subprocess timeout from 300 to 600 seconds, restoring the runtime override in
`finally`. Prompt, system, schema, model, budget, options, context and scorer hashes were unchanged.
No successful scored completion was rerun. The supplemental wrapper SHA-256 is
`0ee80e73f9fea3561026eff7129e615425869e7c9eb0b30744868dd50b27b26b`. Its original matrix/cell hashes and exact selection
are recorded in the supplement. This extra transport attempt is explicit, not silently merged
into the raw original evidence.

Each model-condition pair covers 440 declared checks across the same ten synthetic cases.
Checks share rows and fields and are not independent trials. The table uses the frozen scorer
without aligning rows, renaming statuses, or adjusting scores after reading the answers.
Within v2, with-skill scores are higher in every model/group pair. This small synthetic matrix
does not prove production readiness, causal attribution, native SQL execution, or general model
quality. V1 and v2 use different documentation and scoring representations; their scores must
not be combined or treated as a controlled estimate of the documentation change alone.

The audit reparsed all 18 usable raw envelopes, rechecked schema/model identity, reconstructed
each prompt/system/context/schema/manifest/harness hash, and recomputed every check with the
frozen scorer. It verified actual Qwen request options: context 32768, output 8192, temperature
zero, `think=false`, `stream=false`, and digest
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
Claude Code was `2.1.263`; both exact Claude models used safe mode, disabled tools/MCP, no
session persistence, the types-only schema, and the same $2 per-call budget.

Owned harness PID 29783 and Ollama PID 29778 exited, port 11435 has no listener, and the user’s
Ollama PID 3157 remained running. The reusable model cache was retained. No frozen model input
or shared harness changed during either v2 run. All v1 artifact hashes remain unchanged.

- [Original harness-generated report](eval-results-v2.md), retaining the original timeout as n/a.
- [Supplemental harness-generated report](eval-results-v2-transport-supplement.md).
- [Complete v2 provenance, hashes, score and cleanup audit](eval-v2-provenance.json).

Reproduction of the original matrix requires a fresh output path; never overwrite these artifacts.

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11435 python3 scripts/run-skill-evals.py \
  --skill skills/funnel-truth-and-cost-per-stage --run \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both \
  --output skills/funnel-truth-and-cost-per-stage/references/eval-results-v2.json
```

The completed one-cell recovery used:

```sh
python3 skills/funnel-truth-and-cost-per-stage/references/eval-v2-recover-transport.py --run
```

The wrapper refuses to overwrite its
supplement, and must not be rerun to seek a different score. Download copies include the
consolidated guide, original v2 report, supplemental report and provenance JSON.

## Revised instructions and evaluation contract

The selected ten neutral cases are unchanged: four stage-truth, three cost-reconciliation, and
three refresh-partition inputs. IDs remain `A`, `B`, `C`, and (for stage) `D`. Group prompts,
inputs, output schemas, and independently pinned native fixture projections are byte-equivalent
as JSON values to v1. The model still receives only `SKILL.md` and the three native contracts;
fixture IDs, expected values, checks, builders, this report, and prior model outputs stay outside
model requests. The schema remains types-only with every projected field required and extra
object properties forbidden.

The revised public context closes actual documentation gaps identified in the v1 review:

- [Cost contract](cost-contract.md): exact bucket, reconciliation, channel, revenue/spend,
  absence-reason and cost-status literals, with native precedence; final report and evidence
  ordering, default null placement, tie behavior, and projection order.
- [Refresh contract](refresh-contract.md): exact fallback codes in accumulation order, change
  selection and target reason codes, every final array sort tuple, and current-population
  replacement semantics for moved/deleted/unchanged rows.
- [Stage contract](stage-contract.md): final ledger sort tuple and ordered truth-status cases.
- `SKILL.md`: stable evaluation-status link replacing the stale no-evaluation sentence.

These are general rules taken from the accepted native SQL, not worked answers for selected
cases. Native SQL, native fixtures, computation, and semantic expected outputs were not changed.

Scoring now measures each real array's length with `array_length_equals`, including `/cases`,
all ledger/report/partition arrays, and empty/nonempty fallback arrays. It does not accept a
model-asserted row count as evidence of cardinality. Every array item is checked by its index,
so identities, dates, timestamps, and row order remain exact. Required/additionalProperties
schema checks enforce object structure without redundant full-object equality.

Non-null `value`, `revenue`, `spend`, and `cost_per_stage` use the accepted scorer's numeric
`approximately` operation with absolute tolerance **1e-9**. This accepts JSON money `5` and
`5.0` as equivalent at the fixture magnitudes while rejecting strings, booleans, nulls,
nonfinite values, wrong signs, and tested changes beyond that tolerance. Null money remains a
strict null check. Strings, booleans, statuses, keys, currencies, dates, timestamps, and integer
counts use strict `equals`; integer counts do not inherit the money tolerance. This scoring
representation rule does not change native NUMERIC computation.

| Group | Cases | Actual array lengths | Strict scalars | Numeric scalars | Total checks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `stage-truth` | 4 | 5 | 183 | 1 | 189 |
| `cost-reconciliation` | 3 | 4 | 136 | 6 | 146 |
| `refresh-partitions` | 3 | 10 | 87 | 8 | 105 |

The current builder preserves every literal expected scalar from v1. Redundant whole-array or
whole-object equality is removed; it formerly let a JSON parser's integer/float distinction
penalize otherwise equivalent numeric money and multiply a single scalar miss through containing
arrays. New checks retain actual cardinality and exact indexed scalar semantics. Scores from
the two revisions are therefore different metrics and must not be silently combined or rescored
under one label.

## Frozen evidence and revised hashes

- Preserved v1 manifest: [eval-cases-v1.json](eval-cases-v1.json), SHA-256
  `291dbf45c132f150b4be686b2319a3078b9ecd4981e212e25a1a6c1810c8f21d`.
- Revised manifest: [eval-cases.json](eval-cases.json), SHA-256
  `35b20930e1901ac330c7dbdd964842def2ef4b3bd1b2df54d47016dc7d4e41a5`.
- Historical executed harness: `081a8b90a942a5d0ed832550332bef2c10e6fdd1b9db14d02f2125583d3045b2`.
- Accepted additive-operation harness used for v2 evaluation and offline validation:
  `b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`.

| Declared context | Historical v1 SHA-256 | Revised SHA-256 |
| --- | --- | --- |
| `SKILL.md` | `e9b0caab744a023e807a59659a6b7365913b854e3763da89396ac801d0fef75a` | `421d4f894f90020f3651ff78ee73b5ed3b260dad207faafc35cb8a23d983ef64` |
| `references/stage-contract.md` | `2650beb2f282e7c618fb7474398d46ec20064aeedf8891a1c30980a7541ccaf2` | `e498dbfba65bdd5ac564703325b46d52f7b7d11a0dffbf4def905a15f059960d` |
| `references/cost-contract.md` | `7bdba838c7f9d060be28f7a6068e9d1fd00e301b92dc94b5eeaa033b6b459d49` | `e809a95af709e173683d6817b49ea0f9bd2b83845cf8ad12eff492ff63c92d5e` |
| `references/refresh-contract.md` | `5d9db495817710bfd749ed6794604e6513bc8c7871c0e9edf7c17019c1c87cff` | `468965f6cfb583f30a0a42f1c76d8c941ebe12bde41bedf8507d1ac88144a6ab` |

Original `eval-results.json`, `eval-results.md`, the nine-cell pre-recovery checkpoint, and
`eval-recovery-20260909.json` remain immutable v1 artifacts. The v2 matrix and transport supplement use
separate revision-specific output and do not resume or overwrite those results.

## Offline validation

From the repository root:

```sh
node skills/funnel-truth-and-cost-per-stage/scripts/build-eval-cases.mjs --check
node skills/funnel-truth-and-cost-per-stage/scripts/test-eval-cases.mjs
python3 scripts/run-skill-evals.py --skill skills/funnel-truth-and-cost-per-stage
python3 scripts/test-skill-evals.py
```

All passed. The real shared-scorer test runs **2,145 assertions**, independently using v1's
literal complete projections. It verifies every array/scalar path, unchanged prompts/input/schema,
manifest freshness and pinned fixture provenance. It rejects missing/extra/reordered rows, missing
or extra nested object keys, model-asserted counts, invalid nulls, nonfinite values, wrong nested
booleans, monetary signs, currencies and statuses. Equivalent monetary number spellings pass;
strict count/boolean types remain distinct. No SQL execution or model call is implied by these
offline tests.

## Historical v1 model matrix

The preserved v1 run used the earlier documentation and scorer. Its results do **not** evaluate
the revised files described above. All **18 cells** completed with usable, schema-valid JSON and matching requested/resolved model
identities. The initial run began 2026-09-09 at 01:19:22 UTC; recovery completed the matrix at
01:53:44 UTC (2026-09-08 at 18:53:44 Pacific). No recorded cell has a transport, parsing, schema,
identity, or completion failure. Usable does not mean correct: exact-check scores are below.

| Model | Condition | Stage truth | Cost reconciliation | Refresh partitions |
| --- | --- | ---: | ---: | ---: |
| claude-fable-5-1 | with-skill | 189/189 (1.000) | 107/146 (0.733) | 102/104 (0.981) |
| claude-fable-5-1 | without-skill | 127/189 (0.672) | 81/146 (0.555) | 51/104 (0.490) |
| claude-sonnet-5 | with-skill | 186/189 (0.984) | 107/146 (0.733) | 102/104 (0.981) |
| claude-sonnet-5 | without-skill | 153/189 (0.810) | 75/146 (0.514) | 46/104 (0.442) |
| qwen3:4b | with-skill | 66/189 (0.349) | 66/146 (0.452) | 45/104 (0.433) |
| qwen3:4b | without-skill | 30/189 (0.159) | 66/146 (0.452) | 26/104 (0.250) |

Each number is passed checks / declared checks, followed by the fraction. Every model-condition
pair covers the same 439 checks across four stage cases, three cost cases, and three refresh
cases. Full-array checks overlap scalar checks, and scalar checks depend on row order; these are
not 439 independent trials. No scores were adjusted after reviewing the outputs.

### What the misses establish

The frozen v1 context had documentation gaps that limit interpretation of exact-match misses:

- **Cost status vocabulary and row order:** the v1 `cost-contract.md` explained when costs were unavailable
  but did not enumerate `campaign_not_matched`, the exact expected status for these cases. It
  also did not specify the final report sort order. Both Claude with-skill outputs contain the
  expected monetary row values when rows are aligned by date, stage, bucket, and campaign for
  diagnosis; their differences are row ordering and these undocumented status labels. Fable
  writes `not_matched` or `no_primary_stage_count`; Sonnet writes `not_matched`. Their raw 107/146
  scores should not be described as failures of cost arithmetic. This diagnostic comparison is
  not a revised score or an authorized change to the frozen specification.
- **Refresh fallback vocabulary:** the v1 `refresh-contract.md` explained that a timezone change forces
  full reconciliation but did not spell out the expected `timezone_changed` enum. Both Claude
  with-skill outputs use `report_timezone_changed`. This accounts for their failed fallback-array
  and full-output checks (102/104); the context gap prevents attributing this to a reasoning error.
- **Documented stage behavior:** Sonnet's with-skill stage miss drops `USD` from a complete set of
  same-currency wins with an unknown amount. The currency-retention rule is explicitly supplied
  in `stage-contract.md`'s monetary section; its scalar miss also fails the containing array and
  full-output checks. Fable passes all 189 stage checks.
- **Qwen has substantive misses beyond vocabulary:** its with-skill stage output omits required
  configured stage rows and loses dated/achieved facts. The context explicitly requires the
  lead-by-stage ledger. Its refresh output subtracts the wrong overlap span, retains the changed
  lead in an obsolete activity partition, and omits current rows in other target partitions.
  The overlap formula, both date modes, and complete-current-population replacement requirements
  are explicitly provided. Cost mistakes include inconsistent counts and assigning spend to an
  ambiguous campaign, beyond the same status/order documentation gaps.

This matrix measures conformance to a bounded synthetic projection. With-skill scores improve
for all model/group pairs except Qwen cost, which is unchanged. It does not prove production
readiness, native SQL execution, causal attribution, or general model quality. Some exact
requirements were present in native fixtures/SQL but absent from the four files actually
sent to v1 models; they cannot be treated as supplied v1 instructions. No file changed during
that frozen run and no successful cell was rerun. Later documentation/scorer corrections above
are a separate revision whose completed evaluation is reported above.

### Interruption, recovery, and provenance

The earlier harness PID 94275 and its owned Ollama server PID 94269 were absent at recovery.
The earlier log and checkpoint recorded nine completed, error-free cells. Their complete raw
cell objects were preserved unchanged. There was no recorded failed model cell to convert into
a score; any uncheckpointed in-flight call at interruption is unobserved. Missing access to the
older tool session is not evidence of a model or transport failure.

Recovery resumed the checkpoint with the same frozen manifest, context, harness, and model
configuration, skipping all nine stored cells. It used foreground harness PID 17164 and an owned
Ollama 0.33.2 server PID 17159 at port 11435. Both exited after completion; the port has no listener.
The user's Ollama PID 3157 was left running. The reusable model cache was retained.

- Manifest SHA-256: `291dbf45c132f150b4be686b2319a3078b9ecd4981e212e25a1a6c1810c8f21d`.
- Harness SHA-256: `081a8b90a942a5d0ed832550332bef2c10e6fdd1b9db14d02f2125583d3045b2`.
  This identifies the historical harness actually executed and independently audited for this
  matrix. Subsequent authorized scorer development may change the current repository file; it
  does not change these recorded scores. No run or resume under a later harness is part of this
  evaluation. Reproducing this matrix requires the recorded harness version.
- Claude Code: `2.1.263`; exact models `claude-fable-5-1` and `claude-sonnet-5`, safe mode,
  disabled tools/MCP, no session persistence, and the original types-only schema and budget.
- Qwen: `qwen3:4b`, digest
  `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`, context 32,768,
  output budget 8,192, temperature zero, `think=false`, `stream=false`; no model substitution.
- The original v1 SKILL.md sentence saying no evaluation had run remains in the recorded raw
  system prompts as historical evidence. The current SKILL.md instead links this evaluation
  status. This report and prior expected checks are not included in the model context.

The exact v1 manifest is preserved in [eval-cases-v1.json](eval-cases-v1.json).
Raw envelopes, parsed values, timestamps, actual model identities, prompt/system/schema hashes,
all four context hashes, options, and exact check results are in [eval-results.json](eval-results.json).
The untouched nine-cell checkpoint is [eval-results-pre-recovery-20260909T0142Z.json](eval-results-pre-recovery-20260909T0142Z.json).
The interruption record and independent final provenance/cleanup audit are in
[eval-recovery-20260909.json](eval-recovery-20260909.json). The harness-generated table is
[eval-results.md](eval-results.md). A consolidated user-facing copy is saved to
`~/Downloads/funnel-truth-and-cost-per-stage-model-evaluation.md`; the unmodified generated report
is also copied to `~/Downloads/funnel-truth-and-cost-per-stage-evaluation-report-v1.md`.

Historical v1 resume command (already completed; do not run it against revised files):

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11435 python3 scripts/run-skill-evals.py \
  --skill skills/funnel-truth-and-cost-per-stage --run \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both \
  --resume skills/funnel-truth-and-cost-per-stage/references/eval-results.json
```

Validation passed: frozen manifest test (including generic-scorer mutation checks), shared
harness offline tests and self-test, and an independent reparse/schema/identity/hash/check audit
of all 18 final raw envelopes. The audit also verified exact preservation of the nine prior
cells and every Qwen digest/option. No frozen skill, native contract, fixture, builder, test, or
shared harness was edited during that recovery. The later revision is described above.

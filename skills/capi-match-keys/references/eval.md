# Fixed CAPI evaluation record

Status: **complete**. The 18-cell matrix and three authorized supplemental attempts are terminal: 18 usable logical cells across 21 attempts. The original three Sonnet baseline timeouts remain preserved. See [the scored report](eval-report.md), [all-attempt records](eval-results.md), and [provenance](eval-provenance.json).

[eval-cases.json](eval-cases.json) has exactly three groups: `keys` (4 cases, 141 checks),
`conversions` (4 cases, 376 checks), and `delivery` (5 cases, 186 checks): **13 neutral outer cases,
703 scored checks**. The outer labels reset to A in each group. Inner requests preserve their
supplied ordering. Fixture behavioral names never appear in model inputs. The
[evaluation output contract](evaluation-output-contract.md) defines exact projections, vocabulary,
array ordering, nullability and native lifecycle semantics without per-case expected outputs.

The five included contexts are SKILL.md, key-contract.md, conversion-contract.md,
payload-quick-reference.md and evaluation-output-contract.md. The compact provider reference
covers all configuration keys, accepted wire fields, hash/time/money rules and diagnostics; the
full payload contract remains linked production documentation. The full outbox contract remains linked
production documentation; complete scored lifecycle rules are stated in the included output
contract to keep the context within the configured window. Expected answers reside only in
manifest checks and offline fixture/test data. The request builder sends only prompt, raw input
and types-only schema. The baseline gets those same facts/schema/prompt without skill context.
No enum, example, minimum cardinality or expected result is embedded in schemas.

Each group includes one neutral, deduplicated `sha256_oracle` list mapping exact UTF-8 preimages
to SHA-256 digests, identically available in both conditions. Its 19/12/14 candidates cover the
needed normalized forms and business-ID tuples plus plausible alternatives. Entries carry no
provider/case answer labels. Digests are computed with Node crypto and independently verified
with Python hashlib; expected helper outputs still come from independently authored literal
fixtures. This evaluates selection of the correct provider normalization and ID preimage, not
unaided SHA-256 calculation by a text model. Actual helper tests prove the crypto implementation.

## Scope and independent verification

Keys cover all five email/phone differences, canonical versus provider matching representations,
internal whitespace, FBC capture time, missing click, existing cookie and invalid-cookie rejection.
Conversions include full native stage projections for nonprimary zero, unknown, negative,
undated/unknown/not-achieved truth, qualified source exclusions and ties, exact inclusive click
and event boundaries, future/old events and browser/business ID separation. Delivery covers all
five complete ready configurations and structured body projections, exact destination mapping,
and a supplied transactional/loopback scenario for replay, body/identity conflicts, rollback,
committed claims, stored-byte retries, fencing and remote-acceptance limits.

The test projects accepted literal goldens and independently verifies them through the actual
production key/conversion/payload modules. It does not execute producers to author expected
answers. Native operation expectations are literal analytical values verified against the accepted
owned PostgreSQL evidence: complete rows, five full wire goldens, ten byte-identical loopback
receipts, committed claim probes, final attempts/audit and the original native fencing suite.
Reading evidence is **NO SQL EXECUTED**, not a new database test.

The frozen generic scorer is version `2026-09-08.3`, SHA-256
`b12f6051d57135d23bdf5e4204c6d4866ddbb41d5602bb4ea63972ab45567b45`.
Offline validation calls its real `validate_manifest`, request construction, `evaluate_call`,
schema validator and comparators. It checks every projected scalar and every array length,
request/expected separation with a sentinel, neutral labels, missing/extra fields, nonfinite
numbers and wrong types. Executed scoring mutants include wrong provider normalization/phone
hashing, fabricated FBC, suppressing nonprimary events, unknown-to-zero, lost refund sign,
old-event acceptance, browser-ID replacement, custom destination collisions, stale completion,
retry reconstruction, network inside a transaction, wrong conflict SQLSTATE and false remote
acceptance claims. Structural/field and named semantic mutations total **182 checks**.

## Reproduce offline

From the repository root:

```sh
node skills/capi-match-keys/scripts/test-eval-manifest.mjs
python3 scripts/run-skill-evals.py --skill skills/capi-match-keys
node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check
node scripts/test-suite-contracts.mjs
```

These commands make no model calls; **NO SQL EXECUTED**. The manifest test requires Node, Python 3,
`tiktoken==0.13.0` for the recorded token estimates, and the frozen shared scorer. If needed,
install the token estimator into your Python environment with
`python3 -m pip install tiktoken==0.13.0`. This installation is separate from model execution.
For a copied standalone skill, set `CAPI_EVAL_HARNESS` to a copy of that frozen
`run-skill-evals.py` file before running `node scripts/test-eval-manifest.mjs` from the skill root.
No sibling skill modules or fixtures are imported. `--write` deterministically regenerates the
manifest from the test's fixed definitions and accepted literal fixture projections; ordinary
runs fail if it is stale. Never regenerate accepted numerical/provider fixture goldens.

Optional local evidence inspection:

```sh
node scripts/test-eval-manifest.mjs --native-evidence /path/to/owned-native-evidence.json
```

Run that command from the skill root; the evidence must have the accepted native suite and
`provider_integration` records. To execute a new isolated native test separately, use
`bash scripts/test-conversion-outbox.sh`; this owns a fresh local cluster and never calls a
provider. The pure manifest verifier itself never connects to PostgreSQL.

## Recorded live command

The original authorized run used the equivalent absolute paths of this repository-root command:

```sh
python3 scripts/run-skill-evals.py --skill skills/capi-match-keys --run \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both \
  --output skills/capi-match-keys/references/eval-results.json
```

The harness must remain frozen along with manifest/context/source hashes through a run. It
preserves raw envelopes, actual model identity/digest, request hashes, completion/schema status
and exact check records. A transport, parsing, identity, schema or completion error is unresolved
execution evidence, not a model knowledge score. Preserve failed checkpoints and rerun provenance.
Qwen uses the accepted 32,768 context / 8,192 output / think=false configuration. CLI credentials,
local model availability and an explicitly owned model server are operational prerequisites;
this document does not start them.

Token estimates use cl100k, not a claim about each provider's exact tokenizer. Expected outputs
fit within 8,192 with at least 1,024 tokens of formatting headroom; each request plus that full
output budget stays below the stricter 28,000 estimate threshold, leaving additional margin
below 32,768 for tokenizer differences. Exact measured per-group counts, context/manifest/source hashes and
mutation results are saved in timestamped Downloads manifest evidence. These fixed synthetic
results measure the selected tasks only; they are neither broad model rankings nor live provider
acceptance, match-rate, attribution or exactly-once guarantees.

Current cl100k estimates with the compact provider reference:

| Group | Request plus context | Expected output | Request + 8,192 reserve |
| --- | ---: | ---: | ---: |
| keys | 13,839 | 1,748 | 22,031 |
| conversions | 18,147 | 4,628 | 26,339 |
| delivery | 19,079 | 2,381 | 27,271 |

The test enforces the 28,000 ceiling, independently verifies every supplied oracle digest,
and checks the compact reference against all five production configuration-key declarations,
all accepted fixture wire keys and every fixture reason/warning literal. Vocabulary presence
is an automated completeness check; it complements review of the general mapping semantics.

# Channel taxonomy evaluation

The shared-harness manifest retains three fixed groups with eight neutral scenarios each:

1. `conflicting-acquisition-evidence`: classify conflicting click, medium, network, native,
   referrer, and Direct evidence, retaining the distinction between a label and proof of spend.
2. `native-shopify-network-normalization`: classify native projections, explicit networks,
   Shopify types, unknown evidence, and AI referrals without losing raw provenance.
3. `cross-source-interoperability`: review scoped identity, overlap, source attribution,
   daily grain, required metrics, absent/unknown money, and incompatible currencies.

The first 16 expected channel/version projections are checked against the actual current
`classify` API. Boolean provenance decisions and the eight interoperability answers are
case-specific readings of [channel-contract.md](channel-contract.md), not native join results.
The old combined monetary status rubric was corrected to the existing contract's `unknown`
and `mixed_currency` statuses. No monetary records means an empty observation list and a null
total; a declaration of currencies or available metrics is not an observed amount. Historical
manifest/results and the former skill-local harness are preserved in a private review archive.
Historical [results](eval-results.md) describe the former manifest and are not scores for this one.

[eval-cases.json](eval-cases.json) uses the shared harness's exact format. The public
[evaluation-output-contract.md](evaluation-output-contract.md) defines projections, vocabulary,
and every scored array order and is included in each condition's user prompt. The with-skill
context contains exactly `SKILL.md`, `references/channel-contract.md`, and
`references/source-mappings.md`. Baseline receives the same raw inputs, output schema, and
user prompt with no skill context. Expected checks remain outside both model requests.

From the repository root, run the offline verification:

```sh
node skills/channel-taxonomy/scripts/test-eval-manifest.mjs
python3 scripts/run-skill-evals.py --skill skills/channel-taxonomy
```

The Node test runs the real classifier and frozen shared parser/scorer, checks all 24 literal
projections, meaningful semantic and schema mutations, request separation, vocabulary, source
pins, and a copied standalone skill with an explicitly supplied shared scorer. It reports
`NO SQL EXECUTED`; no model or network calls occur. Deterministically regenerate the manifest
from its reviewed literal definitions with the same Node command plus `--write`.
Node 18+ and Python 3.10+ are required. `tiktoken` is optional for a cl100k estimate; the test
otherwise labels its conservative bytes/3 estimate. Neither is a claim about Qwen tokenization.

All 18 cells for manifest `1be1b437` are **published** in [eval-results-v2.json](eval-results-v2.json) and [eval-results-v2.md](eval-results-v2.md). The historical v1 matrix on manifest `5ef36ee6` remains in [eval-results.json](eval-results.json) and [eval-results.md](eval-results.md) unchanged. See [eval-v2-provenance.json](eval-v2-provenance.json) for redaction and rescore metadata (`model_reruns_during_publication: 0`).

After separate launch review, reruns must use a new output artifact:

```sh
python3 scripts/run-skill-evals.py --skill skills/channel-taxonomy --run \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both \
  --groups conflicting-acquisition-evidence native-shopify-network-normalization cross-source-interoperability \
  --output "$HOME/Downloads/channel-taxonomy-shared-evaluation-raw.json"
```

A live launch must use the intended authenticated Claude CLI and an explicitly owned Ollama
endpoint via `OLLAMA_HOST`, with exact model identities recorded. The frozen harness uses
32768 Qwen context, 8192 output, temperature 0, and thinking disabled. Transport or schema
failures are unavailable results, not zero knowledge scores. Any timeout override requires
separate review and explicit provenance. Results describe these 24 synthetic scenarios only;
they do not establish a general model ranking, source parity, paid spend, or causal validity.

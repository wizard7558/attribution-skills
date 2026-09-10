# Offline model evaluation

The fixed manifest at `references/eval-cases.json` contains exactly three groups and ten
independent synthetic inputs. The model receives only `SKILL.md`, `references/contract.md`,
`scripts/attribute-leads.mjs`, and `scripts/channel-taxonomy.mjs`; fixture IDs, authored expected values, and builder code stay out of
model context. Every group uses neutral case IDs (`A`, `B`, ...), requires a `cases` array in input
order, and requires each case's projected `leads` array in input order. The types-only schema
requires these fields for every projected lead: `channel`, `quality_status`, `ad_match_status`,
`ad_confidence`, `ad_key`, `campaign_key`, `ad_source_system`, `ad_source_scope`,
`is_attribution_primary`, `confidence`, and `match_key`. Null and false are meaningful values.

Build and verify the manifest from the repository root:

```sh
node skills/crm-paid-attribution/scripts/build-eval-cases.mjs
node skills/crm-paid-attribution/scripts/test-eval-cases.mjs
python3 scripts/run-skill-evals.py --skill skills/crm-paid-attribution --self-test
```

The builder checks every selected fixture's authored literal expected dot path, then compares the
full runtime projection with pinned authored projection literals before writing the manifest.
Checks backed directly by fixture literals are marked `fixture-literal`; supplemental projections
are marked `pinned-projection-literal`. The test script verifies
regeneration byte equality, the fixed group and fixture mapping, neutral labels, complete scalar
pointer coverage, and mutation sensitivity. The recorded matrix and any supplemental model runs
are kept separate from this deterministic manifest validation.

Run the same three groups with and without the skill for all requested models only after review:

```sh
python3 scripts/run-skill-evals.py \
  --skill skills/crm-paid-attribution \
  --run --models claude-fable-5-1 claude-sonnet-5 qwen3:4b \
  --condition both
```

The harness records raw responses, parser/schema status, exact model identity, and per-pointer
checks. Scores are limited to the declared projected fields and exact values in the manifest; they
do not establish spend, incrementality, revenue, causality, or production readiness. Unavailable
credentials, models, transport failures, invalid JSON, and truncation remain `n/a` evidence rather
than zero scores. A completed matrix or supplement must retain those statuses and its recorded
raw metadata; this document does not infer scores for unavailable cells.

| Group | Cases | What the inputs exercise |
| --- | --- | --- |
| `precedence-and-normalization` | A–C | Click precedence, current organic protection, and canonical bounded raw decoding |
| `scoped-ad-matching` | A–D | Qualified account binding, authorized ambiguity, binding rejection, and opaque ID plus/space distinction |
| `primary-selection` | A–C | Current/first-touch deduplication, null-date lexical ties, and UTM-only primaries |

The manifest fixes these three prompts and sends each one with its complete synthetic input:

1. **Precedence and normalization:** “Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.”
2. **Scoped ad matching:** “Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.”
3. **Primary selection:** “Resolve each supplied CRM attribution input independently. Return one case object for every input, in input order, with its projected lead results in input order. Preserve false and null exactly; do not execute code or include explanations.”

## Latest recorded matrix

The initial authorized 18-cell run completed on 2026-09-08 using the frozen manifest and context
hashes. All 12 Claude cells returned complete, schema-valid JSON and were scored against 210 exact
checks per model-condition matrix. Its six Qwen3:4b cells remain recorded as `n/a` transport
failures because the default Ollama daemon reported no installed models. A separate authorized
supplement then ran those six Qwen cells on an owned Ollama daemon at port 11435 after downloading
the model; all six returned complete, schema-valid JSON with the verified digest
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.

| Model | With skill | Without skill |
| --- | ---: | ---: |
| Claude Fable 5.1 | 1.000 | 0.425 / 0.509 / 0.624 |
| Claude Sonnet 5 | 1.000 | 0.350 / 0.472 / 0.573 |
| Qwen3:4b (supplement) | 0.550 / 0.774 / 0.718 | 0.325 / 0.340 / 0.436 |

The three slash-separated scores are, in order, `precedence-and-normalization`,
`scoped-ad-matching`, and `primary-selection`. These are bounded synthetic projection checks;
they measure conformance to the declared fields and fixtures only, and do not establish spend,
incrementality, revenue, causality, or production readiness. Raw envelopes, model metadata, and
hashes are preserved in `references/eval-results.json` and the supplementary raw envelopes in
`references/eval-results-qwen-supplement.json`. The initial rendered report is
`references/eval-results.md`; the supplementary report is
`references/eval-results-qwen-supplement-report.md`. A consolidated user-facing copy is saved as
`~/Downloads/crm-paid-attribution-model-evaluation.md`.

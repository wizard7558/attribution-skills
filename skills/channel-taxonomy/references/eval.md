# Evaluation prompts

These prompts are for an independent evaluator. They specify expected behavior without
fabricating model results; run them against the skill and record observed answers separately.

## 1. Conflicting acquisition evidence

You receive `{utm_source: "google", utm_medium: "email", click_ids: {fbclid: "abc"},
native_channel: "Direct"}`. Classify it, explain the precedence, and list the raw evidence
that must remain in the output.

Expected outcome: Paid Social via the social click-ID rule; mention that the label is a routing
convention rather than proof of spend; retain all raw fields and taxonomy version.

## 2. Native and Shopify evidence

Classify `{native_channel: "Cross-network", shopify_source_type: "ad",
shopify_source: "unknown"}` and then `{shopify_source_type: "ad", shopify_source: "google"}`.

Expected outcome: the first is Paid Other and the second is Paid Search due to platform evidence.
Explain that native Cross-network is a custom projection and preserve provenance.

## 3. Measurement contract

Design a daily output joining GA4 sessions with first-party pixel touchpoints. State the identity
keys, attribution basis, daily grain, required metrics, and monetary-field handling.

Expected outcome: source-scoped identity (`source_system`, `source_scope`, `session_key`,
`visitor_key`); GA4 session last-click and pixel first-touch explicitly labeled; grain
`source_system/source_scope/event_date/channel`; required sessions, engaged_sessions, new_users,
key_events; source-native monetary fields with declared currency, NULL/status for unknown or
mixed currency, explicit FX before monetary joins, and no overlap summation or fabricated
purchase equivalence.

## Reproducible model harness

The machine-readable cases and hidden rubric are in [eval-cases.json](eval-cases.json). The
harness generates exactly three prompts from those cases, each with eight independent synthetic
inputs, and runs the same prompts in `without-skill` and `with-skill` conditions against Claude
Fable 5.1, Claude Sonnet 5, and the isolated Ollama `qwen3:4b` endpoint. Expected answers are
never included in a prompt. The with-skill system context contains only `SKILL.md`,
`channel-contract.md`, and `source-mappings.md`.

Run local parser/scorer checks with:

```sh
python3 scripts/run-model-evals.py --self-test
```

After the reviewed core skill and references are ready, run the live evaluation with:

```sh
python3 scripts/run-model-evals.py --run
```

This writes [eval-results.json](eval-results.json), including prompt snapshots, timestamps,
model response metadata, raw responses, parsed JSON, item-level scores, and deltas, plus the
user-facing report at `~/Downloads/channel-taxonomy-evaluation-report.md`.

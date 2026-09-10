---
name: crm-attribution-profiler
description: Profile source-scoped CRM attribution fields against ad-history keys with exact normalized matching, configurable evidence thresholds, and safe verdict diagnostics.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# CRM attribution profiler

Use this skill when a user needs to determine whether CRM fields can support paid
attribution joins. It produces measured `propose`, `corroborate`, `reject`,
`capture_missing`, and `pre_window` verdicts from source-scoped CRM rows and ad-history
rows. It does not prove causal attribution, spend, or identity across systems.

Before running the profiler, provide an explicit `ad_scope_bindings` entry for every CRM
to ad join. The binding names both source systems and scopes, platform, and entity type;
never infer a join from a bare ID. Supply all threshold values in `config.thresholds`.

Read [api.md](references/api.md) for the input/output contract and date/key semantics.
Use [fixtures.json](references/fixtures.json) for synthetic adversarial examples and run
`node scripts/run-checks.mjs` after changes. Run
`node scripts/check-fixture-sensitivity.mjs` after changing fixtures or the harness to
prove that each expected result is actually checked. Use [eval.md](references/eval.md) for
realistic evaluation prompts.

The runtime retains only field descriptors, counts, shape distributions, rates, verdicts,
and stable diagnostic codes in its output. Do not publish raw CRM rows, raw customer
values, emails, or production identifiers.

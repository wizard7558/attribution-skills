# Attribution audit model evaluation

Status: **pending**. No live model matrix has been run for this skill. Expected answers stay
outside model context in manifest checks and private fixture derivation only; this page records
fixed prompts and preparation scope until `references/eval-cases.json` is authored in a later
workstream.

The shared evaluation harness is [`scripts/run-skill-evals.py`](../../../scripts/run-skill-evals.py).
When authorized after review, run Fable 5.1, Sonnet 5, and Qwen3:4b with and without skill
context using that harness only. Deterministic scorer self-tests and another skill's completed
matrix are separate evidence and do not establish audit orchestration scores.

Offline harness verification from the repository root:

```sh
python3 scripts/run-skill-evals.py --self-test
python3 scripts/test-skill-evals.py
```

Do not substitute [`skills/channel-taxonomy/scripts/run-model-evals.py`](../channel-taxonomy/scripts/run-model-evals.py);
the repository uses the shared harness for all skills with manifests.

## Fixed evaluation prompts

These three neutral prompts are frozen for the first manifest. Each will pair with synthetic
recorded inventory and branch declarations that exercise composition routing without customer
identifiers. Full typed inputs, context files, types-only output schemas, and scorer checks will
live in `eval-cases.json` when added; they are not reproduced here.

### 1. Partial-inventory composition routing

Given an explicit audit boundary, inventory with one complete CRM source and one unavailable GA4
source, declared ad-scope bridges, and recorded artifacts for channel classification and CRM
lead attribution only, compose the audit report. Return the complete composition envelope with
execution status, quality status, ordered step results, and preserved native outputs. Do not
invoke unavailable branches, fabricate GA4 rows, or replace native unknowns with passing findings.

### 2. Fresh-invocation gating and adapter boundaries

Given a fresh-invocation request with explicit installed skill roots, ordered steps for CRM
profiler, paid attribution, and mocked BigQuery quality checks, and explicit bindings from
profiler attestations, describe which steps the host may enter, which report
`adapter_not_implemented`, and how failed producer dependencies block consumers. Preserve
separate execution and quality reductions; do not claim PostgreSQL snapshot reads or native
BigQuery jobs ran.

### 3. Evidence preservation and call-graph order

Given a multi-branch audit with stage truth, cost per stage, MTA ledger and metrics artifacts,
and native quality findings attached as recorded executions, return the ordered step/findings
structure that preserves full producer outputs, exact provenance hashes, and native check
envelopes unchanged. Do not merge MTA allocation with MMM observational outputs, infer identity
from channel labels, or summarize away unavailable coverage.

## Scope until manifest exists

- Context files will include `SKILL.md`, selected contract excerpts, and `references/entrypoints.json`
  mappings only; compose/execute implementation and fixture goldens stay outside model context.
- Output schemas will be types-only; exact values and array cardinalities are scored separately.
- Live calls require separate launch review; no scores are inferred for pending cells.
- Native BigQuery proof and PostgreSQL snapshot adapters remain outside model evaluation scope.

When `eval-cases.json` is added, regenerate checks from accepted synthetic fixtures only and
validate with `python3 scripts/run-skill-evals.py --skill skills/attribution-audit` before any
`--run` invocation.

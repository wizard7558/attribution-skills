# Attribution Skills by Bellaso

Teach your agent to do attribution on the data you already have.

Agent skills for marketing attribution, revenue operations, and marketing measurement, written by Riley Sorenson from production work. The skills work with source exports and infrastructure you control, without depending on a particular analytics product.

Created by Riley Sorenson, the founder of [Bellaso](https://bellaso.app). These skills bring the same focus on clear attribution rules and inspectable evidence to agents working with the data and tools you already use. Use them independently without a Bellaso account.

## Install

Install all twelve skills:

```bash
npx skills add wizard7558/attribution-skills
```

Install a single skill by name:

```bash
npx skills add wizard7558/attribution-skills --skill channel-taxonomy
npx skills add wizard7558/attribution-skills --skill ga4-bigquery-export
npx skills add wizard7558/attribution-skills --skill first-party-pixel
npx skills add wizard7558/attribution-skills --skill clickstream-identity-stitching
npx skills add wizard7558/attribution-skills --skill crm-attribution-profiler
npx skills add wizard7558/attribution-skills --skill crm-paid-attribution
npx skills add wizard7558/attribution-skills --skill funnel-truth-and-cost-per-stage
npx skills add wizard7558/attribution-skills --skill multi-touch-models-sql
npx skills add wizard7558/attribution-skills --skill mmm-and-incrementality-framing
npx skills add wizard7558/attribution-skills --skill capi-match-keys
npx skills add wizard7558/attribution-skills --skill attribution-data-quality-tripwires
npx skills add wizard7558/attribution-skills --skill attribution-audit
```

The GA4 and pixel skills each bundle their classifier and contract, so a single-skill installation does not need sibling skill directories. The audit skill requires explicitly installed upstream skill roots at invocation time.

## Skills

| Skill | Version | What it does | Status |
| --- | --- | --- | --- |
| [`channel-taxonomy`](skills/channel-taxonomy) | 0.1.0 | Shared 11-channel taxonomy, classifier, contract, fixtures, and shared evaluation harness | Deterministic suite passes; v2 matrix published (18/18 on manifest 1be1b437); v1 retained |
| [`ga4-bigquery-export`](skills/ga4-bigquery-export) | 0.2.0 | Source-scoped GA4 BigQuery sessions and daily channel metrics from raw export events | Deterministic fixtures pass; model matrix published 14/18 usable; 4 transport supplements outstanding |
| [`first-party-pixel`](skills/first-party-pixel) | 0.2.0 | Owner-controlled pixel, collector, and PostgreSQL session/daily reporting views | Deterministic tests pass; harness manifest authored; live matrix published 18/18; hosted Vercel+Neon adapter smoke published |
| [`clickstream-identity-stitching`](skills/clickstream-identity-stitching) | 0.1.0 | Identity dedupe, non-destructive graph, and verified webhook resolution | Deterministic suite passes; Sonnet supplements published (4/4); Fable graph supplement published (2/2); Qwen graph supplements published (without-skill 574/1188; with-skill 706/1188 via 16k override) |
| [`crm-attribution-profiler`](skills/crm-attribution-profiler) | 0.1.0 | Profile CRM attribution fields against ad-history keys with explicit thresholds | Deterministic suite passes |
| [`crm-paid-attribution`](skills/crm-paid-attribution) | 0.1.0 | Resolve CRM leads to paid channel and ad evidence with scoped matching | Deterministic suite passes |
| [`funnel-truth-and-cost-per-stage`](skills/funnel-truth-and-cost-per-stage) | 0.1.0 | CRM stage truth, cost buckets, and refresh partition planning from explicit bindings | Deterministic suite passes |
| [`multi-touch-models-sql`](skills/multi-touch-models-sql) | 0.1.0 | BigQuery multi-touch credit ledgers and channel/day cost, CAC, and ROAS metrics | Deterministic suite passes |
| [`mmm-and-incrementality-framing`](skills/mmm-and-incrementality-framing) | 0.1.0 | Guarded weekly MMM, response curves, assumption bands, and share comparisons | Deterministic suite passes; recorded model matrix complete for fixed prompts |
| [`capi-match-keys`](skills/capi-match-keys) | 0.1.0 | Conversion preparation, provider payloads, and transactional outbox delivery | Deterministic helpers pass; PostgreSQL outbox harness opt-in |
| [`attribution-data-quality-tripwires`](skills/attribution-data-quality-tripwires) | 0.1.0 | Nine native quality checks plus schema and column population extractors | Deterministic suite passes; recorded model matrix complete for fixed prompts |
| [`attribution-audit`](skills/attribution-audit) | 0.1.0 | Compose or invoke a bounded audit across upstream skills with explicit inventory and provenance | Offline compose/execute host verified; native BigQuery proof summarized; harness manifest authored; live matrix published 18/18 |

## How they work together

`channel-taxonomy` is the authoring authority for the versioned classifier. The repository generator bundles identical classifier source into the GA4 SQL and pixel collector, plus local copies of the [shared contract](skills/channel-taxonomy/references/channel-contract.md). Both producers expose the same canonical daily grain: `source_system, source_scope, event_date, channel`.

Native labels and raw evidence remain available for audit. GA4's session last-click basis and the pixel's first collected touch remain explicit, as do source-scoped session/visitor identities, reporting date basis, and currency. Matching channel names do not establish matching people or attribution. Never sum overlapping GA4 and pixel populations. GA4 purchase revenue and pixel conversion value retain their source-native meanings, including NULL/status for unknown monetary values.

`attribution-audit` orchestrates the upstream skills through explicit installed roots and one-way entrypoints. It preserves native producer outputs separately from execution and quality reductions. GA4 SQL and PostgreSQL snapshot adapters remain unimplemented in the audit host. A bounded native BigQuery proof on owned synthetic fixtures has been recorded privately; publication of that evidence into the repository remains a separate step.

Deterministic test results and model behavior evaluations are separate evidence. Published matrices for taxonomy (18/18), GA4 (14/18), pixel (18/18), audit (18/18), tripwires/MMM/funnel/CRM skills, and identity supplements are honest about transport gaps. Identity corrected-graph supplements are complete on manifest `71a0c119`; the prior Qwen with-skill 8192 attempt remains archived as historical n/a evidence.

## Outstanding blockers

| Blocker | Skill | Owner action |
| --- | --- | --- |
| GA4 transport supplements (all 4 cells re-attempted 2026-09-09; all remain `TimeoutExpired` n/a — Fable `transactions-and-execution` without-skill at 300s in [transport supplement](skills/ga4-bigquery-export/references/eval-results-transport-supplement-fable-transactions-without.md); Sonnet `sessions-and-source-evidence` without-skill at 600s in [transport supplement](skills/ga4-bigquery-export/references/eval-results-transport-supplement-sonnet-sessions-without.md); Sonnet `transactions-and-execution` with-skill at 600s in [transport supplement](skills/ga4-bigquery-export/references/eval-results-transport-supplement-sonnet-transactions-with.md); Sonnet `transactions-and-execution` without-skill at 600s in [transport supplement](skills/ga4-bigquery-export/references/eval-results-transport-supplement-sonnet-transactions-without.md); private evidence under `Downloads/completion-live-supplements-20260909T1300Z/`) | `ga4-bigquery-export` | Escalate timeout policy or rerun if wrapper changes; never resume whole artifact under changed manifest |
| Hosted pixel adapter smoke | `first-party-pixel` | **Complete:** disposable Vercel+Neon smoke passed (pageview+identify 204; 2 events / 1 visitor) and torn down; redacted summary in [hosted-adapter-smoke.md](skills/first-party-pixel/references/hosted-adapter-smoke.md) |
| Catalog residual gaps | all twelve | Shippable with honest residuals: GA4 4× `TimeoutExpired` n/a (retried). Hosted pixel adapter smoke complete. No fabricated scores. |

## Conventions

Every skill follows the [Agent Skills specification](https://agentskills.io/specification):

- `SKILL.md` stays under 500 lines and includes valid frontmatter.
- Runnable SQL templates live in `references/` or appropriate implementation assets; generated shared SQL source can live with its generator inputs.
- Runnable checks live in `scripts/`.
- Raw GA4 wildcard scans use `PROJECT.analytics_PROPERTY_ID` placeholders and bound `_TABLE_SUFFIX`. Table-free BigQuery fixtures and PostgreSQL SQL use their own native conventions.
- No real customer identifiers or client data belong in the repository. Fixtures use synthetic evidence.
- Generated classifier/contract copies are refreshed centrally, rather than edited independently.

Enable the pre-push confidentiality check after cloning:

```bash
git config core.hooksPath .githooks
```

The scanner reads tracked files; stage intended new files before the final scan. Its optional private denylist stays outside the repository. CI runs the public patterns and skips the private list when unavailable; never commit that list to make CI match a local scan.

## Validation

CI uses Ubuntu 24.04, Python 3.12, Node 22, the official [skills-ref validator](https://github.com/agentskills/agentskills/tree/main/skills-ref), local fixtures, generated-artifact checks, and a disposable PostgreSQL/collector runtime test. It enforces the 500-line limit. Live BigQuery and actual model calls are opt-in and are not CI requirements without configured credentials.

Install and run the official frontmatter/spec validator:

```bash
pip install "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref"
for skill in skills/*/; do skills-ref validate "$skill"; done
```

Run all local deterministic checks, including the shared evaluation harness self-tests:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH   # macOS Homebrew example; Node 22+ required
bash scripts/run-tests.sh --offline
```

The component commands include artifact checks, GA4 and pixel fixture suites, shared harness validation for every skill with `references/eval-cases.json`, audit compose/execute offline hosts, per-skill deterministic tests, and SQL rendering evidence. They do not execute live models, authenticated BigQuery jobs, or PostgreSQL roundtrips unless you add `--postgres` or `--bigquery`.

To update shared artifacts, run the generator with `--repository` and omit `--check`. In a standalone channel-taxonomy installation, omit `--repository`; the generator then updates or checks only that skill's own reference SQL.

Run the standalone collector roundtrip and repository migration check as separate disposable PostgreSQL runs:

```bash
env -u DATABASE_URL PGPORT_TEST=55439 COLLECTOR_PORT=8799 \
  bash scripts/run-tests.sh --postgres
```

The repository wrapper first runs `roundtrip.sh`, then `roundtrip.sh --migration`, then the CAPI conversion outbox harness when present. Each run starts and cleans up its own database and collector, without reusing an inherited database connection. PostgreSQL server/client binaries and Node/npm are required; the test may install `pg` into temporary storage. Only the explicit `--migration` run needs repository history containing legacy schema commit `2c240a3`.

A standalone pixel installation can run its default roundtrip without git history:

```bash
# From the installed first-party-pixel skill directory:
env -u DATABASE_URL bash scripts/roundtrip.sh
```

The `--migration` flag is repository-only upgrade coverage; it is not a prerequisite for the standalone test.

Run the actual GA4 SQL templates over synthetic nested events with authenticated `bq`:

```bash
bash scripts/run-tests.sh --bigquery
# Equivalent component command:
bash skills/ga4-bigquery-export/scripts/run_checks.sh --synthetic
```

The BigQuery test uses temporary tables, a 20 MiB billing cap, and no customer table scans. It checks session/daily agreement, purchase fanout, unknown and unkeyed revenue, click-ID preservation, and date boundaries.

Actual model evaluation requires configured Claude CLI credentials and local Ollama for Qwen as described in each skill's [evaluation instructions](skills/channel-taxonomy/references/eval.md). It performs live calls and records responses and scores; it is separate from offline harness self-tests:

```bash
python3 scripts/run-skill-evals.py --skill skills/channel-taxonomy --run \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b --condition both
```

Inspect the recorded scores and failures before drawing conclusions about model quality. Test flags select independent suites: combine `--offline --postgres` explicitly to run both, or use the default with no flags for local deterministic checks only.

## License

MIT

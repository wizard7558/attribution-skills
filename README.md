# Attribution skills

Agent skills for marketing attribution, revenue operations, and marketing measurement, written by Riley Sorenson from production work. The skills work with source exports and infrastructure you control, without depending on a particular analytics product.

## Install

Install all skills:

```bash
npx skills add wizard7558/attribution-skills
```

Install a single skill by name:

```bash
npx skills add wizard7558/attribution-skills --skill channel-taxonomy
npx skills add wizard7558/attribution-skills --skill ga4-bigquery-export
npx skills add wizard7558/attribution-skills --skill first-party-pixel
```

The GA4 and pixel skills each bundle their classifier and contract, so a single-skill installation does not need sibling skill directories.

## Skills

| Skill | Version | What it does | Status |
| --- | --- | --- | --- |
| [`channel-taxonomy`](skills/channel-taxonomy) | 0.1.0 | Defines the shared 11-channel taxonomy, classifier, contract, fixtures, and evaluation harness | Published |
| [`ga4-bigquery-export`](skills/ga4-bigquery-export) | 0.2.0 | Produces source-scoped sessions and daily channel metrics from raw GA4 export events | Published |
| [`first-party-pixel`](skills/first-party-pixel) | 0.2.0 | Sets up an owner-controlled pixel, collector, and PostgreSQL session/daily reporting views | Published |

## How they work together

`channel-taxonomy` is the authoring authority for the versioned classifier. The repository generator bundles identical classifier source into the GA4 SQL and pixel collector, plus local copies of the [shared contract](skills/channel-taxonomy/references/channel-contract.md). Both producers expose the same canonical daily grain: `source_system, source_scope, event_date, channel`.

Native labels and raw evidence remain available for audit. GA4's session last-click basis and the pixel's first collected touch remain explicit, as do source-scoped session/visitor identities, reporting date basis, and currency. Matching channel names do not establish matching people or attribution. Never sum overlapping GA4 and pixel populations. GA4 purchase revenue and pixel conversion value retain their source-native meanings, including NULL/status for unknown monetary values.

Future attribution, spend-join, or modeling skills are planned consumers of this contract; they are not implemented adapters or identity bridges in this repository. Deterministic test results and model behavior evaluations are separate evidence. In the [recorded model evaluation](skills/channel-taxonomy/references/eval-results.md), Fable and Sonnet passed all three with-skill groups. Qwen responses hit the configured output limit in both conditions; those truncation failures do not establish classification accuracy. The results do not imply universal model support.

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

CI uses Ubuntu 24.04, Python 3.12, Node 20, the official [skills-ref validator](https://github.com/agentskills/agentskills/tree/main/skills-ref), local fixtures, generated-artifact checks, and a disposable PostgreSQL/collector runtime test. It enforces the 500-line limit. Live BigQuery and actual model calls are opt-in and are not CI requirements without configured credentials.

Install and run the official frontmatter/spec validator:

```bash
pip install "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref"
for skill in skills/*/; do skills-ref validate "$skill"; done
```

Run all local deterministic checks, including the model scorer's self-tests:

```bash
bash scripts/run-tests.sh --offline
```

The component commands are:

```bash
node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check
node skills/channel-taxonomy/scripts/run-checks.mjs
node skills/ga4-bigquery-export/scripts/test-integration.mjs
node skills/ga4-bigquery-export/scripts/test-artifacts.mjs
node skills/first-party-pixel/scripts/taxonomy-parity.mjs
python3 skills/channel-taxonomy/scripts/run-model-evals.py --self-test
```

These cover the core 156 fixtures and 142 matrix checks, both GA4 UDF copies (312 fixture checks), generator isolation and drift across all six artifacts, collector classifier parity, and model parser/scorer behavior. They do not execute database or live-model requests.

To update shared artifacts, run the generator with `--repository` and omit `--check`. In a standalone channel-taxonomy installation, omit `--repository`; the generator then updates or checks only that skill's own reference SQL.

Run the standalone collector roundtrip and repository migration check as separate disposable PostgreSQL runs:

```bash
env -u DATABASE_URL PGPORT_TEST=55439 COLLECTOR_PORT=8799 \
  bash scripts/run-tests.sh --postgres
```

The repository wrapper first runs `roundtrip.sh`, then `roundtrip.sh --migration`. Each run starts and cleans up its own database and collector, without reusing an inherited database connection. PostgreSQL server/client binaries and Node/npm are required; the test may install `pg` into temporary storage. Only the explicit `--migration` run needs repository history containing legacy schema commit `2c240a3`.

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

Actual model evaluation requires the configured Claude CLI credentials and local Ollama model described in the [evaluation instructions](skills/channel-taxonomy/references/eval.md). It performs live calls and records responses and scores; it is separate from `--self-test`:

```bash
python3 skills/channel-taxonomy/scripts/run-model-evals.py --run
```

Inspect the recorded scores and failures before drawing conclusions about model quality. Test flags select independent suites: combine `--offline --postgres` explicitly to run both, or use the default with no flags for local deterministic checks only.

## License

MIT

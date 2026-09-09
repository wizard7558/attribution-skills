# Implementation guide

This package is a contract and evaluation wrapper around the three native BigQuery scripts. Read
the corresponding contract before replacing an input block:

Evaluation returns compact reviewed projections: selected stage ledger truth fields; cost report
rows plus undated count; and refresh mode, reasons, watermark, target partitions, and selected
replacement ledger fields. The native SQL evidence remains the authoritative complete output;
offline checks do not execute SQL and intentionally do not replace that evidence.

```sh
node skills/funnel-truth-and-cost-per-stage/scripts/build-eval-cases.mjs --check
node skills/funnel-truth-and-cost-per-stage/scripts/test-eval-cases.mjs
python3 scripts/run-skill-evals.py --skill skills/funnel-truth-and-cost-per-stage --self-test
```

For a fixture-only review, use the checked-in JSON cases and the test script. It validates authored
expected values, manifest freshness, neutral labels, exact cardinality/order, and mutation
sensitivity. It does not run SQL, contact BigQuery, or advance a checkpoint.

For native SQL, use the repository runners. They replace only the marked typed `REPLACEABLE INPUTS`
block, submit Standard SQL jobs, and apply `--maximum_bytes_billed=1073741824` per job. They use
temporary synthetic inputs and do not require a dataset for those inputs. Do not edit repository
SQL or advance a checkpoint from a test run.

```sh
# Offline fixture definitions only; no BigQuery job is submitted.
node skills/funnel-truth-and-cost-per-stage/scripts/test-stage-truth.mjs
node skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs
node skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs

# Authenticated native jobs, with a 1 GiB per-job cap and evidence report in Downloads.
node skills/funnel-truth-and-cost-per-stage/scripts/test-stage-truth.mjs --live --project YOUR_BILLING_PROJECT
node skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs --live --project YOUR_BILLING_PROJECT
node skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs --live --project YOUR_BILLING_PROJECT

# Cost and refresh additionally support their real sibling integration paths.
node skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs --live --integration --project YOUR_BILLING_PROJECT
node skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs --live --integration --project YOUR_BILLING_PROJECT
```

The stage runner supports `--project`, `--location`, `--report`, and `--resume-report`; its
`--live` path has no `--integration` option. Cost and refresh support those common options,
`--resume-report`, and `--integration`; refresh also supports its overlap-delta evidence options.
The runners require `bq` authentication and the operator's billing project only for `--live`.
Integration uses the installed sibling resolver/stage outputs as documented by each runner and
must be reviewed as a real job run.

There is no `--dry_run` option in these three runners. A raw syntax-only BigQuery check, if desired,
uses `bq query --dry_run --use_legacy_sql=false --maximum_bytes_billed=1073741824 < scratch.sql`;
that validates a query estimate and does not produce native golden evidence. The runner's `--live`
path is the actual bounded execution path, not a placeholder.

When this skill is installed by itself, run from its installation directory so its relative
references resolve:

```sh
cd /path/to/funnel-truth-and-cost-per-stage
node scripts/test-stage-truth.mjs
node scripts/test-cost-per-stage.mjs
node scripts/test-refresh-partitions.mjs
bq query --use_legacy_sql=false --maximum_bytes_billed=1073741824 < references/sql/stage_truth.sql
bq query --use_legacy_sql=false --maximum_bytes_billed=1073741824 < references/sql/cost_per_stage.sql
bq query --use_legacy_sql=false --maximum_bytes_billed=1073741824 < references/sql/refresh_partitions.sql
```

The runner commands and native SQL paths above are relative to the installed skill root; the
repository-root commands earlier in this guide are equivalent when working in the full repository.

Use `--integration` only when the installed skill and dependencies are present: BigQuery
credentials/project, the repository's native SQL files, and fixture or source tables matching the
contract. Refresh integration additionally requires complete prior and current snapshots; cost
integration requires the CRM ledger, attribution, campaign catalog, exact bindings, spend, and
account currency inputs. Cost actuals require the repository's CRM attribution resolver; refresh
actual stage values require this installed funnel skill's stage truth output.

Use `--live` only with a separately configured BigQuery billing project and the runner's hard 1 GiB
query bytes cap. The repository has no credentials or customer identifiers. Record query job IDs
and billing evidence in the runner-generated Downloads report, outside this public package.

Before deployment, verify every target replacement contains the complete current population, both
date modes are covered, and the checkpoint update compares the prior watermark and configuration
atomically. Keep a dry-run result until those checks pass.

# Attribution quality implementation guide

The skill contains nine accepted native BigQuery checks and two extractors. Use the full contracts for typed inputs and return complete native findings unchanged. The separate model manifest scores only a compact projection; it does not execute or replace the checks.

## Select and run a check

Every check creates temporary objects and has a marked nonempty synthetic input block. Replace that block with explicit typed projections for one invocation, preserving source qualifications, report scope/timezone/window/date mode, completeness and evidence references. Do not automatically query customer data or widen a requested population. Source errors remain execution errors.

| Intent | Script | Contract |
| --- | --- | --- |
| Conserve supplied spend at one reporting stage | scripts/spend-conservation.sql | [reconciliation-contract.md](reconciliation-contract.md) |
| Preserve all stage counts across attribution buckets | scripts/funnel-additivity.sql | [reconciliation-contract.md](reconciliation-contract.md) |
| Guard an explicit unmapped-rate ceiling | scripts/unmapped-share.sql | [population-contract.md](population-contract.md) |
| Guard an explicit eligible match-rate floor | scripts/match-rate.sql | [population-contract.md](population-contract.md) |
| Check primary flags within qualified groups | scripts/primary-uniqueness.sql | [population-contract.md](population-contract.md) |
| Compare explicitly equivalent per-source counts | scripts/source-parity.sql | [population-contract.md](population-contract.md) |
| Inspect observed schema names under explicit policy | scripts/no-pii-columns.sql | [schema-contract.md](schema-contract.md) |
| Distinguish populated/all-null/missing/unobserved columns | scripts/empty-column-probe.sql | [empty-column-contract.md](empty-column-contract.md) |
| Compare declared ad/campaign spend coverage | scripts/deleted-ad-coverage.sql | [deleted-ad-coverage-contract.md](deleted-ad-coverage-contract.md) |

From the skill root, run any selected standalone example by substituting its SQL filename:

~~~sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query \
  --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 \
  < scripts/funnel-additivity.sql
~~~

The authenticated BigQuery CLI and permissions must cover the chosen billing project and explicitly selected data. Match the job location to the dataset. The 1 GiB cap is deliberate; larger scopes require a separately chosen budget and verified source scope, not automatic retries with a wider cap.

The result row includes invocation_key and result_json. Preserve the entire parsed finding: check_id, contract_version, configuration, status, reasons, evidence_refs, all details and diagnostics. Keep the raw query, inputs, job configuration, hashes, bytes and errors as evidence. A prose interpretation can accompany it but cannot replace unknowns, rewrite statuses or omit caveats.

## Feed actual upstream attribution and funnel evidence

Use actual `attributeLeads(leads, options)` output from the sibling CRM resolver where available. Keep each row's CRM source_system/source_scope/lead_key. Do not infer identity from a canonical channel label. Eligibility and included flags are explicit caller projections; document the chosen population and condition mapping before invoking generic rate SQL.

The accepted population integration uses all actual lead rows for unmapped eligibility, with condition quality_status equal to unmapped or unattributed. Ad-match eligibility is Paid Search, Paid Social or Paid Other, with condition ad_match_status equal to matched. These are explicitly documented mappings, not mandatory hidden defaults for arbitrary populations.

For primary groups in that integration, recover the selected supported paid click from actual raw_evidence.click_ids at HIGH confidence or first_touch_click_ids at LOW confidence. Call the actual exported cleanClick helper exactly once and form the opaque JSON tuple [match_key, cleaned_value], scoped by CRM system/scope. Other rows are declared singletons. Preserve actual is_attribution_primary flags. The check validates their uniqueness; it does not reselect a primary or perform a person join. Source-parity observed counts come from actual per-scope CRM rows, against independently declared reference populations and counts.

For spend conservation and funnel additivity, consume actual `cost_per_stage.sql` output arrays from the sibling funnel skill:

- `spend_evidence` supplies source_system/source_scope/spend_key, event_date, spend/currency/spend_status and included. Explicit membership authorizes the source population. Retain observed spend rather than the producer's completeness-driven final spend.
- `stage_evidence` supplies qualified lead/stage, report_date, included, achieved and is_attribution_primary. It reflects the accepted stage-truth ledger's preserved unknown, nonprimary and undated rows. Do not regenerate stage truth from status labels or order.
- `report` supplies the complete reporting grain and observed spend/count columns required by the selected check. Select one configured stage before sums; spend repeats across stages. Include every bucket and keep duplicate report grains visible.

Cast serialized native count/money strings into the required INT64/NUMERIC input columns without floating-point coercion. Exact source repeats collapse under each contract; conflicting duplicates fail. Unknown or mixed monetary amounts remain NULL. No join across bare ad, campaign, lead or person IDs is authorized by this packaging.

The accepted reconciliation integration runs the actual current cost query and verifies its full producer golden before projecting its output arrays into both consumers, including deliberate corrupted reports. The population integration calls the actual CRM exports before native checks. These optional tests require repository siblings; the individual SQLs and ordinary fixtures are standalone.

## Inspect schema and column population

`scripts/inspect-schema.sql` takes explicit project, dataset, source_system, source_scope and table_keys parameters. It reads TABLES, COLUMNS and COLUMN_FIELD_PATHS for named targets. Append invocation_key to its actual membership and columns arrays and supply a caller-authored policy to no-pii-columns.sql. Keep nested paths, missing-table inventory, metadata failures and schema completeness visible. Policy matching is schema-name evidence, not a value scan or legal PII certificate.

`scripts/inspect-column-population.sql` takes explicit project, dataset, table_name, column_names, source_system/source_scope, population_mode, report_timezone, start_date/end_date and date_column. It validates metadata before referring to source fields and counts supported top-level scalar targets in one aggregate scan. Actual membership/observations map to empty-column-probe.sql after attaching invocation_key and casting count strings to INT64.

Use report_window for an exact inclusive date projection. DATE columns compare directly, TIMESTAMP dates use the declared timezone, and DATETIME uses its local calendar date. `full_table_snapshot` requires typed NULL bounds/date_column; it proves only full table population. BigQuery CLI typed NULL parameters use the literal NULL value, such as `--parameter='start_date:DATE:NULL'`, not an empty DATE string. The [extractor contract](empty-column-contract.md) has complete runnable parameter examples.

Retain extractor diagnostics, especially unsupported_type: a complex column remains present but unscanned, not absent. SQL NULL is the tested condition; zero, false, blank text and non-SQL-null JSON values can establish observed population. Permissions/location/query errors remain failed executions, not empty observations. Neither extractor determines why a connector omitted a field.

The deleted-ad coverage check uses caller-supplied qualified comparison pairs and source-native spend facts, not a provider API. Comparability evidence must attest metric/account/key/filter semantics. History, completeness, deletion scope and timezone are explicit. A spend gap triggers investigation; it never proves deletion or receives a vendor/backfill exemption. See the primary-source discussion in its contract.

## Verification modes and accepted boundaries

From this skill root, definition-only commands are:

~~~sh
node scripts/test-reconciliation.mjs
node scripts/test-population-checks.mjs
node scripts/test-schema-checks.mjs
node scripts/test-empty-columns.mjs
node scripts/test-deleted-ad-coverage.mjs
~~~

They explicitly print NO SQL EXECUTED. Each runner's live mode uses `--live --project YOUR_BILLING_PROJECT --location US --integration`. Live modes are opt-in; do not run them just to summarize already accepted evidence. They use cache-off Standard SQL with 1 GiB per-job caps and at most three independent structural-failure jobs concurrently. Native routines were tested with Node v20.18.1 and BigQuery CLI 2.1.19; these are tested versions, not an exhaustive support matrix.

Schema and column-population integrations create only new UUID-owned disposable datasets with labels and one-hour table TTL. They verify ownership before deletion and verify absence afterward. The other native examples use temporary objects only. Do not turn a test-dataset permission failure into an empty successful scan.

Accepted native evidence covers full literal findings, structural failures, semantic mutations, actual producer-to-consumer projections, and owned cleanup where relevant. It establishes synthetic contract correctness, not production completeness, provider behavior, causality or scale performance. The detailed contracts record sanitized native status; private Downloads reports retain actual jobs, hashes, outputs, caps, errors and cleanup proofs. This packaging step leaves those sources unchanged and does not rerun native SQL.

## Compact model-evaluation manifest

~~~sh
node scripts/build-eval-cases.mjs --check
node scripts/test-eval-manifest.mjs
~~~

The builder selects accepted literal fixture inputs, neutralizes only invocation tags, and projects literal expected scalar paths. `node scripts/build-eval-cases.mjs` deliberately regenerates the manifest; `--check` verifies byte reproducibility without writing it. Test/evaluation tooling requires Node, Python 3, the frozen repository shared harness (or explicit QUALITY_EVAL_HARNESS path), and tiktoken for the buffered token estimate. These are development checks; production SQL has no Python or tokenizer dependency.

The tests execute the actual frozen scorer locally, verify input neutrality and literal projection provenance, enforce cardinalities/types, and reject targeted output mutations. They make zero SQL or model calls. Both model conditions receive the same neutral prompt/input/type schema; only the with-skill condition receives the four frozen context documents. Expected answers, fixture mappings, scores and native reports remain outside both model contexts. Contexts are complete, not truncated to fit a budget.

[eval.md](eval.md) records the pre-live boundary. Real-use output remains the full native finding; compact evaluation projection is a separate scoring artifact, never a replacement reporting interface.

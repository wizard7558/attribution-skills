# Fixed BigQuery audit execution

Version 0.1.0. The host now dispatches seventeen fixed non-GA4 SQL entries with `operation:'executeSql'`. This step is verified with mocked transport only: **MOCKED, NO SQL EXECUTED**. Prior native transport proofs establish named-parameter handling and paging; they do not establish execution of these rendered templates through this host.

## Exact routes and options

| Skill | Registry entrypoints |
| --- | --- |
| crm-paid-attribution | attribute_leads_sql |
| funnel-truth-and-cost-per-stage | stage_truth, cost_per_stage, refresh_partitions |
| multi-touch-models-sql | credit_ledger, attribution_metrics |
| attribution-data-quality-tripwires | spend_conservation, funnel_additivity, unmapped_share, match_rate, primary_uniqueness, source_parity, no_pii_columns, empty_column_probe, deleted_ad_coverage, inspect_schema, inspect_column_population |

The two GA4 SQL entries and pixel PostgreSQL identity_snapshot/native_views still require operation `unavailable` and report `adapter_not_implemented`. No arbitrary SQL, schema, identifiers or template path can be passed to the host. SQL invocation input is exactly the accepted [renderer semantic input](sql-rendering-contract.md), with every required field and explicit nulls. Configuration, classifications, identity mappings, money, counts and flags are not inferred or recalculated.

```js
const result = await executeAudit(freshInput, {
  skillRoots: explicitInstalledRoots,
  // pythonExecutable: '/absolute/interpreter',
  bigquery: {
    configuration: {
      billingProject: 'your-billing-project',
      location: 'US',
      maximumBytesBilled: '1073741824'
    },
    reportDirectory: '/absolute/private/audit-reports',
    resumeReports: {} // or {sqlStepId: '/absolute/prior-transport-report.json'}
  }
});
```

All BigQuery fields shown are explicit: its three configuration fields, reportDirectory and resumeReports have no defaults. Project/location/cap validation matches the transport; the positive INT64 byte cap must be a decimal string. Report directory and resume paths must be absolute. Resume keys must identify existing selected SQL steps. Invalid options reject before awaits/credentials. Input and options are captured synchronously; later caller mutation does not alter work. No BigQuery option means `bigquery_not_configured`, before rendering or credentials. Existing skillRoots/pythonExecutable-only callers remain supported.

## Sources, preflight and durable reports

Each of these seventeen registry entries now includes its unchanged upstream SQL and the actual installed `ga4-bigquery-export/scripts/run-export-checks.mjs` in source_refs. Expected hashes cover both. The existing explicit-root snapshot machinery distinguishes missing/unavailable, unreadable/failed and mismatched/failed sources before invocation. The audit-owned renderer, fixed schema catalog and transport are copied from this audit installation into the same run's private read-only source snapshot. Their exact hashes are recorded separately as host_helper_hashes; audit is not invented as an upstream skill. No test runner imports or sibling discovery occur.

After dependencies succeed, explicit JSON-pointer bindings copy whole selected values from actual producer outputs or caller evidence into existing null placeholders. The frozen composer preflights actual bound scopes, bridges and native report configuration. The fixed renderer then validates/types/projects columns while retaining every row and its complete input in provenance. Structural projection errors raise AuditPreflightError before credentials, preserving earlier producer evidence. Native source/helper failures gate downstream calls.

Extractor source_system/source_scope remain explicit inventoried labels. For inspect_column_population, report_timezone must equal the declared audit timezone. report_window start_date/end_date must exactly equal the audit dates. full_table_snapshot requires null start_date/end_date/date_column and records `full_table_snapshot_not_report_window`; whole-table evidence does not become window evidence. inspect_schema records `schema_metadata_not_population_evidence`. No physical-source identity bridge is inferred from labels or project/dataset names.

Each configured run creates a unique owned evidence directory under reportDirectory. Generated ordinal step filenames contain no untrusted step text. Before POST, mode-0600 files preserve the full captured run request, resolved native input, rendered SQL/parameters, source/helper hashes, current provenance and earlier calls. The actual transport creates its own exclusive mode-0600 report with the client handle before submission. Reports are private and may contain queries, outputs and local paths; they remain after source-snapshot cleanup.

The transport receives only fixed rendered query bytes and exact named parameter data. It uses the installed shared helper's executeJob and complete decoder. CRM returns native typed rows; the other entries require exactly one parsed result_json object. All raw pages, native JSON, nulls, booleans, money strings, arrays and buckets survive unchanged. A native quality fail/unknown finding is succeeded execution and remains a fail/unknown finding in composition. Native SQL errors or transport failures have no synthesized native output.

## Resume, counters and failures

Every resume creates a new report and invokes the transport with the recorded prior path. Its query/parameters/config/result-kind/implementation hashes must be identical. The same recorded handle is fetched read-only; failed, missing, uncertain or mismatched work is never resubmitted. No migration exception is added to ordinary host resume.

Each SQL call records adapter_kind bigquery, function_entered null, submission_attempted, server_job_observed, read_only_retrieval and confirmed_fresh_queries. A JS function entry or a read-only retrieval is not a new SQL query. `fresh_upstream_calls` sums actual JS entries, Python process starts and confirmed fresh SQL handles. `confirmed_fresh_bigquery_queries` is reported separately. Mocked tests label these simulated observations explicitly and report zero native queries.

An uncertain submission is not proof of zero effects. `bigquery_effect_accounting_complete` is false when a submission may have occurred without a confirmed observed handle. If the transport throws after submission, the host attempts to recover its exclusively retained report, checking input/query/source/handle identities before adopting its counters. If recovery fails, submission/observation/confirmed-count fields are null, effect_accounting_status is `unknown_after_transport_throw`, and retained request/report paths remain available. Aggregate confirmed counts are lower bounds while accounting is incomplete. A recovered observed handle is preserved with `verified_retained_report_after_throw`; the call still fails and no output is promoted.

Unavailable CLI/version checks report bigquery_runtime_unavailable; native SQL errors report bigquery_query_failed; ordinary retrieval failures report bigquery_execution_or_retrieval_failed; a thrown transport reports bigquery_transport_failed. Failed producers block dependents even if optional globally. Required/optional aggregate execution and quality status rules remain those of the frozen composer.

## Verification and installation

Use Node 22.22.1 as tested. The renderer uses JSON import attributes; its supported syntax minimum and separate rendering-only proof remain documented in its frozen contract. Python regression uses the already installed Python 3.14.2/NumPy 2.4.4 environment; production BigQuery transport requires bq/gcloud runtimes and credentials, but this verification does not obtain credentials.

```sh
node scripts/test-execute-audit-bigquery.mjs
node scripts/test-compose-audit.mjs
node scripts/test-execute-audit.mjs
node scripts/test-execute-audit-python.mjs
```

The BigQuery suite calls actual host, renderer, transport, shared pagination decoder and composer. Its explicitly testable third host argument is `{bigqueryTransport:{runCommand,fetchImpl}}`; injected functions are test dependencies, never semantic invocation input. Mocked HTTP responses replay independently frozen literal upstream outputs. This verifies dispatch, preservation, scopes, provenance and failure handling—not SQL computations. The standalone installation test copies audit helper files and supplies independently copied upstream roots.

Full outputs cover every fixed entry, native quality unknown/fail, all five cost buckets and the full-table nullable extractor shape. Additional tests cover two-page retrieval, exact parameter forwarding, absent/mismatched helper, missing config/runtime, bad projections, changed boundaries after an actual JS producer, exact producer-output binding, caller mutation isolation, strict same-handle resume and a real filesystem write failure after a mocked observed POST. Original JS/Python/composer suites preserve upstream native input/output goldens; only new helper hash expectations and the explicitly obsolete missing-SQL-adapter capability assertion change.

This step performs no native queries, model calls, provisioning, customer reads, PostgreSQL work or provider delivery. Native execution of all seventeen rendered templates and host integration evidence remain the next reviewed step.

Current verification on Node 22.22.1: 20 full mocked output fixtures spanning all seventeen entries, 22 additional checks, 10 rejections and one executed bucket-dropping mutation; 43 returned runs retained. Unchanged native local regressions pass: composer 10 full reports/44 structural errors/3 integrity checks/7 mutations/6 special checks; JavaScript 23 full outputs/26 structural errors/9 special checks/5 mutations; Python 4 full runs/8 outputs/12 checks/4 rejections/2 mutations. All native SQL query and credential counts in this host verification are zero. Failed intermediate test reports remain private evidence rather than being relabelled as passed.

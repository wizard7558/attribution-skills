# Schema-name policy backstop

This check compares observed top-level and nested field names against an explicit caller-supplied policy. A pass means that the complete, present, nonempty declared schema has no observed policy matches. It does not scan row values, certify that data contains no PII, determine legal classifications, or infer connector behavior.

## Checker inputs

Run scripts/no-pii-columns.sql as BigQuery Standard SQL. Its marked BEGIN REPLACEABLE INPUTS block contains typed nonempty synthetic examples; replace that block with your metadata projection and explicit policy. All objects created by the checker are temporary.

Production requires exactly one configuration_input row with invocation_key, report_scope, named IANA report_timezone, inclusive DATE report_start/report_end, date_mode (cohort|activity), source_evidence_ref and report_evidence_ref. The scope/window describes the report being guarded; the metadata itself is an observed schema snapshot, not historical schema reconstruction.

Every table below includes invocation_key. Every raw field validates, even on nonmember rows. Exact keys are nonempty, trim-equal and C0/C1-free; their case and plus signs are preserved. Data types are required nonempty exact strings. Typed columns are checked even for empty tables. Structural conflicts and malformed inputs cause fixed-message assertions rather than findings.

membership_input declares source_system, source_scope, table_key, required BOOL schema_complete and nullable BOOL table_exists. Membership must be nonempty. Exact duplicate declarations collapse; conflicting metadata for the same qualified table fails structurally.

column_input contains source_system, source_scope, table_key, field_path and data_type. Exact duplicates collapse; different types for the same qualified table/path assert. Selected observed columns require table_exists=true. Columns outside membership validate and are diagnosed but never selected or used to infer membership. There are no bare table-name or path joins across sources.

policy_input is a required nonempty global rule set for the invocation. Rules contain exact rule_key, match_kind and pattern. There is no hidden allowlist, default policy, override, exception or automatic rule inference. Exact duplicate rules collapse; conflicting definitions for one rule key assert.

- exact_leaf compares LOWER(final dot-separated field-path segment) with LOWER(pattern), as literal text. For example, email matches contact.Email but not email_hash. Regex metacharacters are literal in this rule type.
- path_regex applies native RE2 matching to LOWER(field_path). The regex pattern is **not automatically lowercased**. Authors control anchoring and regex syntax; invalid expressions assert. For example, ^contact\.email$ matches CONTACT.Email but not other.email.

The policy author is responsible for selecting useful rules. Matching a name proves a configured policy hit, not that the underlying value is personal data. A safe-looking name does not establish safe content.

## Findings and ordering

Each result row contains invocation_key and result_json. The parsed finding has exactly:

~~~text
check_id: no_pii_columns
contract_version: "0.1.0"
configuration: complete explicit configuration
status: pass | fail | unknown
reasons: sorted distinct reason codes
evidence_refs: [source_evidence_ref, report_evidence_ref]
details: all declared qualified tables
diagnostics: named decimal-string counts
~~~

Each detail contains source_system, source_scope, table_key, schema_complete, table_exists, observed_column_count, matching_paths, status and reasons. matching_paths contains distinct field_path entries, each with sorted matched_rule_ids. Details sort by source system, source scope and table key; paths sort exactly by their original text.

A table fails whenever any observed field path matches policy, even when schema evidence is incomplete. Otherwise it is unknown if table_exists is false/null, schema_complete=false, or no columns were observed. Only a present, complete, nonempty schema with no matches passes. Overall precedence is fail, then unknown, then pass.

| Reason | Meaning |
| --- | --- |
| forbidden_column_name | An observed path matched at least one explicit rule. |
| table_absent | Inventory reports table_exists=false. |
| table_existence_unknown | Inventory reports table_exists=null. |
| schema_incomplete | Inventory does not declare complete schema evidence. |
| no_observed_columns | No selected column metadata was supplied for that table. |

Unknown evidence reasons remain visible alongside a proven failure. Passing findings have empty reasons. Empty matching arrays are [], not null. All counts are decimal strings; completeness and existence remain Boolean/null.

Diagnostics are declared_tables, raw_columns, duplicate_columns_collapsed, selected_columns, nonmember_columns, policy_rules and matching_paths. Matching paths count distinct qualified paths, not individual rule hits.

An existing table with zero data rows can pass when its nonempty schema is completely observed and safe under the policy. A metadata snapshot with zero observed columns stays unknown. Neither result makes a claim about missing values or known zero measures.

## Actual metadata extraction

scripts/inspect-schema.sql is a read-only metadata query with five required named parameters:

- project: STRING project ID matching the supported subset [a-z][a-z0-9-]{4,61}[a-z0-9].
- dataset: STRING of 1–1024 characters matching [A-Za-z_][A-Za-z0-9_]* (length validated separately).
- source_system and source_scope: exact nonempty source identity strings.
- table_keys: nonempty ARRAY<STRING> of table names matching the dataset identifier subset.

These are deliberate supported subsets, not a claim to support every BigQuery identifier syntax. Identifiers are validated before interpolation into quoted metadata paths. Table selection remains parameter-bound. Repeated requested names collapse.

The query explicitly selects table inventory from INFORMATION_SCHEMA.TABLES and combines field paths from COLUMNS and COLUMN_FIELD_PATHS with exact deduplication. It queries only the named targets' metadata and does not select source row values. Google documents table/view inventory in [TABLES](https://cloud.google.com/bigquery/docs/information-schema-tables), field metadata in [COLUMNS](https://cloud.google.com/bigquery/docs/information-schema-columns), and top-level/nested paths in [COLUMN_FIELD_PATHS](https://cloud.google.com/bigquery/docs/information-schema-column-field-paths).

The result_json snapshot contains source_system, source_scope, project, dataset, sorted table_keys, membership, and columns. Each membership element has exactly the checker membership fields without invocation_key; columns likewise match the checker projection. Append your invocation_key, provide configuration/policy, and feed these actual arrays into the checker.

A named table absent from the returned inventory receives table_exists=false. schema_complete=true is emitted only after all metadata statements succeed. Permissions, wrong location, missing dataset and query errors remain failed executions: do not substitute an empty snapshot or claim a pass. Treat inaccessible evidence as unknown in the surrounding workflow. Inventory absence means not observed in that explicitly queried metadata scope.

Choose the query location to match the dataset. From the skill root, using your explicit identifiers:

~~~sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query \
  --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 \
  --parameter='project:STRING:your-project-id' \
  --parameter='dataset:STRING:analytics_dataset' \
  --parameter='source_system:STRING:crm_export' \
  --parameter='source_scope:STRING:account_a' \
  --parameter='table_keys:ARRAY<STRING>:["lead_stage","campaign_summary"]' \
  < scripts/inspect-schema.sql
~~~

The snapshot does not contain a row-value sample, content classification or a connector diagnosis. Preserve the extraction job and schema evidence reference.

## Verification and ownership

~~~sh
node scripts/test-schema-checks.mjs
node scripts/test-schema-checks.mjs --live --project YOUR_BILLING_PROJECT --location US --integration
~~~

Offline validates definitions and prints **NO SQL EXECUTED**. Live runs the checker standalone, full literal golden batches, expected structural/configuration errors, an actual mutation that drops nested paths, and extractor identifier-validation errors. It uses native SQL, no JavaScript check engine or generated expected outputs.

Optional integration creates only a new UUID-named attribution_skill_schema_ dataset with a unique owner label and one-hour default table expiration. It creates a synthetic clean table, a nested forbidden-name table, and an empty-data table with a safe declared schema; a fourth named table is deliberately missing. The actual extractor snapshot and the checker finding must match independently authored complete goldens. All source data are synthetic; the extractor never reads those values.

Cleanup runs even if verification fails. The runner verifies the exact project/dataset identity and owner label before deleting that owned dataset recursively, then checks that it is absent. It never deletes an existing unrelated dataset. If dataset creation is denied, the earlier native fixture checks remain recorded and integration is explicitly incomplete. Inspect private cleanup evidence after an interrupted process; table expiration is a fallback, not a replacement for verified cleanup.

Each query has a 1 GiB billing cap, disabled cache and Standard SQL. At most three structural checks run concurrently. Timestamped Downloads evidence preserves source/fixture/runner/query hashes, query parameters, full results/errors, job state/bytes/versions, dataset ownership and cleanup proof. --resume-report PATH retrieves byte-identical completed queries read-only and rechecks expectations; query parameters must also match. Existing evidence is never overwritten. A new metadata integration uses its own newly owned dataset.

A copy of this guide is saved as attribution-schema-policy-guide.md in Downloads after successful verification.

<!-- execution-status:start -->
Authenticated native BigQuery execution passed on 2026-09-09: 15 full literal findings, 13 structural cases, two configuration failures, three extractor parameter failures, one standalone example and one rejected nested-path mutation. A newly owned disposable dataset supplied actual TABLES/COLUMNS/COLUMN_FIELD_PATHS metadata; its full snapshot and policy finding matched independent goldens, and ownership-checked cleanup verified the dataset absent. All query jobs confirmed Standard SQL, disabled cache and a 1 GiB cap. Full private hashes, results, metadata and cleanup proof remain in Downloads. This proves synthetic schema-name behavior only.
<!-- execution-status:end -->

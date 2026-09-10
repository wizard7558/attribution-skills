# Explicit column population evidence

`empty-column-probe.sql` checks whether declared destination columns contain any SQL non-NULL values in an explicitly observed population. It does not infer source population, connector behavior, value validity, or report-window population from a whole-table scan. Numeric zero, Boolean false, blank strings, and JSON values that are not SQL NULL count as populated.

## Typed checker interface

Replace the marked input block in `scripts/empty-column-probe.sql`. The standalone example has nonempty synthetic inputs and creates temporary objects only. Production requires exactly one `configuration_input` row:

- Exact nonempty `invocation_key`, `report_scope`, `source_evidence_ref`, `report_evidence_ref` STRINGs.
- Named IANA `report_timezone`, inclusive DATE `report_start` and `report_end`, `date_mode` equal to `cohort` or `activity`.
- Explicit `population_mode`: `report_window` or `full_table_snapshot`.

The report metadata remains required in either mode. In `full_table_snapshot` mode it identifies the guarded report, but the observed population is the entire table snapshot, not that report window. The configuration does not reconstruct historical data.

Both other input tables include `invocation_key` and exact qualified STRING keys `source_system`, `source_scope`, `table_key`, `column_key`. Keys preserve case and plus signs, must be nonempty and trim-equal, and cannot contain C0/C1 controls. No bare column/table joins or inferred source membership occur.

`membership_input` is nonempty and declares BOOL `schema_complete`, nullable BOOL `table_exists`, nullable BOOL `column_exists`, and BOOL `scan_complete`. A present column requires a present table. Absent or unknown tables/columns cannot declare a complete scan.

`observation_input` contains nullable INT64 `row_count` and `non_null_count`, STRING `population_mode`, and nullable DATE `observed_start` and `observed_end`. Both counts must be known or both NULL, with 0 <= non_null_count <= row_count. A report-window observation must use the configured dates exactly; whole-table observations must have NULL bounds. All observations must use the configured mode. Complete scans require known counts; known counts require present tables and columns. Missing observations remain unknown.

Every raw row validates, including observations outside membership. Identical qualified duplicates collapse; conflicting duplicate inventory or observations assert. Nonmembers are counted and excluded. Input column types are checked even when input tables are empty. Malformed types, dates, identities, modes, bounds, cardinality and contradictions fail execution through fixed-message assertions; errors never interpolate row values. BigQuery itself may report SQL/type errors before assertions.

## Decision and exact finding schema

Each result row contains `invocation_key` and `result_json`. Parsed JSON fields are `check_id: "empty_column_probe"`, `contract_version: "0.1.0"`, the complete `configuration`, `status`, sorted distinct `reasons`, `evidence_refs: [source_evidence_ref, report_evidence_ref]`, `details`, and `diagnostics`.

For each declared column:

1. Known non_null_count > 0 proves `pass`, even under a partial scan or incomplete schema.
2. Known row_count > 0, non_null_count = 0, and scan_complete = true prove `fail` with `column_all_null`, including when schema completeness remains uncertain.
3. All other cases are `unknown`. In particular, zero rows do not prove an all-null column, and a partial scan with zero observed values cannot prove full-population emptiness.

Overall precedence is fail > unknown > pass. Reasons describe all observed limitations even alongside a proven pass/fail; a passing finding can therefore retain `scan_incomplete` or `schema_incomplete`. There is no hidden threshold or connector exception.

| Exact reason | Meaning |
| --- | --- |
| column_all_null | A complete nonempty observed population has no SQL non-NULL target values. |
| table_absent | Explicit table_exists=false. |
| table_existence_unknown | table_exists=NULL. |
| column_absent | Explicit column_exists=false. |
| column_existence_unknown | column_exists=NULL. |
| schema_incomplete | schema_complete=false. |
| scan_incomplete | scan_complete=false. |
| no_observed_rows | Known observed row_count=0. |
| no_population_observation | No known count pair was supplied, including a missing observation row. |

Details contain all qualified keys, all four inventory flags, decimal-string/null `row_count` and `non_null_count`, `observed_start`, `observed_end`, `status`, and sorted `reasons`. They sort by source system, source scope, table key, column key. Empty arrays are [] and dates are ISO strings/null. Counts are never JSON floating-point values.

Diagnostics are decimal strings: `declared_columns`, `populated_columns`, `all_null_columns`, `unknown_columns`, `raw_observations`, `duplicate_observations_collapsed`, `nonmember_observations`. These count declared targets and observations, not source population summed across columns.

## Actual metadata and population extractor

`scripts/inspect-column-population.sql` takes all named parameters explicitly:

| Parameter | Type and meaning |
| --- | --- |
| project, dataset, table_name | STRING physical query target. |
| column_names | Nonempty ARRAY<STRING> of top-level column names. |
| source_system, source_scope | STRING qualified source identity. |
| population_mode | STRING report_window or full_table_snapshot. |
| report_timezone | Named IANA STRING, required in either mode. |
| start_date, end_date | Inclusive DATE bounds for report_window; NULL for full_table_snapshot. |
| date_column | Top-level STRING column for report_window; NULL for full_table_snapshot. |

Supported project IDs match `[a-z][a-z0-9-]{4,61}[a-z0-9]`. Dataset/table/column identifiers use `[A-Za-z_][A-Za-z0-9_]*` with length <= 1024; this is a deliberate safe subset, not every BigQuery identifier syntax. Repeated requested names collapse. Metadata lookup and qualified keys are exact; names are not lowercased or decoded.

The extractor reads `INFORMATION_SCHEMA.TABLES` and `COLUMNS` before constructing source-column expressions. Missing tables or target columns receive null counts and scan_complete=false without referencing absent fields in the source SELECT. A present table in report-window mode requires an existing DATE, TIMESTAMP, or DATETIME date column; missing/unsupported date columns fail execution. DATE columns compare directly; TIMESTAMP dates use the declared timezone; DATETIME values use their local calendar DATE without timezone reinterpretation. NULL date values do not enter the dated population.

Supported scalar targets are BOOL, INT64, FLOAT64, NUMERIC, BIGNUMERIC, STRING, BYTES, DATE, DATETIME, TIME, TIMESTAMP, GEOGRAPHY and JSON. Other types remain column_exists=true, scan_complete=false, with null counts and extractor diagnostics `{column_key, reason: "unsupported_type", data_type}`. Retain these diagnostics with the finding and evidence; absence and unsupported types are different conditions.

Existing supported targets are counted together in **one aggregate source scan** using COUNT(*) and COUNTIF(column IS NOT NULL). No samples or raw cell values are returned. Full-table mode is an explicitly unrestricted population scan subject to the chosen bytes cap; it cannot establish report-window population. The extractor does not claim snapshot isolation across concurrent schema changes: metadata/scan races remain execution failures.

The returned snapshot contains source_system, source_scope, project, dataset, table_key, population_mode, report_timezone, observed_start/end, membership, observations, and diagnostics. Membership and observations map directly to checker inputs after attaching invocation_key; counts serialized as decimal strings must be cast to INT64 by the typed input projection. schema_complete=true follows successful metadata queries; scan_complete=true follows a successful aggregate. Permission, location and query errors remain failed executions, never substituted empty tables or passes.

From the skill root:

~~~sh
bq --project_id=YOUR_BILLING_PROJECT --location=US --format=json query \
  --use_legacy_sql=false --use_cache=false --maximum_bytes_billed=1073741824 \
  --parameter='project:STRING:your-project-id' \
  --parameter='dataset:STRING:analytics_dataset' \
  --parameter='table_name:STRING:lead_snapshot' \
  --parameter='column_names:ARRAY<STRING>:["campaign_key","is_converted"]' \
  --parameter='source_system:STRING:crm_export' --parameter='source_scope:STRING:account_a' \
  --parameter='population_mode:STRING:report_window' \
  --parameter='report_timezone:STRING:America/Los_Angeles' \
  --parameter='start_date:DATE:2026-01-01' --parameter='end_date:DATE:2026-01-31' \
  --parameter='date_column:STRING:created_at' < scripts/inspect-column-population.sql
~~~

For an explicitly intended whole-table scan, set population_mode to full_table_snapshot and use typed NULL parameters `start_date:DATE:NULL`, `end_date:DATE:NULL`, `date_column:STRING:NULL`. Retain the job, bytes billed, extraction scope, snapshot and both evidence references. Do not silently widen an unavailable report-window scan to the whole table.

## Connector investigation

Destination absence alone does not establish that a source field is empty. Fivetran documents connector-specific support for creating empty tables and columns, including supported file connector/destination combinations. Consult the current [empty-table/column feature documentation](https://fivetran.com/docs/core-concepts/features#syncing-empty-tables-and-columns) and [Files documentation](https://fivetran.com/docs/connectors/files); do not apply a universal omission rule.

For a missing field, verify sync selection, connector schema/ERD and supported custom fields, whether the field is mapped to another table, source permissions, and actual source population. These are distinct possible explanations in Fivetran's [missing-table/column troubleshooting guide](https://fivetran.com/docs/connectors/troubleshooting/field-table-missing). The probe supplies destination evidence; it does not choose a connector diagnosis or initiate a resync. Sources read 2026-09-09.

## Verification

~~~sh
node scripts/test-empty-columns.mjs
node scripts/test-empty-columns.mjs --live --project YOUR_BILLING_PROJECT --location US --integration
~~~

Offline validates fixture definitions and explicitly prints NO SQL EXECUTED. Live executes the standalone checker, full literal finding goldens, structural assertion failures, and two semantic mutations (counting NULL as zero and declaring an absent column all-null). Expected findings are stored literal data, not generated by a JavaScript checker. Actual integration creates only an owned UUID dataset with owner label and one-hour table TTL, scans synthetic scalar/complex/missing targets under DATE/TIMESTAMP/DATETIME/full-table modes, and compares full extracted snapshots and downstream findings. It includes zero, false, blank text, SQL NULL and non-SQL-null JSON, as well as an empty table and missing table.

Each job uses Standard SQL, no cache, and a 1 GiB maximum billed cap. At most three independent fixture-failure jobs run concurrently. Private Downloads evidence retains source/fixture/query hashes, full SQL/results, job configuration, version, errors, bytes, and ownership cleanup. `--resume-report PATH` only reuses byte-identical queries and parameters through read-only job retrieval, writes a separate report, and repeats golden checks. Failed evidence is preserved. Dataset cleanup checks the exact project, generated dataset name, and owner label, deletes only that dataset, and verifies absence. If creation or cleanup fails, integration remains incomplete and evidence records the gap.

Native execution verified 2026-09-09: 15 full literal finding goldens, standalone execution, 17 intended structural/configuration failures, two rejected semantic mutations, and six actual extractor-to-checker integrations passed. The final evidence contains 34 terminal verified jobs, including 27 read-only rechecks and seven fresh jobs after correcting CLI typed-NULL parameter syntax. The earlier failed parameter-setup job is preserved separately; no checker or extractor SQL changed for that correction. Both owned datasets were removed and verified absent. No customer tables or values were queried. This proves the synthetic contracts and integration, not connector behavior or production scan cost.

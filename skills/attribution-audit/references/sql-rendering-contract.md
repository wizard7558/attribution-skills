# Fixed audit SQL rendering

Version 0.1.0. `scripts/render-audit-sql.mjs` exports synchronous `renderAuditSql(entryKey,sourceSql,input)`. It renders data into the reviewed templates without file, credential, network, subprocess or job calls. The module imports only its local data-only schema catalog and Node built-ins. It does not run native SQL, compute attribution or make comparisons. The audit execution host is not changed by this step.

## Exact return

Return `{query,queryParameters,parameterMode,resultKind,renderingMetadata}`. `query` is the complete statement. `queryParameters` is an empty array and `parameterMode` null for temporary-input templates; the two extractors use typed NAMED records. `resultKind` is `rows` for CRM and `single_result_json` for all other entries. These labels describe the later decoder, not a result produced by rendering.

`renderingMetadata` retains contract version, exact entry key, source/query SHA256, the complete captured input, namespace copy records, ordered table/column projection records, parameter names and explicit limits. A table projection records its native table name, supplied row count and declared column names. Row counts are transport evidence; no native metric is computed. Extra producer fields survive in captured input while only declared fields are projected into SQL. No source row is filtered, deduplicated, matched or rewritten.

## Fixed allowlist and schemas

[sql-rendering-schemas.json](sql-rendering-schemas.json) is the fixed data-only catalog. It contains exact ordered native tables, input-key mappings, scalar/nested types, parameter schemas, pinned SQL hashes and authoritative schema derivation references. Arbitrary entrypoints, GA4 entries, table/column/type names, SQL fragments and unpinned source bytes reject with generic TypeError. Changing a native implementation requires a reviewed catalog/hash update; the renderer does not silently accept a changed template with an old schema. GA4 rendering remains a separate installed renderer and is intentionally outside this module.

| Entry key | Exact top-level semantic input keys |
| --- | --- |
| crm-paid-attribution/attribute_leads_sql | leads, options |
| funnel-truth-and-cost-per-stage/stage_truth | configuration, leads, stages, exclusions, opportunities, events |
| funnel-truth-and-cost-per-stage/cost_per_stage | configuration, stage_input, stage_ledger_input, crm_attribution_input, account_currency_input, campaign_input, binding_input, spend_input |
| funnel-truth-and-cost-per-stage/refresh_partitions | configuration, prior_ledger_input, current_ledger_input, change_input |
| multi-touch-models-sql/credit_ledger | configuration, touches, conversions |
| multi-touch-models-sql/attribution_metrics | configuration, conversion_scopes, spend_scopes, ledger, coverage, spend |
| attribution-data-quality-tripwires/spend_conservation | configuration, source, report, membership |
| attribution-data-quality-tripwires/funnel_additivity | configuration, source, report |
| attribution-data-quality-tripwires/unmapped_share | configuration, source, membership |
| attribution-data-quality-tripwires/match_rate | configuration, source, membership |
| attribution-data-quality-tripwires/primary_uniqueness | configuration, source, membership |
| attribution-data-quality-tripwires/source_parity | configuration, membership, reference, observed |
| attribution-data-quality-tripwires/no_pii_columns | configuration, membership, columns, policy |
| attribution-data-quality-tripwires/empty_column_probe | configuration, membership, observations |
| attribution-data-quality-tripwires/deleted_ad_coverage | configuration, membership, ads, reference |
| attribution-data-quality-tripwires/inspect_schema | project, dataset, source_system, source_scope, table_keys |
| attribution-data-quality-tripwires/inspect_column_population | project, dataset, table_name, column_names, source_system, source_scope, population_mode, report_timezone, start_date, end_date, date_column |

Every required projected field must be explicitly present, including nested STRUCT fields. Explicit null is data; it is never inserted for a missing field. Native SQL remains responsible for domain rules, allowed values, calendar/timezone validity, complete-feed assertions, monetary range and other semantic constraints. A renderable input may still fail a native ASSERT or CAST. A successful render is not a passed audit.

The one namespace rule is explicit: configuration.invocation_key is required for marked templates. The renderer copies that exact string into tables whose fixed schema declares invocation_key. Rows may omit this transport field or explicitly match it; a conflict rejects. This copy is recorded in renderingMetadata.namespace_copies. No other field gets a default. MTA metrics includes invocation_key only in its configuration table, exactly as its native contract declares.

CRM takes the existing full leads/options API data. Options must be a plain object and leads an array of plain objects; each entire object is JSON serialized into the native options_json/lead_json STRING columns, with input_position derived only from its array ordinal. Native resolver validation owns its flexible inner input fields. There is exactly one configuration row even for an empty lead array, so the native empty-population configuration check still executes.

## Literal and parameter rules

Input capture rejects nonfinite numbers, undefined, getters, proxies, cycles, sparse arrays and non-plain objects without calling getters or mutating/freezing the caller. Returned captured data is independent by value. Root input keys are exact; caller type overrides and arbitrary extra root keys reject. Extra fields inside producer rows/STRUCT objects are retained as evidence but cannot create SQL identifiers or columns.

STRING/DATE/TIMESTAMP/DATETIME/TIME and other textual literal types require strings or explicit null. Timestamp/date spellings are preserved verbatim inside typed CASTs; no Date parsing, timezone conversion or normalization occurs. BOOL requires Boolean or null, never the strings "false"/"true". INT64 accepts safe integer Numbers or signed digit strings. Unsafe Number integers reject; exact decimal strings never pass through Number. NUMERIC/BIGNUMERIC accept finite Numbers or signed decimal/exponent strings, preserving the supplied spelling. A monetary Number preserves only its existing JavaScript decimal spelling and precision; use decimal strings for exact money. FLOAT64 string inputs must have finite numeric value. The native engine checks representable SQL ranges.

Text literals escape quotes, backslashes and every C0/C1 control character; valid Unicode is preserved and unpaired surrogates reject. Dollar replacement tokens are ordinary data. Empty arrays use explicit ARRAY<T>[]; null complex values use CAST(NULL AS ARRAY/STRUCT type). Empty relations use a typed SELECT over UNNEST(ARRAY<INT64>[]), producing no invented row. Nested STRUCT and ARRAY<STRUCT> fields use the same strict rules.

For extractors, SQL remains byte-identical and parameterMode is `NAMED`. Every parameter is present in native declaration order:

- Scalar: `{name,parameterType:{type:'STRING'|'DATE'},parameterValue:{value:<string|null>}}`.
- String array: `{name,parameterType:{type:'ARRAY',arrayType:{type:'STRING'}},parameterValue:{arrayValues:[{value:<string|null>},...]}}`. Explicit null at the array field is represented by parameterValue `{value:null}`; native validation decides whether that null is permitted.

The population extractor's nullable start_date/end_date DATEs and date_column STRING stay explicit null for whole-table snapshots. Identifiers remain parameter data; native identifier validation precedes dynamic SQL. A later transport must forward every typed parameter and preserve its nulls. This module does not substitute identifiers into extractor SQL or validate an observation as complete.

## Frozen SQL boundaries

The fourteen funnel/MTA/quality-check templates replace exactly one `-- BEGIN REPLACEABLE INPUTS` / `-- END REPLACEABLE INPUTS` block using callback replacement. All bytes outside that block remain unchanged, including every production one-invocation/type/native ASSERT. No fixture-mode cardinality removal occurs.

CRM replaces only its two fixed input table definitions, from `CREATE TEMP TABLE crm_configuration AS` through the crm_lead_input definition before the first ASSERT. The pinned source hash fixes these boundaries. The embedded UDF, all native validation, global scoped duplicate-key assertion, ROW_NUMBER and final ordered SELECT remain unchanged. There is no generatedRuntime call or runtime dependency on a test runner.

The two metadata/population extractors are returned unchanged. Rendering does not create a dataset, scan metadata or source values, submit a job or claim an actual finding.

## Verification

From the skill root:

```sh
node scripts/test-render-audit-sql.mjs
```

The runner also accepts `--report /absolute/path/to/new-evidence.json` and always labels output **NO SQL EXECUTED**. It requires repository siblings only to read the pinned SQL/fixture/schema source bytes. The production renderer requires only its own script and local catalog; the caller supplies sourceSql/input explicitly.

Seventeen accepted input examples cover every entry. [Fixture derivations](sql-rendering-fixtures.json) pin original accepted fixture bytes and document only namespace transport and already established nullable-field materialization. Extractor examples use the accepted integration parameter shape with explicitly synthetic project/dataset identifiers. Production rendering performs none of that fixture nullable-field materialization.

The current rendering-only suite checks all 17 entries, 536 required top-level/native-field omissions, 33 nested required-field omissions, 20 other checks and 587 total rejected inputs. It checks unchanged outside-block bytes/native assertions, fixed schema/entry coverage, exact decimals/INT64 beyond 2^53, timestamp spelling, empty relations, arrays/STRUCTs/nulls, row namespace conflicts, literal injection-like text, metadata parameter fidelity, and an independent copied renderer+catalog install exercising all entries. A corrupted catalog type is rejected in a separate process. All accepted source/derivation hashes are checked before and after. No fixture runner or expected native result is executed as a producer.

The declared runtime floor is Node 20.10.0 on the Node 20 line, or Node 22+. Earlier Node 20 releases cannot parse the required `with {type:'json'}` import attribute. Node documents this syntax in 20.10.0 (also backported to 18.20.0); use Node 22.12+ for nonexperimental import attributes and final CI. The Node 18 line is not part of this module's declared/tested runtime range. [Official Node ESM history](https://nodejs.org/api/esm.html#import-attributes).

Observed test runtime is Node 20.18.1, which supports the import with an experimental warning. The two-file copy test uses that same actual runtime; the minimum-version and Node 22 CI executions are not claimed as completed here. Native BigQuery execution, parameter transport, host integration and query-result decoding remain the next reviewed step; these rendering tests make no claim about new native job evidence.

# BigQuery execution reference

[sql/attribute_leads.sql](sql/attribute_leads.sql) is a runnable Standard SQL script with
synthetic input CTEs. It creates temporary objects only and needs no persistent tables.
Its generated JavaScript UDF bundles this skill's local canonical taxonomy and resolver
inside a scoped IIFE. It receives one lead JSON string and one explicit configuration JSON
string per invocation, and returns a typed STRUCT. It never collects the CRM population
into one UDF argument.

## Run and regenerate

```sh
node scripts/build-sql.mjs
node scripts/build-sql.mjs --check
node scripts/test-sql.mjs
bq --project_id=YOUR_BILLING_PROJECT --location=US query \
  --use_legacy_sql=false --maximum_bytes_billed=1073741824 \
  < references/sql/attribute_leads.sql
node scripts/test-sql.mjs --live --project YOUR_BILLING_PROJECT --location US
```

The live test requires an already authenticated `bq` CLI. It runs synthetic data only with
a 1 GiB maximum billed-bytes cap per query job. Its private JSON evidence report defaults
to `~/Downloads/crm-paid-attribution-bigquery-evidence-TIMESTAMP.json`; use `--report PATH`
to choose another durable location. The report records actual job IDs, CLI/taxonomy versions,
source/artifact digests, states, errors, processed/billed bytes, and matched fixture counts.
No credentials are copied into the report or public artifacts.
Use `--resume-report PRIOR_REPORT.json` to continue after repairing a test-harness failure.
The runner writes a new report with a link to the original, preserves the original file,
and reuses only completed evidence with matching source, artifact, and query hashes.
Already verified successful queries and matching expected failures are not resubmitted.

`build-sql.mjs --check` compares the complete generated artifact to the current local sources.
It needs no sibling skill, external library, or network access. Regenerate after changing
either the resolver or the bundled classifier, then run local and live parity checks.

## Replace the synthetic input CTEs

Keep the UDF, validation, and native SQL primary-selection statements intact. Replace only
`configuration_input` and `lead_input` with explicitly scoped input relations:

| CTE | Required columns | Meaning |
| --- | --- | --- |
| `configuration_input` | `options_json STRING` | One complete resolver options object: source maps, patterns, bounded ad catalog, and explicit account bindings. |
| `lead_input` | `input_position INT64`, `lead_json STRING` | One complete API lead per row, with CRM identity and timestamp; input_position controls final presentation order. |

Use `TO_JSON_STRING` on a deliberately selected STRUCT to produce these JSON strings. Do
not serialize arbitrary CRM columns. The lead JSON schema and resolver options are defined
in [contract.md](contract.md); all required identities and date validation remain enforced
inside the canonical resolver. A SQL assertion requires exactly one configuration row, including for an empty lead input.
The explicit empty configuration is the JSON object `{}`, not an absent row. Configuration
contents are validated even with an empty lead input.

The UDF returns string, boolean, and repeated STRUCT fields corresponding to the full API
output, including typed `candidate_ads` and nested tracking-only raw evidence. Its three
internal fields are `_selected_click_value`, `_created_at_epoch_seconds`, and
`_created_at_nanosecond`. Native SQL excludes all three from the published result.
The two timestamp components are exact safe integers represented as FLOAT64, so the
BigQuery JavaScript runtime does not require BigInt. The public `created_at` preserves
the original timestamp string, including its fractional digits and offset spelling.

Before primary selection, a SQL `ASSERT` rejects duplicate CRM system/scope/lead-key tuples
across the full input population. No date filter or window is applied before this assertion.
A native `ROW_NUMBER()` then partitions by CRM system, CRM scope, selected click field, and
cleaned opaque click value. It orders by whole UTC epoch seconds ascending NULLS LAST,
then fractional nanoseconds ascending NULLS LAST, then lexical lead key. Only exactly
equal instants or tied null dates reach the lead-key tie breaker. Fractional precision
through nine digits is preserved, including before 1970 and with equivalent offsets.
Null timestamps have two null ordering components; naive or invalid calendar strings
raise an error. All UTM-only/untracked leads are primary, and all input leads remain in the
output. Never filter to primary rows when reporting the full funnel population.

The fixture query adds a test-only namespace to keep independent API invocations separate.
It does not add that namespace to the standalone production reference's identity keys.
Local tests execute the generated UDF in a VM and compare full rows with `attributeLeads`.
Live tests execute all successful fixtures in BigQuery, including multi-lead primary cases,
and compare every JSON output field. Temporal fixtures additionally assert independently authored
full-output goldens; the local runner executes a millisecond-truncation mutant to prove
those earliest-lead expectations detect the prior bug. Separate failed jobs prove duplicate scoped keys,
conflicting catalog entities, missing binding identities, and invalid/naive dates fail. Missing and duplicated configuration rows are tested in both
production mode and the fixture adapter, preventing cross/inner joins from dropping leads.

## Scope and production adaptation

This reference deliberately allows only a bounded catalog and configuration JSON per lead.
Repeated JavaScript parsing, pattern compilation, catalog scans, and bounded decoding cost
CPU. Large catalogs increase each argument and repeated UDF work; this sample makes no
large-population latency or cost claim. Keep configuration and fixture queries within
BigQuery request/UDF limits, and inspect measured job bytes and slot usage on your workload.

For production-scale catalogs, materialize catalog keys and explicit bindings as native
warehouse relations, normalize each raw key once, and perform scoped SQL joins with
uniqueness/ambiguity checks. Preserve the same exact source/account authorization,
ID-versus-name precedence, campaign identity, and complete funnel population. Re-run full
fixture parity when adapting those joins. Do not weaken scope checks to make a join cheaper.

BigQuery documents JavaScript UDF STRUCT conversion and recommends reducing data before
JavaScript processing in its [UDF reference](https://docs.cloud.google.com/bigquery/docs/user-defined-functions).
The native validation statements use its [procedural SQL reference](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/procedural-language).

## Recorded execution status

<!-- execution-status:start -->
Authenticated synthetic BigQuery execution passed on 2026-09-09 using
taxonomy 0.1.0: the standalone example, 86 successful API fixture cases
(119 full lead outputs), and 9 expected SQL failures. Local generated-UDF VM checks
covered all 125 fixtures. Every live job had a 1 GiB billed-bytes cap.
This is correctness evidence, not a large-scale performance benchmark. Private job identifiers,
billing project, and measured bytes remain in the local execution report.
<!-- execution-status:end -->

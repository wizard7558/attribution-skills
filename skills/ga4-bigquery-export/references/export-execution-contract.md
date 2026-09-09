# Daily export execution and retained results

`../scripts/run_checks.sh` delegates to `../scripts/run-export-checks.mjs`. The fixed inventory is `sessions.sql`, `channel_daily.sql`, `landing_pages.sql`, `traffic_source_compare.sql`, `params.sql`, `key_events.sql`, `ui_reconciliation.sql` and `ecommerce.sql` under `references/sql`. Each query is an independent BigQuery Standard SQL job. The wrapper does not modify templates or concatenate scripts.

## Run from a copied skill directory

Requires Node.js 20 or later, Bash, the Google Cloud CLI (`bq` and `gcloud`), and an intended authorized account with query, source-read and job-result access. Configure both CLIs to use that account before running; the wrapper does not switch accounts. `gcloud auth print-access-token` is captured in memory for the official BigQuery REST endpoint. No access token is written into reports or command arguments. Reports contain query results and source identifiers and should be treated as private data.

```bash
# Offline rendering: no credentials, API requests or SQL execution.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US --render-only \
  --report "$HOME/Downloads/ga4-export-render.json"

# Execute all eight daily-export templates against the explicitly named source.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US \
  --report "$HOME/Downloads/ga4-export-results.json"

# Read existing handles again; keep the original evidence untouched.
bash scripts/run_checks.sh example-project analytics_synthetic 20260901 20260903 \
  --billing-project example-billing --location US \
  --resume-report "$HOME/Downloads/ga4-export-results.json" \
  --report "$HOME/Downloads/ga4-export-results-recheck.json"
```

The four original positional arguments remain source project, dataset, inclusive start suffix and inclusive end suffix. Billing defaults to source project; location defaults to `US`. `MAX_BYTES` defaults to `1073741824` (1 GiB) **per job**. An operator can explicitly set another positive INT64 byte cap through this environment variable. The wrapper never raises a cap after rejection. Eight jobs can collectively bill more than one per-job cap. Sample `LIMIT` clauses bound output only, not query cost.

```bash
MAX_BYTES=10485760 bash scripts/run_checks.sh example-project analytics_synthetic \
  20260901 20260903 --location US --report "$HOME/Downloads/ga4-export-small-cap.json"
```

Dates must be real Gregorian `YYYYMMDD` values in years 0001–9999, ordered start ≤ end. Project IDs use the deliberately restricted standard lowercase 6–30 character form: start with a letter, end with a letter/digit, interior letters/digits/hyphens. Legacy domain-scoped project IDs and numeric project numbers are unsupported. Dataset names contain 1–1024 ASCII letters, digits or underscores. Locations contain a leading ASCII letter followed by at most 62 ASCII letters, digits or hyphens; actual region availability is checked by BigQuery. Caps must be decimal positive integers ≤ 9223372036854775807. Invalid arguments fail before credential access or submission.

Rendering uses literal replacement callbacks for the qualified source token, every suffix `BETWEEN` pair, ecommerce declaration suffixes and the UI date-spine endpoints. Remaining placeholders fail validation. No shell substitution, `sed`, arbitrary SQL filename or arbitrary source inventory is accepted.

## Submission, retrieval and resume

Before submission, an exclusively created report retains validated configuration, wrapper and source hashes, exact rendered queries and hashes, a client-generated job ID and state. Reports default to a uniquely named file in `~/Downloads`; explicit existing paths are rejected. Updates replace only the newly owned report. A resume always writes a different report and records the original file hash.

The wrapper invokes `bq` with an argument array and query on stdin, asynchronous submission, Standard SQL, query cache disabled and the explicit cap. It retrieves metadata through `jobs.get`, checking the job's project, location, ID, SQL, Standard SQL setting, cache setting and cap. Raw submission stdout/stderr, metadata observations, errors, processed/billed bytes and versions are retained. Missing CLI executables and failed version commands produce an incomplete report with a startup error and no submitted jobs. The HTTP token is never part of the recorded request. Credential acquisition failure deliberately omits credential stdout/stderr.

[`jobs.getQueryResults`](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/getQueryResults) is called only at `https://bigquery.googleapis.com/bigquery/v2/projects/{billingProject}/queries/{jobId}`, with the recorded location, `maxResults=1000`, and every returned page token. A successful result requires `jobComplete=true`, consistent schema and `totalRows`, no repeated page token, matching identity, and an accumulated row count exactly equal to `totalRows`. Every native schema/row page is retained. A page limit is not a total row limit.

The decoder preserves nulls, repeated values, nested structs and Boolean values. INT64, NUMERIC, BIGNUMERIC and TIMESTAMP remain strings; FLOAT64 uses its source floating representation, with nonfinite encodings kept as strings. The request sets [`formatOptions.useInt64Timestamp=true`](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/DataFormatOptions), so native TIMESTAMP values are exact signed microseconds since the Unix epoch as strings, including fractional-second boundaries. No JavaScript Number conversion is used for these timestamps or exact decimal fields. STRING/DATE/TIME/DATETIME/JSON fields remain strings. For a `result_json` column, the unchanged string remains in decoded rows and its actual JSON parse is additionally retained in `parsedResultJson`.

The metadata observation loop is bounded to 200 observations with three-second intervals, plus request latency. A running job, HTTP error, missing handle, incomplete page sequence, failed native job or inconsistent result is not a completed check. Exit status is nonzero if any check is incomplete. Inspect the saved state and native error before resuming. Resume verifies identical source/configuration/query/wrapper hashes and only observes each recorded handle; it never replaces or resubmits a recorded failed/missing job. Inventory entries never reached by the prior invocation can receive their first submission. This is continuation of recorded jobs, not automatic SQL retry. A lost local report cannot prove whether a previous job was submitted.

## Population and cost boundaries

The templates intentionally scan only daily `events_YYYYMMDD` suffixes in the literal supplied window. They do not union intraday tables. The [wildcard documentation](https://docs.cloud.google.com/bigquery/docs/querying-wildcard-tables) explains why a constant `_TABLE_SUFFIX` filter can restrict scanned tables. Native proof measures processed bytes from otherwise identical selected-column queries; neither row counts nor `LIMIT` alone proves pruning.

Late-arriving events, table existence and export completeness remain unknown from these outputs alone. The UI report's zero-row dates include a date spine and do not assert that a table is missing or complete. Property timezone stays unknown unless the SQL's declared contract explicitly supplies one. Session outputs use first observed events in the scan window, with window censoring. Landing and native-source-versus-URL-UTM outputs retain their top-20 inspection samples; params and raw key events retain top-1000 samples. Complete REST retrieval means complete retrieval of each SQL result, not that a sampled SQL result covers its whole underlying population. Raw key-event occurrences and the ecommerce qualified-transaction policy intentionally differ; see [parameter diagnostics](parameter-diagnostic-contract.md), [companion sessions](companion-session-contract.md) and [ecommerce](ecommerce-contract.md).

## Verification and synthetic ownership

```bash
# Pure validation, copied rendering, mocked HTTP pagination and same-job continuation.
node scripts/test-export-checks.mjs
# Prints NO SQL EXECUTED. Mocked transport is not native proof.

# Explicitly billed native proof against one newly created synthetic dataset only.
bash scripts/run_checks.sh --synthetic --billing-project example-billing --location US \
  --report "$HOME/Downloads/ga4-export-synthetic-proof.json"
```

Synthetic mode requires an explicit billing project and the default 1 GiB ordinary-job cap. It creates one random `ga4_export_test_...` dataset, with one-hour table expiration as a fallback, records ownership, runs all eight exact templates and standalone copies, then deletes only that exact owned dataset and verifies its absence. It never selects customer datasets. A failed dataset creation is not treated as ownership. Abrupt process termination can prevent cleanup; use the exact saved owned dataset ID for inspection and cleanup, not a prefix-wide delete.

`export-check-fixtures.json` contains independent full expected outputs for all eight scripts. The native input includes two distinct known-zero orders and a page view in one session, an empty end-day table, a missing middle day, an intraday duplicate and extra order, and 1001 out-of-window rows carrying misleading in-window event dates. The unrestricted same-column probe forces multiple real REST pages and exact fractional-second TIMESTAMP transport. A copied suffix-removal mutation must fail the literal output check. A separate one-byte-cap probe must fail natively, with that expected error preserved. Successful handles are read again without new SQL jobs. Source hashes, exact queries, native metadata, raw pages, complete decoded outputs, probes, original errors and cleanup evidence remain in the private Downloads reports.

This proves local wrapper and synthetic BigQuery behavior. It does not prove customer export completeness, UI parity, production-scale cost, or intraday union support. Customer execution is a separate operator action against an explicitly named source.

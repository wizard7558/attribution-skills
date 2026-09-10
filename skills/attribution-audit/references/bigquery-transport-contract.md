# Internal BigQuery transport

This helper submits already approved SQL and retrieves its complete native result. It is internal transport, not an audit entrypoint accepting arbitrary caller SQL. The audit host has not yet been wired to this helper. No attribution, classification, identity matching, money aggregation or source interpretation happens here.

## Interface

```js
import {runAuditBigQuery} from '../scripts/audit-bigquery-transport.mjs';
const result = await runAuditBigQuery({
  configuration: {billingProject, location, maximumBytesBilled: '1073741824'},
  query,
  queryParameters,
  parameterMode: queryParameters.length ? 'NAMED' : null,
  resultKind: 'rows' // or 'single_result_json'
}, {
  sharedModulePath,             // explicit absolute installed helper path
  expectedSharedSourceSha256,   // SHA-256 of its exact bytes
  reportPath                   // new absolute private report filename
  // resumeReportPath: priorReportPath
});
```

All keys shown are required except `resumeReportPath`. Configuration has exactly the three fields shown: a standard project ID, an explicit location identifier and a positive INT64 decimal-string byte cap. No source dataset, date or GA4 placeholder configuration is invented. Plain finite JSON input and options are captured synchronously before awaits; getters, proxies, cycles, sparse arrays and non-JSON values are rejected.

Named parameter records are `{name,parameterType,parameterValue}`. Scalar values are strings or explicit null; supported types are STRING, DATE, TIMESTAMP, DATETIME, TIME, BOOL, INT64, FLOAT64, NUMERIC, BIGNUMERIC, BYTES, GEOGRAPHY and JSON. ARRAY supports one of these scalar element types. Native value domains are validated by BigQuery. Numeric parameter strings never pass through JavaScript Number. An empty parameter list requires null mode; a nonempty list requires NAMED. Parameters remain JSON request data.

`resultKind='rows'` returns all shared-decoder rows without coercion. `single_result_json` requires exactly one row and exactly one parsed non-null JSON object; arrays and scalar envelopes are rejected. Native statuses, false, null, decimal strings and arrays are preserved. Execution or retrieval failures have null output; they are not fabricated native findings.

## Shared implementation and transport

The explicit installed file must export `executeJob`, `collectResults`, `decodeRows` and `exclusiveReport`. Its bytes are hashed before import, copied into one private temporary directory, made read-only and imported from that unique snapshot. The snapshot is removed after awaited retrieval. No sibling discovery or import of test runners occurs. The accepted GA4 helper's `executeJob` delegates complete pagination and decoding to its actual exports; its query, cap, mode and job-reference verification remains active. `createNativeTransport` is not used.

The audit-owned transport probes actual Node, bq and gcloud versions, obtains a gcloud access token in memory and uses only official BigQuery HTTPS endpoints. The access token and authorization headers are omitted from evidence. Submission uses jobs.insert, a client-generated job ID, explicit project/location, Standard SQL, disabled query cache, explicit byte cap and exact named parameters. Metadata and result pages use the same handle/location; result pages request 1,000 rows and INT64 timestamp representation. HTTP status, safe body, request body, times and errors are retained. Query parameter metadata is checked in addition to the shared helper's configuration checks. The only serialization equivalence accepts a received parameter containing exactly the same name and scalar DATE or STRING type but no `parameterValue`, when the corresponding submitted value is exactly `{value:null}`. These are the two types observed in the native probes; this is not a rule for every scalar type. Names, types, array cardinality/order, parameter mode and every other field must match. Empty objects, null containers, string `'null'`, all other scalar types, arrays and omitted non-null values are not equivalent. Every metadata check preserves raw sent/received records and the exact equivalence pointers, such as `/queryParameters/2/parameterValue`; raw metadata is never rewritten.

The optional third argument supplies isolated command/HTTP/polling seams for offline tests. It is not a caller-controlled audit input surface. Production defaults use actual executables and HTTPS, 3-second polling with the shared helper and 30-second HTTP deadlines. A transient/uncertain response never causes a new submission.

## Durable evidence and resumption

Before POST, `exclusiveReport` creates a new mode-0600 report, preserving full query, parameter records, configuration, source hashes and client job ID. Existing report paths cannot be overwritten. Each observation is saved. Treat these reports as private: query data, outputs and local executable paths may be sensitive.

`submission_attempted`, `server_job_observed` and `read_only_retrieval` are separate facts. `confirmed_fresh_queries` becomes one only when this new run actually observes its matching native handle. An uncertain POST may have server effects even when no handle was observed. A read-only resume always reports zero fresh queries; it cannot prove that an earlier uncertain POST had no effects.

Ordinary resume requires a new report and byte-identical query, parameters, configuration, result kind and implementation hashes. It calls the shared helper with `submit:false` on the recorded handle. Missing, failed, pending or uncertain handles are never restarted. Report lineage retains the prior report path and hash. The original evidence remains untouched. A helper change cannot silently reuse an old report as a current-source execution record.

## Tests and current verified boundary

From the repository root:

```sh
node skills/attribution-audit/scripts/test-audit-bigquery-transport.mjs
```

Offline mode reports **NO native SQL execution** through its `offline_only` mode and zero confirmed native query count. Tests execute the real shared helper against injected REST responses, including two-page retrieval, exact string-valued NUMERIC/INT64/TIMESTAMP data, parameter fidelity, uncertain submission recovery without another POST, missing CLI, wrong source hash, copied installed helper, safe credential handling and preserved native JSON output. The test runner's independently authored expected pattern never supplies production output.

The authorized native probe submits one table-free query with 1,006 ordered rows and a 1-GiB cap. Its first execution observed a native handle but stopped before result retrieval: BigQuery omitted `parameterValue` for the explicitly null DATE parameter. All other submitted parameter metadata matched. The original serialization failure and original source bytes are preserved. After review, the narrowly corrected reader retrieved that same historical handle with exactly three GET requests: one metadata response and two result pages. All 1,006 ordered full rows matched the independent literal pattern, including exact NUMERIC and microsecond TIMESTAMP strings, null DATE, false BOOL, control/Unicode/dollar text and ARRAY values. Parameter metadata matched with only `/queryParameters/2/parameterValue` recorded as equivalent. The job was DONE without error, with zero bytes processed/billed; this retrieval submitted zero new queries. Both temporary helper snapshots and the independent copied installation were removed. Ordinary resume still rejects changed implementation hashes; the one-off private migration records a separately labelled derived checkpoint and keeps original history immutable. This is transport proof only: it does not establish that the seventeen rendered production templates execute successfully.

Current STRING/DATE correction verification: 30 offline checks, 13 rejections and 31 retained mocked runs; zero native requests during this correction. Twenty-one metadata cases cover the DATE omission, STRING omission, mixed three-null extractor parameters, and eighteen non-equivalent or contradictory representations. Runtime observed during offline and native retrieval: Node 20.18.1, BigQuery CLI 2.1.19 and Google Cloud SDK 530.0.0. The historical submission used the original reader revision; the successful historical retrieval used the DATE-only reader SHA-256 `bf6c38fcacc588de8b9d5573f733a70efee14203ed2ba2d943dfcc0246ef4de3` and shared helper `9eaedf7ec9e30895195196dfd6f0d7447f175c9e58255c907b92a3f1b6494f14`. Exact old/new hashes, job handles, configurations and preserved failed observations remain in the private timestamped Downloads reports. No customer tables or permanent objects are used by the probe.

A second table-free native probe supplies the full-table extractor’s nullable `date_column` STRING and `start_date`/`end_date` DATE parameters. BigQuery returned all three names/types in order while omitting each `parameterValue`. The DATE-only reader correctly stopped at the STRING difference after one submission and one metadata GET, with no result retrieval. That report and its exact source bytes are preserved. The current reader now accepts only explicit-null STRING or DATE omissions and passes the offline boundaries above. The reviewed pinned migration then retrieved that same historical handle with two GET requests (metadata and one result page), zero POSTs and zero new queries. The complete native output was exactly one row with all three fields null. The only accepted equivalence pointers were `/queryParameters/0/parameterValue`, `/queryParameters/1/parameterValue` and `/queryParameters/2/parameterValue`. Original reports/source history remained immutable and both temporary installation layers were removed. This current reader is SHA-256 `82f6ccfe629ec6e8713e7248adeb9160ebad1b410661e94443157e5f8002f275`; the second historical submission used the prior DATE-only reader. The earlier 1,006-row handle was not retrieved again. This proves the required nullable parameter transport, not execution of the metadata extractor or audit-host integration.

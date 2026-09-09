# Actual pixel-to-money-metrics verification

Version `0.1.0`. This opt-in synthetic integration connects the actual HTTP collector, disposable PostgreSQL, the accepted consistent snapshot reader, actual identity engines through `prepareMtaInputs`, the unchanged native credit ledger, and the unchanged native money-metrics SQL. It adds test orchestration and evidence, not another identity, attribution, or monetary engine.

Two explicit site scopes, `metrics_known` and `metrics_uncertain`, each have two Paid Search page touches half a day apart. Their external CRM contacts are distinct, with distinct example-domain emails and explicit source bindings. The uncertain site also retains an ambiguous shared-device touch and an unresolved touch. Subject assertions on synthetic conversion events are persisted fixture provenance and checked against full captured rows. Neither visitor IDs nor native contact IDs become fallback subjects.

The known site supplies a positive `0.01` USD conversion and known zero. The uncertain site supplies unknown money with USD, mixed money with null currency, and a conversion with an entirely null subject triple. This collector API accepts JavaScript Number values: the test checks that the serialized positive value is exactly `0.01` and PostgreSQL returns `value::text` exactly `0.01`. This proves that concrete capture only. It does not claim arbitrary decimal precision through the Number API.

The first bounded BigQuery job executes the actual credit-ledger SQL on all prepared source rows. Its complete native producer result—every model, qualified source, credited or uncredited coverage row and diagnostics—is retained. A transport-only projection copies precisely the native `ledger_input` and `coverage_input` columns in [the metrics contract](../../multi-touch-models-sql/references/metrics-contract.md), preserving their values and every row. No JavaScript monetary calculation, source/model filtering, reclassification, identity bridge, or replacement with expected output occurs in that projection.

Three separate native metrics jobs select `time_decay`, UTC, the same reporting date/as-of, `full_lookback`, ordinary conversions and incomplete acquisition history. They differ only in explicit conversion membership (known site versus both sites) and spend completeness (complete versus partial). One explicitly declared spend source supplies known `10` USD Paid Search and `3` USD canonical Paid Other facts (native Display provenance). Report membership and shared channel names are declarations of report population, not person-identity bridges. The native Display spend fact survives under Paid Other as spend-only.

The independent full fixtures expect 40 ledger rows across all five models and 25 coverage rows, including five unresolved-subject rows. The three metrics outputs contain 4/8/8 allocation rows, two channel rows each, and 0/1/1 uncredited rows. With half-life 0.5 day, weights are one-third/two-thirds; the positive amount's ten million `1e-9` units divide into 3,333,333 and 6,666,667. Known zero remains zero. Known-site Paid Search revenue is `0.01`, spend `10`, attributed count 2, cost `5`, and ROAS `0.001`. Paid Other has spend `3` and unknown revenue. Combined revenue retains mixed status and null value; incomplete spend retains observed amounts/currency while final spend and dependent ratios remain unknown. Native reason precedence is retained.

Only random native UUIDs are mapped to fixture labels during full-output comparisons. Original FLOAT64 credits/counts allow `1e-12` comparison tolerance; monetary amount strings and every other field are exact, apart from the one explicitly scoped ratio comparison below. The fixtures were authored independently before native execution. A deliberately mismatched consumer boundary must fail the native assertion. An executed transport mutant drops uncredited coverage: even if SQL accepts the incomplete population, the complete expected-output comparison must reject its missing coverage and altered diagnostics.

Run offline fixture, exact projection, and copied-layout checks:

```sh
node scripts/test-metrics-handoff.mjs
```

This prints **NO native SQL**. It also calls the accepted adapter and actual installed identity dependency, and verifies an independently copied pixel/identity/MTA layout with explicit dependency roots.

Run the owned actual chain from the pixel skill directory:

```sh
node scripts/test-metrics-handoff.mjs --native \
  --project YOUR_BILLING_PROJECT --location US \
  --identity-skill-root /path/to/clickstream-identity-stitching \
  --mta-skill-root /path/to/multi-touch-models-sql
```

The outer runner removes any inherited database configuration and invokes `roundtrip.sh --native-metrics`. That mode requires an explicit billing project and a newly owned loopback PostgreSQL/collector pair. Existing roundtrip, atomic, capture and resolver assertions remain enabled. Native jobs use Standard SQL, disabled cache, temporary tables and a 1 GiB per-job cap. Only marked `REPLACEABLE INPUTS` sections are replaced, with typed CASTs and literal-safe replacement callbacks. Original production SQL files stay unchanged. No hosted deployment, customer tables, model calls, provider calls or permanent warehouse writes are part of this test.

Private timestamped Downloads evidence retains source/fixture hashes, complete HTTP bodies and serialized values, full PostgreSQL snapshots, actual identity projection/prepared input, actual producer output, full consumer input, rendered query bytes, job IDs/metadata, limits, results/errors, and producer-to-consumer hashes. Original failed attempts remain separate artifacts. The outer runner verifies that its collector/PG ports close and its owned data directory is removed. Existing user databases/services are not reused.

Recheck a completed final report without submitting queries or starting PostgreSQL:

```sh
node scripts/test-metrics-handoff.mjs --resume-report /path/to/original-evidence.json \
  --report /path/to/new-read-only-evidence.json \
  --project YOUR_BILLING_PROJECT --location US \
  --identity-skill-root /path/to/clickstream-identity-stitching \
  --mta-skill-root /path/to/multi-touch-models-sql
```

The source/query hashes must match. Each exact job ID is inspected with read-only metadata/results calls; full successful outputs and expected native/mutation failures are rechecked. This is not a restart or a fresh model/SQL run. A native transport/query failure remains an error in its evidence, never a synthetic unknown result.

## Producer JSON encoding and bounded continuation

The producer uses `TO_JSON_STRING`. Fractional NUMERIC values are JSON strings; small integral values, including zero, are JSON numbers under [BigQuery's documented JSON encodings](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/json_functions#json_encodings). Thus this producer's positive value is `"0.01"`, while known zero is `0`. The transport copies these actual values without coercion before explicit native NUMERIC CASTs. Downstream metrics deliberately serialize all monetary results as decimal strings.

The initial producer full-output comparison exposed a fixture type error in exactly 15 positive-value fields (ten ledger and five coverage rows). Its original fixture bytes, completed native job, and failed comparison report remain private evidence. A reviewed correction changes only those values from JSON number `0.01` to string `"0.01"`; known zero and all other expectations remain unchanged. No SQL, captured values, or transport semantics change.

The narrowly scoped `--continue-report` mode accepts that one-producer report plus `--previous-fixtures` and `--fixture-change-note`. It verifies the original fixture hash and exactly the 15 approved changes, requires all frozen dependency hashes to match, and retrieves the same successful producer job read-only for a complete corrected comparison. Only then can it submit the three consumer jobs and two negative tests using the original actual producer rows. It does not restart PostgreSQL, the collector, or the producer. This recovery mode is distinct from `--resume-report`, which submits zero jobs and only rechecks the final complete chain.

A separate reviewed input correction replaces native `Display` with canonical `Paid Other` in the spend declaration and its three expected channel rows, retaining `spend_key=display` and native-label provenance. The accepted taxonomy source mapping requires this canonical label. Original fixture bytes and the terminal `invalid raw spend` consumer job remain evidence. The optional `--canonical-spend-correction --failed-consumer-report /path/to/original-report.json` continuation guard permits exactly those four extra field changes and retains the original failed job alongside the final six-job chain; it never changes the transport or classifier.

## Scoped FLOAT64-denominator comparison

The combined complete-spend native report can sum its original FLOAT64 credits to slightly below four. The accepted SQL preserves that count and computes the cost ratio from it; [BigQuery documents FLOAT64 SUM as nondeterministic](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/aggregate_functions#sum). The independent analytic expected cost remains the literal `2.5`; it is not replaced with a captured native ratio. Only `combined_complete.channel_metrics[1].cost_per_attributed_conversion` (the canonically ordered Paid Search row) permits an absolute `1e-12` comparison difference, measured by exact decimal/BigInt parsing. The actual result string is retained untouched. The row's identity/order, all allocations/revenue/spend amounts, statuses, currencies, nulls, and known-only cost `5` remain exact. Wrong type/null, a ratio beyond the bound, altered amount or status, and even a tiny change to known-only cost are rejected by focused tests.

The failed strict ratio comparison and the original comparator source are retained. `--completed-consumers-report /path/to/prior-report.json` permits the explicitly completed known/combined consumer handles to be read and fully compared again under the corrected comparator, provided their query bytes and all other source hashes match. Only the missing partial-spend consumer and two negative tests are then submitted. Successful native queries are not repeated. Final evidence includes six jobs for the completed chain plus the preserved invalid-spend attempt.

## Verification status

Actual synthetic native verification completed on 2026-09-09 UTC. All 40 producer ledger rows, 25 coverage rows and producer diagnostics matched the independently authored corrected goldens. The three metrics reports matched all 20 allocation rows, six channel rows, two uncredited rows and three diagnostics rows. The native boundary assertion rejected mismatched reporting inputs, and the executed dropped-coverage transport mutant was rejected by the full-output scorer. The final continuation ran 29,224 assertions; offline checks ran 11,552 assertions.

Seven distinct terminal native job handles are retained: the final six-job chain and the original invalid-spend attempt. All jobs used Standard SQL, disabled cache and the 1 GiB cap; the largest billed amount was 817,889,280 bytes. Every final handle/result was subsequently rechecked read-only with zero submissions. The original producer and successful consumer queries were reused by exact handle, never rerun to obtain a preferred answer. Earlier PostgreSQL evidence-query, producer JSON-type, invalid-spend, and strict FLOAT64-denominator comparison failures remain historical evidence.

The owned PostgreSQL directory was removed and its database/collector ports closed after the original producer roundtrip. That roundtrip's nonzero exit remains recorded because the initial producer golden comparison failed; later read-only/consumer continuations resolve verification without fabricating a new collector run. Copied installations produced identical prepared input and identical consumer SQL using explicit dependency roots.

Initial execution reports directly capture hashes for their listed source files. A separate final closure records the bundled collector taxonomy, normalizer and Node adapter hashes as **post-run verification**, linked to earlier accepted unchanged-source/artifact evidence. Those supplemental hashes are not presented as startup attestations. No model evaluation, production deployment, permanent warehouse write or customer-data execution occurred.

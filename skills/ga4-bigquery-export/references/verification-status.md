# Native verification status

Reviewed 2026-09-09. This record separates synthetic contract checks, bounded live export compatibility and model evaluation. The current [model evaluation](eval.md) remains pending. No query or model was rerun for this documentation alignment.

## Current evidence boundaries

| Evidence | Accepted result | What it establishes |
| --- | --- | --- |
| Parameter/diagnostic and refreshed companion suites | 30 final native jobs, including seven actual templates and seven standalone copies, empty/permuted inputs and four detected semantic mutants | Current helper selection, raw diagnostics, session evidence and companion literal-output behavior on bounded synthetic inputs |
| Ecommerce suite | 13 final native jobs: nine full literal reports, copied SQL, event permutation and two detected semantic mutants | Qualified domain/date/payload accounting, unknowns and deduplicated item behavior on the declared synthetic fixtures |
| Execution-wrapper native proof | 21 jobs: 20 successful and one expected low-cap rejection; all eight templates plus standalone copies | Actual rendered SQL execution, complete transport, pruning and enforced cap behavior on owned synthetic tables |
| Current live export smoke | Two authorized source scopes × eight current templates for one historical day: 16 unique successful one-attempt jobs, 43 result pages | Current wrapper/schema compatibility and complete retrieval of each SQL's declared output for those exact bounded exports |

Counts describe each named final proof, not a combined count of all historical attempts. Earlier attempts and read-only observations are retained privately and are not relabeled as fresh successful queries. No private source names, job IDs or result rows are published here.

## Synthetic detail

The parameter and companion proof retains full native outputs, independent literal expected projections, duplicate/first-NULL parameter cases, qualified multiple-session cases, whole-record attribution, key-event engagement, URL parser cases and sample boundaries. Four native mutations demonstrate rejection of changed parameter ordering/NULL handling or altered companion engagement/source coherence. The same 30 final handles were rechecked read-only, with no additional queries. See the [parameter](parameter-diagnostic-contract.md) and [companion](companion-session-contract.md) contracts.

The ecommerce proof includes cross-date duplicates, distinct users/streams, conflicting payloads, missing keys, window-wide unkeyed uncertainty, finite zero/negative values, nonfinite inputs, guarded overflow and item fanout. Its exact [policy](ecommerce-contract.md) remains approximate FLOAT64 warehouse analysis, not financial or GA4 UI reconciliation.

The wrapper proof compared full outputs for all eight templates and eight copied standalone files. Same-column constant-suffix and unrestricted probes processed 24 versus 8,048 bytes on the owned synthetic tables. This is measured pruning for that fixture, not a production cost forecast. A native 1,006-row result required two pages and retained exact microsecond TIMESTAMP strings. A deliberately removed suffix predicate failed the expected-output check; a separate nonempty query with a one-byte cap produced the expected native cap failure. The owned dataset was deleted and absence verified.

The wrapper's successful synthetic run preceded a narrow startup-error-retention change. Both revisions and their diff remain in private evidence; the current reader re-fetched all 20 successful handles with identical outputs and zero new queries. The current wrapper then executed the 16 live checks below. Do not attribute new native query execution to a read-only cross-revision retrieval. The wrapper's offline suite passed 113 assertions, including validation, rendering, standalone loading, mocked pagination/resume and missing-CLI startup errors; those offline tests executed no SQL.

## Current live smoke

All 16 jobs used current template and wrapper bytes, Standard SQL, `useQueryCache=false` and `maximumBytesBilled=1073741824`. Total billed bytes were 3,400,531,968 across the run; the largest individual job billed 482,344,960 bytes. No cap was increased, no query was retried and no source/date scope was broadened.

Every result page and schema was retained and decoded, with final row counts checked against native `totalRows`. Source/date provenance and the session-derived daily totals were checked within each source. Inline/helper parameter sample projections agreed. Reports and suppressed-result logs are private mode-0600 artifacts; exact targets, job metadata, source/query hashes and original envelopes remain available for authorized review.

These are compatibility and internal-consistency checks, not independently known customer business totals. Full retrieval preserves SQL sample limits: landing and traffic return at most 20 groups, params up to 1,000 rows in each array, and key events at most 1,000 occurrences. Successful daily-only queries do not establish table completeness, UI parity, identifier causes, lifetime sessions, cross-source person identity or support for intraday unions.

## Current executable hashes

SHA-256 values below identify the accepted executable bytes. Documentation changes do not alter them. Source scope and date literals are rendered per invocation and produce separate retained query hashes.

| Relative file | SHA-256 |
| --- | --- |
| [references/sql/sessions.sql](sql/sessions.sql) | `ee76588d48334bcc033cd8edd6ec28134ff359c7d3e5045a8b0f4f8d5d4ed587` |
| [references/sql/channel_daily.sql](sql/channel_daily.sql) | `4309a0225cac62771bf8f56b52fc0b2ae9eae7b5ac58a8d643148f78a247b361` |
| [references/sql/landing_pages.sql](sql/landing_pages.sql) | `481bcbdb92b2111690bc8093a4802f0fd09286f1f0cce7572c87f15f1e6dfa75` |
| [references/sql/traffic_source_compare.sql](sql/traffic_source_compare.sql) | `0b92d5049ae78506200df314cc846de644d399d4ef499ec04cb2b9a84afb6617` |
| [references/sql/params.sql](sql/params.sql) | `3d9528f013c781642f5092df84f1b14d0c3d2e695cec03419499869af6c5784f` |
| [references/sql/key_events.sql](sql/key_events.sql) | `222626d590d9c084318916b44cb40beac00a259a0ea1208f2360fa4cc90ebd73` |
| [references/sql/ui_reconciliation.sql](sql/ui_reconciliation.sql) | `098c9c6009797cc2661e66218a1ebd93c3b422cd326ad298f6a879d4bbfbe2d8` |
| [references/sql/ecommerce.sql](sql/ecommerce.sql) | `60e45b553965e30d5d9875cc44f88875a6045ab870a15c8aafac29c9ae0e530c` |
| [scripts/parameter-helpers.sql](../scripts/parameter-helpers.sql) | `08247dfce0de8cb793ebbef101e07eea59dc69e7add339f94850160bf25234aa` |
| [scripts/run_checks.sh](../scripts/run_checks.sh) | `f2d9a100be1080010f90a99c367dfc28612ac6043fac05bfce910a9cd2352998` |
| [scripts/run-export-checks.mjs](../scripts/run-export-checks.mjs) | `9eaedf7ec9e30895195196dfd6f0d7447f175c9e58255c907b92a3f1b6494f14` |

## Reproduce within an explicit scope

From a copied skill directory, run `node scripts/test-export-checks.mjs` for offline validation; it reports **NO SQL EXECUTED**. Read the [execution contract](export-execution-contract.md) before any billed run. Its `--synthetic` command requires explicit billing/location and creates only an owned disposable test dataset; it is distinct from customer export execution.

Lower-level fixture definitions and native flags are documented in the [parameter](parameter-diagnostic-contract.md), [companion](companion-session-contract.md) and [ecommerce](ecommerce-contract.md) contracts. Repository-only drift/isolation checks are `node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check` and `node skills/ga4-bigquery-export/scripts/test-artifacts.mjs`. They validate generated bytes, not BigQuery runtime behavior.

Keep new query reports separate from prior acceptance evidence. Same-handle read-only retrieval can resolve observation status without submitting replacement queries. Changed schema, source bytes, date windows or metric policies need their own review and evidence.

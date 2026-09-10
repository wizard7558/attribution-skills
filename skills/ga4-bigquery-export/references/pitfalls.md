# Pitfalls and report boundaries

These checks identify evidence to inspect; they do not diagnose a customer's discrepancy from a symptom alone. Use the [schema prerequisites](schema.md) and the contract for the selected report.

## 1. Array fanout changes the metric grain

Unnesting parameters or items multiplies raw rows. Extract scalar parameters with first-offset helpers. For ecommerce, derive item lines only from one accepted nonconflicting transaction payload, preserving original item offsets. Aggregating repeated raw purchase items afterward cannot undo a mistaken deduplication domain. See [ecommerce](ecommerce-contract.md).

## 2. A LIMIT is not a scan-cost control

Project needed fields and review literal suffix bounds. A top-20 or top-1,000 output does not make the scan cheap. The current wrapper uses an explicit per-job byte cap and no cache; it never raises the cap after failure. Google documents [constant suffix restrictions](https://docs.cloud.google.com/bigquery/docs/querying-wildcard-tables) as wildcard table-selection controls.

## 3. Missing pruning or intraday overlap changes the population

`events_*` can match both daily and intraday names. The supplied eight-digit literal suffix range selects daily tables and excludes `intraday_...` suffixes. These templates do not implement a daily/intraday union or overlap-resolution policy. Inspect the exact rendered query before submission; do not substitute an unbounded wildcard.

## 4. Duplicate parameters are not a backfill instruction

The first matching parameter record by original array offset wins, including NULL in the requested typed field. Do not use an unordered `LIMIT 1`, skip the first NULL or take a number from a later duplicate. Numeric coalescing occurs only within the chosen record. Duplicate-key counts report repetitions, not proof of conflicting values. See [parameter diagnostics](parameter-diagnostic-contract.md).

## 5. Partial source structs must remain partial

Cross-channel evidence wins per event when any selected field is non-NULL. Only all-NULL evidence falls back to that event's manual struct. Choose one ordered struct across events; never combine source and medium from different records. Landing UTMs and native attributed session evidence are different observations, and missing UTMs do not mean Direct. See [channel rules](channel_rules.md).

## 6. A local session token is not a universal identity

Use `(source_system, source_scope, session_key)`, not `ga_session_id` or visitor alone. The shipped session reduction does not split platform/stream and does not reconstruct timeouts or events outside the scan. It can merge equal visitor/session values across streams inside one property. Do not infer a person bridge to another property, pixel or CRM system.

## 7. Missing identifiers do not reveal their cause

Session-derived outputs and the raw key-event sample exclude NULL visitor/selected session IDs. Raw page-view parameter samples and identifier diagnostics retain missing-ID evidence. Missing-user and missing-session counts may overlap. The queries read no consent fields, so they cannot label missing IDs as consent-restricted traffic or explain absent ad identifiers causally.

## 8. Observed engagement is a proxy

The query combines the selected engaged flag, accumulated integer engagement milliseconds, page-view count and configured key-event count. It does not reproduce elapsed-duration logic, screen-view counting or property settings. Google's [definition](https://support.google.com/analytics/answer/12798876) and [configurable session settings](https://support.google.com/analytics/answer/9191807?hl=en) must be distinguished from this fixed warehouse policy. A custom property key-event list is not discovered automatically.

## 9. Old dates and low daily counts do not prove completeness

Google documents daily-table updates for late events for up to three days after event dates. This is an ingestion rule, not a fixed time after which these diagnostics certify completeness. A date-spine zero means zero observed rows; table existence, completeness and landing lag remain unknown without separate evidence. See [export timing](https://support.google.com/analytics/answer/7029846) and [diagnostic boundaries](parameter-diagnostic-contract.md).

## 10. Dates, timestamps and observation windows differ

Google defines `event_date` in the registered timezone and `event_timestamp` as UTC microseconds. Do not infer the IANA timezone from BigQuery location or equate UTC dates with supplied property dates. First-observed session/order assignment is censored by the scan. Observed cross-date session evidence does not establish continuous activity or a lifetime start. [Field definitions](https://support.google.com/analytics/answer/7029846).

## 11. Purchase count and revenue must share a declared domain

Do not globally `COUNT(DISTINCT transaction_id)` while summing amounts from visitor-qualified rows. The ecommerce domain includes property, platform, stream, visitor and exact transaction ID, across dates. Identical payload repeats collapse; contradictory payloads have no authoritative amount or item lines. NULL versus non-NULL payload values conflict. Any unkeyed event in the window prevents complete daily all-population counts/money, while known qualified subtotals survive. [Ecommerce policy](ecommerce-contract.md).

Google's [transaction-ID guidance](https://support.google.com/analytics/answer/12313109?hl=en) discusses same-user duplicates and web-stream deduplication. It does not make this warehouse policy app/UI parity. The channel-daily session/transaction policy and raw repeated key events intentionally remain different populations.

## 12. Unknown money is not zero

Keep missing, invalid, conflicting and unkeyed evidence visible. Ecommerce accepts finite zero and negative values, preserves known subtotals and reports numeric failure instead of inventing zero on overflow. Its scaled FLOAT64 arithmetic remains approximate. Channel-daily revenue has a separate NULL-based status policy and ordinary FLOAT64 sums; its `complete` status is not a finite-money guarantee. Do not silently translate either vocabulary into a different contract.

## 13. Currency names do not establish a financial reconciliation

Keep supplied USD amounts separate from native currency/value evidence. Google describes native purchase and item revenue as local currency; do not claim property currency or a particular exchange-rate timestamp without evidence. Source FLOAT64 amounts are not an exact decimal ledger. The ecommerce report does not aggregate native-money fields. [Source schema](https://support.google.com/analytics/answer/7029846).

## 14. A UI gap needs matched definitions and evidence

Compare actual population, date boundaries, filters, configured key events, attribution scope, currency and metric definitions. Google documents estimated session counts using HLL++ in some Analytics reporting contexts, but that does not establish the cause or acceptable size of a particular discrepancy. Do not promise a fixed error band, infer modeling/consent from missing IDs or force exact parity. [Google session counting](https://support.google.com/analytics/answer/9191807?hl=en).

## 15. Complete retrieval does not remove SQL sampling

The wrapper retains every native REST page and checks totalRows. Landing/traffic still contain top-20 limits; params contains two up-to-1,000 arrays; raw key events has a 1,000-row limit. These are ordered samples. A JSON report row can contain many nested evidence rows, so outer row count is not the event count. [Execution contract](export-execution-contract.md).

## 16. Failure is not permission to change the job

Validate schema and rendered SQL before execution. A missing nested field is not a NULL value. Multi-statement dry runs are best effort and can stop before later statements; a zero estimate is not full-script cost evidence. Retain the existing handle after submission or observation failure. Exact-source/configuration resume retrieves that handle rather than replacing it; failed/missing handles stay failures. Inspect the recorded error before any separately authorized correction or new query. [BigQuery dry-run limits](https://docs.cloud.google.com/bigquery/docs/multi-statement-queries#dry-run_a_multi-statement_query).

# Fresh local audit invocation

Version 0.1.0. `scripts/execute-audit.mjs` exports `executeAudit(input,{skillRoots,pythonExecutable?,bigquery?})` and `AuditPreflightError`. This bounded host invokes the actual installed pure JavaScript modules listed below, then calls the unchanged `composeAudit` against their freshly constructed artifacts. It never invokes a fixture runner, copies business logic, joins identities, discovers mappings, sends provider requests, provisions collectors or executes PostgreSQL. Actual local Python MMM adapters are documented in [Python execution](python-execution-contract.md). The seventeen fixed non-GA4 BigQuery routes, explicit configuration, private reports and mocked-only host verification are documented in [BigQuery execution](bigquery-execution-contract.md); GA4 SQL and both PostgreSQL surfaces remain explicitly unavailable.

## Exact operations and native arguments

| Registry skill / entrypoint | Operation enum | Actual function / native input |
| --- | --- | --- |
| channel-taxonomy / classify | classify | `classify(input)` |
| first-party-pixel / identity_projection | projectIdentity | `projectIdentity(input,{identitySkillRoot})`; host supplies the explicit snapshot root for the identity dependency |
| clickstream-identity-stitching / dedupe_touches | dedupeTouches | `dedupeTouches(input.touches,input.options)`; exact wrapper `{touches,options}` |
| clickstream-identity-stitching / identity_graph | buildIdentityGraph | `buildIdentityGraph(input)` |
| clickstream-identity-stitching / webhook_resolution | resolveWebhookStitch | `resolveWebhookStitch(input)` |
| crm-attribution-profiler / profile | profileCrmAttribution | `profileCrmAttribution(input)` |
| crm-paid-attribution / attribute_leads | attributeLeads | `attributeLeads(input.leads,input.options)`; exact wrapper `{leads,options}` |
| capi-match-keys / conversion_preparation | conversionFromStage, prepareConversion | Same-named actual export, with native input directly |
| capi-match-keys / provider_payloads | google, linkedin, meta, tiktok, reddit | Actual `buildGooglePayload`, `buildLinkedInPayload`, `buildMetaPayload`, `buildTikTokPayload`, `buildRedditPayload` respectively; native input directly |
| mmm-and-incrementality-framing / weekly_mlr, response_curves, framing | fit_weekly_mlr, calibrate_and_scenario, compare_shares, project_bands | Actual unchanged Python CLI scripts; see [exact transports and interpreter requirements](python-execution-contract.md) |
| Seventeen fixed CRM/funnel/MTA/quality SQL entrypoints | executeSql | Actual snapshotted renderer and transport; see [fixed route list and exact inputs](bigquery-execution-contract.md) |
| GA4 sessions/channel_daily and pixel identity_snapshot/native_views | unavailable | No adapter invocation; `adapter_not_implemented` |

The JavaScript surface is nine entrypoints and fourteen approved operation routes; Python adds three entrypoints and four operation routes. BigQuery adds seventeen fixed entrypoints, each with the single operation executeSql. CAPI builders prepare payloads only. A ready payload is not a sent/accepted conversion. Native blocked, ineligible, unknown, ambiguous or guarded statuses remain complete native objects inside a succeeded execution; no status is converted to quality pass or causal lift.

## Strict fresh input

Root has exactly `{audit_key,boundary,inventory,bridges,evidence_records,steps,invocations}`. Boundary, inventory, bridges and evidence records have the exact accepted composition contract. Identifiers, source pairs, explicit bridge kinds and report declarations are not weakened. `skillRoots` is an explicit mapping of installed skill names to absolute roots. There is no sibling discovery. The host captures all finite plain JSON input and options synchronously before any await, rejects getters/proxies/cycles/sparse arrays/nonfinite values, and never freezes or mutates callers.

Steps have the accepted fields `{step_id,skill,entrypoint,required,depends_on,input_evidence_refs,artifact_ref}`, except fresh `input_evidence_refs` is an array of exact evidence-ref strings. The host resolves content hashes from catalog values or actual successful producer outputs. Every step has exactly one invocation. `artifact_ref:null` is explicit unavailable execution (`artifact_ref_missing`) and never enters a function. Nonnull artifact refs and every evidence/dependency reference must satisfy the frozen composer's uniqueness and DAG rules.

Each invocation has exactly `{step_id,operation,input,bindings,declaration,observations,expected_source_hashes}`. Input is the complete native payload or an explicitly shaped template with null placeholders. Declaration/observations use the accepted composition schema. Source hashes exactly cover every selected registry `{skill,path}` ref, keyed `skill/path`, including finite transitive dependencies across explicit installed roots. Unknown operations and arbitrary paths/functions/expressions reject.

Bindings are `[{target_pointer,evidence_ref,source_pointer}]`. Source pointer addresses a catalog record's `value` or a successful actual producer's native `output`; target pointer addresses an existing null placeholder in this invocation's input. Root pointer `""` is supported. Copy the complete selected value, including arrays, nulls, false and decimal strings. Duplicate or ancestor-overlapping target paths reject; malformed/missing pointers reject. Every binding reference must be named in step input_evidence_refs. Artifact sources require a direct producer dependency. No fixture expected output, stored execution artifact, inferred identity subject, automatic profiler mapping or expression can be used as a runtime producer. Catalog inputs are explicit caller inputs/attestations, not hidden mappings.

## Preflight, source snapshot and execution

The frozen composer performs initial structural declaration/DAG checks using truthful not-yet-invoked artifacts (`unavailable`, `invocation_pending`, null output). Their empty input represents no invocation yet; it is not a claim a native module executed with an empty object. After each explicit binding resolves, composer preflight validates that actual proposed native input's origins, known bridges and report configuration before entering the consumer. Provider payload input additionally checks its actual nested `preparation_input.policy.as_of` against the audit as_of; this is the provider wrapper's known configuration path, not a second attribution engine.

One private temporary snapshot is created per run. Only selected allowlisted source refs are copied from explicit installed roots; copied bytes are hashed against expected hashes, files become read-only and directories read-only during execution. Resolve modules and the pixel identity dependency from these snapshot roots. A new unique path per run prevents Node's module cache from using previous installed bytes while claiming a changed hash. Installed roots are never modified. Missing selected sources/roots are unavailable; mismatching source bytes or invalid evidence integrity fail. Per-registry-key `source_snapshot_errors` preserve installed_source_missing/unavailable for omitted roots or ENOENT and installed_source_unreadable/failed for permission failures, escaping symlinks and other read/copy errors. A source that cannot be copied is never silently downgraded from unreadable failure to mere missing snapshot coverage. No function is entered after failed/unavailable producer dependencies, even when a producer is globally optional. A partial source declaration does not itself prohibit an otherwise explicitly requested valid computation; it remains partial coverage in composition.

`fresh_upstream_calls` counts host-selected JavaScript function entries plus actual Python native process starts, including entries/processes that subsequently fail. Runtime probes are excluded; Python internal function entry is unobservable and reported null. It does not count imports, preflight/source reads or nested helper calls inside those functions. Calls are sequential in stable topological order. The host awaits each actual function and final composition before cleanup. The exact owned snapshot is removed on successful, failed or preflight-error paths; installed roots and unrelated temporary resources are untouched.

A regular native thrown error becomes a failed artifact with null output/hash and reason `native_invocation_failed`; runtime transport records error name and a hash of its message rather than leaking a data-bearing message. Import failure is `adapter_import_failed` and has no function entry. Native result objects are captured without semantic editing. A non-JSON/structurally contradictory native output or nonexistent requested output observation cannot be coerced into a valid artifact.

A later structural contradiction rejects with generic `AuditPreflightError`. Its documented `evidence` property retains phase, attempted step ID when known, captured request, unresolved/resolved attempted input, actual native output when available, and prior actual-call provenance. No partial-success audit or invented invalid native finding is returned. Cleanup completes before the rejection is delivered. Structural error phases include request_preflight, binding_resolution, resolved_input_preflight, native_output_preflight, native_output_capture and host_validation. Errors during strict synchronous capture remain generic TypeError and occur before any snapshot/function entry.

Blocked consumers retain their full unresolved template in run provenance; their unavailable/failed artifact has `{}` as invocation input because no native invocation occurred. Immediately before function entry the host captures the resolved argument and its canonical hash, then passes a separate captured value to the actual function. Entered calls' artifacts carry that exact pre-call input/hash and executed source hashes; a mutating implementation cannot retroactively change the provenance. A structural invalid output is retained on error evidence rather than synthesized as composer success.

## Result and provenance

Return exactly `{execution_mode:'fresh_invocation',fresh_upstream_calls,run_provenance,composition}`. Inner composition remains truthfully `execution_mode:'artifact_composition',fresh_upstream_calls:0`. It preserves all fresh native outputs and reports the accepted separate execution/quality/data-coverage statuses. There is no double-counting or claim every registered adapter exists.

Run provenance retains an opaque run ID, actual Node version, start/end timestamps, full captured request and canonical hash, owned snapshot path and observed snapshot source hashes, per-step call records, cleanup confirmation and explicit limits. Each call identifies operation/function, entered flag, times, status/reasons, expected/actual source hashes, resolved input/hash, complete output/hash and copied binding provenance. Native throws additionally record safe error evidence. Composer artifacts use actual Node runtime provenance, never invented SQL job IDs. Dynamic timestamps/run IDs/snapshot paths are actual observations, not deterministic fixture values.

Unsupported adapters are unavailable with adapter_not_implemented (plus independent missing-source/integrity reasons if present). Python MMM scripts are supported with the explicit interpreter option. BigQuery, PostgreSQL snapshot reads, schemas/views and native quality checks await the separate adapter step. No output from this step proves a native SQL check or provider delivery occurred.

## Verification and installation

The host and deterministic tests use Node built-ins. Use Node 22+ when invoking the full installed dependency set, consistent with the CAPI contract; the bounded synthetic verification records its actual runtime version independently. Keep this skill's accepted composer/registry alongside the new host. Supply independently installed roots explicitly:

```js
import {executeAudit} from '/path/to/attribution-audit/scripts/execute-audit.mjs';
const result = await executeAudit(freshInput, {
  skillRoots: {
    'channel-taxonomy':'/path/to/installed/channel-taxonomy',
    'capi-match-keys':'/path/to/installed/capi-match-keys'
  }
});
```

`freshInput` must be the full exact schema; this is an importable API, not a JSON stdin CLI. Run `node scripts/test-execute-audit.mjs`. The runner accepts `--skill-roots ROOTS_JSON` and `--report NEW_OUTPUT_JSON`; its repository-default roots are only a verification convenience. It copies selected actual sources to independent temporary installs and calls the host. Full expected native outputs are literal independent goldens, never runtime producer data. Dynamic provenance is verified by exact hashes, schemas, actual function counts, source copies and cleanup checks; no runtime timestamp is invented to make an entire envelope constant.

Evidence and a guide copy are saved in Downloads. The test boundary is real pure-JavaScript invocation and composition, not SQL/Python/PostgreSQL/provider/network/model execution. Accepted upstream implementations and composer remain unchanged. Registry additions now include the actual installed shared BigQuery helper for the seventeen SQL routes; composition fixture source-hash expectations were updated mechanically. The one obsolete SQL-unavailable JavaScript fixture now checks missing BigQuery configuration, with its empty native input/null output preserved.


## Original JavaScript verification boundary

The real invocation suite covers 23 full native-output goldens, including all nine JavaScript entrypoints and fourteen operation routes, an actual stage-to-conversion-preparation chain, partial source coverage, missing roots/adapters and failed-producer gating. It includes 26 structural rejection cases, nine special source/provenance checks and five executed host mutations. Full output expectations remain literal; dynamic runtime/provenance fields are separately verified rather than replaced with invented timestamps. Tests record returned runs, rejected requests and rejected mutants separately so failed attempts are not lost or counted as valid completions.

Special checks include an actual copied-root symlink escape and unreadable file, changed source hashes across separate snapshot URLs, synchronous caller mutation, and a deliberately pinned mutating installed-source variant whose real returned object is retained while its pre-call arguments remain unchanged. Those source variants live only in owned test copies and are restored; canonical installed modules remain byte-identical. The suite also proves that a bound boundary conflict after a successful producer retains the producer evidence, enters no consumer and cleans up before raising AuditPreflightError.

Recorded verification used Node 20.18.1. This is the observed synthetic test runtime, not a revision to upstream CAPI's documented Node 22+ installation recommendation. No SQL, Python, PostgreSQL, provider, network or model call occurred in this bounded suite. Native adapters and portable native end-to-end branches remain the next reviewed step.

The current combined-host regression also passed on Node 22.22.1. JavaScript and Python real local invocation counts remain unchanged; BigQuery host tests are explicitly mocked and execute no SQL. `fresh_upstream_calls` now adds only confirmed new BigQuery handles to JavaScript entries and Python process starts; read-only retrieval adds zero. Separate BigQuery observation/effect-accounting fields are defined in its execution contract.

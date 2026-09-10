# Local Python MMM audit invocation

Version 0.1.0. This extends the [fresh invocation host](execution-contract.md) with actual calls to the unchanged installed MMM command-line scripts. It performs no weekly aggregation, identity matching, coefficient calculation or assumption arithmetic itself. SQL, PostgreSQL, provider delivery and model adapters remain unavailable.

## API and supported routes

Import `executeAudit(input,{skillRoots,pythonExecutable})` from `scripts/execute-audit.mjs`. `pythonExecutable` is optional for existing JavaScript callers and required to execute Python routes. If provided, it must be an exact absolute executable path. Input and options, including this selection, are captured synchronously before the first await; later caller changes cannot alter the invocation. Other option fields reject.

Use the existing exact fresh input/declaration/evidence/binding schemas. These three registry entrypoints add four operation enums:

| MMM registry entrypoint | Operation | Actual native JSON stdin |
| --- | --- | --- |
| `weekly_mlr` | `fit_weekly_mlr` | Invocation `input` directly to `scripts/weekly_mlr.py` |
| `response_curves` | `calibrate_and_scenario` | Exact `{regression_result,scenario}` to `scripts/response_curves.py` |
| `framing` | `compare_shares` | `{operation:'compare_shares',input:<invocation input>}` to `scripts/framing.py` |
| `framing` | `project_bands` | `{operation:'project_bands',input:<invocation input>}` to `scripts/framing.py` |

`operation` selects a reviewed native CLI route; it is not executable code or an arbitrary function name. The artifact/preflight input for framing remains the bare native function input. Only its retained transport wraps `{operation,input}`. The frozen composer checks the actual known `config`, `regression_result.config`, `scenario_result.config` and output configuration paths against the declared audit report boundary. No second report-boundary or MMM engine is introduced.

A complete explicit chain binds the entire actual weekly result into the response invocation's existing null `/regression_result` placeholder, then binds the response output's `/scenario` into framing's existing null `/scenario_result`. Supply baseline/proposed spend and assumption multipliers explicitly. `depends_on` and input evidence references must identify each direct producer. All hashes and selected values derive from actual parsed stdout, never fixture expected output. A guarded regression is still a successful execution; insufficient input propagates through actual curve/scenario/band guards without being promoted to fitted or causal evidence.

## Interpreter, source and dependency isolation

The host reuses the allowlisted source snapshot and exact expected-source-hash verification of the JavaScript host. It executes each unchanged Python script from that private snapshot with argv `['-I','-B',absolute_snapshot_script]`, JSON stdin, `shell:false` and `PYTHONDONTWRITEBYTECODE=1`. Python isolated mode ignores ambient Python import-path customization; no bytecode is written. Only PATH and the bytecode setting are passed as environment variables. The selected interpreter remains the caller's installed runtime, not a copied or authenticated interpreter distribution.

Before the first needed Python invocation, one local runtime probe records `sys.executable`, Python version and NumPy version if installed. The exact probe argv, raw stdout/stderr, exit/signal and hashes are retained separately as `run_provenance.python_probe`; its process is excluded from upstream-call counts. No installation, environment dump or provider/network request occurs. NumPy is required by weekly regression; response curves and framing use the standard library. An isolated interpreter without NumPy may still execute those standard-library routes.

| Condition | Execution / reason |
| --- | --- |
| No explicit interpreter | unavailable / `python_interpreter_not_configured` |
| Missing executable, including disappearance before native launch | unavailable / `python_interpreter_missing` |
| Probe cannot start for another reason | failed / `python_interpreter_unreadable` |
| Probe exits unsuccessfully or cannot yield parsed runtime metadata | failed / `python_runtime_probe_failed` |
| Weekly regression with no NumPy | unavailable / `python_numpy_unavailable` |
| Other native process start failure | failed / `python_process_start_failed` |
| Started native process exits nonzero or by signal | failed / `native_invocation_failed`; native output/hash null |
| Exit zero with valid native guarded result | succeeded; full native object unchanged |
| Exit zero with malformed/contradictory output | `AuditPreflightError`, authentic transport/output evidence retained |

Missing/unreadable/mismatched installed sources retain the existing source failure categories and prevent process start. Every declared producer dependency gates consumption regardless of whether that producer is globally required. A failed optional producer cannot authorize a dependent process. A later bound boundary contradiction preserves the completed producer's authentic provenance, starts no consumer, returns no partial-success audit and cleans the snapshot before rejecting.

## Process evidence and counts

Python call records add `adapter_kind:'python_cli'`, `process_started` and `invocation_started`. `function_entered` is null because subprocess launch does not establish that an internal function was entered. `function_name` identifies the selected route, not observed internal execution. JavaScript retains its original boolean `function_entered` and adds `adapter_kind:'javascript'`, `process_started:false`, and `invocation_started` equal to actual function entry.

`fresh_upstream_calls` is actual selected JavaScript function entries plus actual selected Python process starts, including started processes that fail. Runtime probes, imports, preflight and nested function calls are excluded. Inner composition remains honestly `artifact_composition` with zero fresh calls. Processes and composition are awaited before deleting the exact owned source snapshot.

Each started Python call retains `python_runtime` and `python_transport`: explicit executable/argv, exact serialized JSON stdin and byte SHA256, raw stdout/stderr and byte SHA256, process-start flag, exit code/signal/error category, and start/end timestamps. The call separately retains canonical resolved native input/hash and parsed output/hash. Framing's CLI wrapper hash can therefore differ from the bare native artifact input hash without ambiguity. Successful stdout is parsed and captured without coercing numeric, string, boolean or null values. Exit-zero native results are not rewritten as quality findings. Artifact runtime identifies the observed Python version; it does not invent native function entries or warehouse jobs.

Runtime evidence is private and may contain the caller's input/output and native error text. Retain it with the audit evidence rather than treating a compact status as a substitute. Source hashes establish executed snapshot byte integrity, not interpreter authenticity or causal validity.

## Run and verification boundary

No runtime installation is performed by the host. Install the MMM skill's declared NumPy requirement (`numpy>=2.1,<3`) into an explicitly selected interpreter when using weekly regression. Tested here: Python 3.14.2 with NumPy 2.4.4, driven by Node 20.18.1. These are observed test versions, not broader support claims.

```js
import {executeAudit} from '/path/to/attribution-audit/scripts/execute-audit.mjs';
const result = await executeAudit(freshInput, {
  skillRoots: {'mmm-and-incrementality-framing':'/path/to/installed/mmm-and-incrementality-framing'},
  pythonExecutable:'/absolute/path/to/python3'
});
```

From this skill root:

```sh
node scripts/test-execute-audit-python.mjs --python /absolute/path/to/python3 --report /absolute/path/to/new-evidence.json
node scripts/test-execute-audit.mjs
```

The Python runner copies current pinned sources into independent explicit install roots; it does not call test runners as native producers. Its four literal golden runs compare eight full native outputs: complete regression→curves→bands, missing-week guarded regression→curves→bands, observational share factors, and shares with unknown money. Pipeline arithmetic was authored before native execution: `y=2+3x`, historical mean spend 1.5, curve parameters 18 and 1.5, explicit spend 1.5→4.5 produces response 9→13.5 and delta 4.5; explicit .5/1.5 multipliers give 2.25/6.75. This is a synthetic local-calibration assumption test, not estimated causal lift. Expected regression/share/guard structures have pinned accepted fixture derivations. Numeric tolerances are the unchanged module fixture tolerances; strings/nulls, keys, array lengths and ordering compare exactly.

Twelve additional checks, four structural rejections and two executed host mutations verify actual stdout→parsed producer→binding→consumer stdin/hash, copied installs and cleanup, missing interpreter/NumPy, standard-library framing without NumPy, source-hash gating, nonzero native exit, optional-producer gating, caller mutation isolation and a bound boundary contradiction after a real producer. The mutation tests substitute a literal expected output and bypass dependency gating; both are rejected by the actual pipeline checks. Failed/rejected attempts retain real process evidence and are counted separately from successful golden completions.

The unchanged JavaScript 23-golden/26-structural/9-special/5-mutation suite is rerun after host changes. Its prior evidence remains historical and unchanged; new reports identify the extended host hash. No broad rerun of unchanged upstream numeric suites or native SQL evidence is claimed. SQL/PostgreSQL adapters and native warehouse end-to-end verification await their separate reviewed step.

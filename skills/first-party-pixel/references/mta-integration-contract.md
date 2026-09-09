# Explicit identity-to-MTA handoff

`prepareMtaInputs({ identity_input, configuration, conversions, conversion_evidence_ref },
{ identitySkillRoot })` calls the actual [identity projection](identity-projection-contract.md)
and prepares the exact three inputs consumed by the unchanged native BigQuery credit ledger.
It performs transport validation and explicit precision checks, not attribution, classification,
calendar arithmetic, a second identity rule or a second touch deduplication pass.

The full identity projection remains unchanged in the result, including suppression, exclusions,
shared-device ambiguity and unresolved evidence. Every emitted projection touch enters MTA input;
ambiguous/unresolved touches keep three NULL subject fields. `native_contact_id`, visitor IDs and
bare keys never supply missing subjects. The adapter executes no database or BigQuery jobs itself.

## API and invocation capture

```js
import { prepareMtaInputs } from './scripts/prepare-mta-inputs.mjs';
const prepared = await prepareMtaInputs({
  identity_input,        // Exact projectIdentity input, with explicit bindings and evidence.
  configuration,         // Exact credit-ledger configuration below.
  conversions,           // Explicit qualified native conversions and qualified subjects.
  conversion_evidence_ref: 'retained-conversion-source-reference'
}, { identitySkillRoot: '/absolute/path/to/installed/clickstream-identity-stitching' });
```

Input must be plain finite JSON: no accessors, cycles, sparse/extra array properties, functions,
symbols or nonplain objects. Null-prototype records are accepted. The adapter synchronously copies
all input data and captures the explicit dependency-root primitive before its first await. Later
caller changes cannot alter the validated invocation. Caller objects are never frozen or mutated.
There is no inferred sibling dependency root, network install, credential or persistence behavior.

`identity_input` must satisfy the existing projection contract, including current contact snapshot
limitations and explicit source/scope bridges. Its `config.invocation_key` and **original** `as_of`
text must exactly equal the MTA configuration. Equivalent timestamp spellings do not excuse a
mismatched invocation. Snapshot `as_of` cannot reconstruct historical contact attestation state.

## Exact native transport shapes

Configuration requires exactly:

```text
invocation_key, report_timezone, report_start_date, report_end_date, as_of,
requested_lookback_days, min_lookback_days, max_lookback_days,
half_life_days, conversion_window_mode
```

Text fields are exact nonempty strings. Lookback fields are finite safe integer JavaScript Numbers
or plain integer strings with optional minus and digits, without whitespace/exponent notation.
`half_life_days` is a finite Number. Native SQL owns positivity, INT64 range, min/max relationships,
lookback clamping, timezone/date validity, conversion window modes and credit assertions. The
adapter does not supply defaults or duplicate those ledger rules.

Each conversion requires exactly:

```text
invocation_key, source_system, source_scope, conversion_key, occurred_at,
subject_source_system, subject_source_scope, subject_key,
value, currency, value_status
```

Its invocation must equal configuration. Native source/scope/key and non-NULL subject components
must be exact nonempty, already-trimmed strings. The subject triple is either entirely NULL or
entirely populated. The caller must supply evidence for that qualified bridge; no native contact,
visitor or unqualified-key fallback occurs. Identical bare conversion keys in different source
systems/scopes remain distinct. No conversion is dropped, deduplicated or defaulted in this adapter.

`value` is NULL or an exact plain decimal string: optional minus, digits, optional decimal point
followed by digits. Numbers, exponent notation, plus signs and whitespace are rejected. At most
nine fractional digits are supported; more produce `unsupported_decimal_precision`, including
redundant trailing zeros. This intentionally simple boundary prevents silent NUMERIC rounding.
Native NUMERIC CAST retains range validation. Currency is NULL or a string; value status is a
string. Native SQL owns permitted status/currency combinations. Known zero stays known zero;
unknown and mixed values stay NULL with their original status/currency. There is no FX, automatic
currency, allocated revenue or conversion-money coercion through a JavaScript Number.

Each emitted touch has exactly the ledger `touch_input` fields:

```text
invocation_key, source_system, source_scope, touch_key, visitor_key, occurred_at,
channel, taxonomy_version, subject_source_system, subject_source_scope, subject_key
```

Additional source fields and identity statuses stay in the full projection rather than leaking
into the strict ledger transport. Native SQL owns duplicate/conflict and attribution validation,
including its source/scope/touch-key uniqueness boundary. The wrapper neither merges business
duplicates nor changes qualified keys to avoid an assertion failure.

## Explicit microsecond compatibility boundary

The graph accepts original timestamps with up to nine fractional digits; BigQuery TIMESTAMP
represents microseconds. Supported transport has four-digit year, two-digit month/day and
`HH:MM:SS`, uppercase `T`, optional 1–9 fractional digits, and uppercase `Z` or signed
`HH:MM` offset. Check this lexical shape before fraction inspection. Space-separated, naive,
lowercase-zone, variable-width and other broader native CAST spellings are not supported.
This shape check does not decide Gregorian, range or offset validity. Inspect fractional seconds on **every emitted touch**, **every raw
conversion** (even future/out-of-report conversions), and `as_of` before native submission:

- Up to six fractional digits: preserve the original string unchanged.
- Seven through nine digits with only zeros after digit six: remove only those redundant zeros
  in native input. Preserve both original and native strings in timestamp evidence.
- Any nonzero digit after digit six: reject with
  `unsupported_timestamp_precision`. More than nine digits fail the lexical transport check.
  Never round, truncate nonzero evidence or run a job anyway.

These are lexical and fractional-string checks, not a calendar parser or temporal comparison. Actual graph
validation owns identity/touch/as-of calendar rules; native CAST and SQL assertions own conversion,
report date and native timestamp validity. A precision-compatible string is not thereby proven
calendar-valid. Nonzero nanoseconds on identify observations alone are permitted because those
observations are not TIMESTAMP inputs to the ledger. Suppressed/excluded touches remain visible in
projection and are not secretly resubmitted as native rows.

For example, `.123456000Z` projects to `.123456Z`; `.123456001Z` fails explicitly. A touch one
nanosecond after a conversion must never become an anchor-time eligible touch by truncation.
If a source is not representable, obtain genuinely microsecond source evidence and make an explicit
new invocation. Do not relabel silently truncated nanoseconds as original source evidence.

## Exact output

```text
contract_version: "0.1.0"
projection: full unchanged projectIdentity result
input:
  configuration: exact ledger configuration with native as_of spelling
  touches: every projected touch in exact ledger transport shape
  conversions: every caller conversion in exact transport shape
evidence_refs:
  snapshot_evidence_ref
  external_contact_evidence_ref (NULL or caller reference)
  conversion_evidence_ref
timestamp_evidence:
  as_of: { original, native }
  touches: [{ source_system, source_scope, visitor_key, touch_key, original, native }]
  conversions: [{ source_system, source_scope, conversion_key, original, native }]
```

Evidence preserves original timestamp spelling and qualified identities. Conversion monetary
strings remain byte-identical in native input. Retain the caller source alongside its evidence
reference; output is a prepared transport, not a durable archive or job receipt.

## Actual native verification

Offline adapter verification submits no warehouse jobs:

```sh
node skills/first-party-pixel/scripts/test-mta-integration.mjs
```

Owned loopback collector/PostgreSQL plus native BigQuery ledger verification requires an explicit
billing project and existing configured BigQuery access:

```sh
node skills/first-party-pixel/scripts/test-mta-integration.mjs \
  --native --project YOUR_BILLING_PROJECT --location US
```

The wrapper removes inherited `DATABASE_URL`, and the opt-in roundtrip rejects an existing database.
Direct opt-in uses `PIXEL_MTA_PROJECT=YOUR_BILLING_PROJECT` with
`env -u DATABASE_URL bash scripts/roundtrip.sh --mta-integration`. It never chooses a billing project
from production data. The runner uses actual HTTP source events, the accepted snapshot reader,
actual projection/identity engines and the unchanged separately installed MTA SQL. Only the fixed
`REPLACEABLE INPUTS` section is rendered with explicit STRING/DATE/TIMESTAMP/INT64/FLOAT64/NUMERIC
casts. All BigQuery tables are temporary. Standard SQL, disabled cache and a 1 GiB per-job cap are
recorded and checked from native job metadata. No customer tables, hosted deployment or model calls
are involved. The ledger is a correctness test, not an attribution-causality or scale claim.

Native source fixtures include two real pageviews half a day apart, an explicit CRM-only binding,
shared-device A/B evidence and an unresolved visitor. Identify observations retain nonzero
nanoseconds. Four actual captured conversion rows cover known zero, unknown with retained USD,
mixed currency and unresolved subject. The test's explicit subject/status fields were supplied in
synthetic source-event properties and read back with the corresponding native conversion UUID,
original timestamp, NUMERIC value string and currency. This is transparent fixture provenance,
not a general rule for trusting arbitrary event metadata or inferring a bridge from a visitor.

Full independently specified ledger, coverage and diagnostics goldens require all five models.
Three resolved conversions each use the two eligible touches: decay weights are 1/3 and 2/3,
position weights .5/.5, and zero first/last rows remain present. The unresolved conversion has five
coverage rows and no ledger row. No-binding and cross-catalog ambiguity retain no-eligible and
unresolved statuses, without inventing Direct touches or subjects. Raw native UUIDs are retained;
a declared label map permits readable full expected-output comparison without changing production
keys or ordering semantics.

Controlled native tests mutate a qualified subject scope (destroying eligibility) and bypass the
partial-subject transport guard (the unchanged SQL rejects it). A separate actual source touch
one nanosecond after its conversion is rejected by the correct adapter before any job; an executed
rounding mutant wrongly creates five credited native rows. That native result demonstrates why
the precision boundary is required, not accepted credit. Exact copied pixel/identity/MTA directories
produce the same prepared inputs and query; an actual read-only job retrieval rechecks the full
standalone output.

Eight literal full adapter goldens include matched/shared/unresolved/no-binding/CRM-only behavior,
known-zero/unknown/mixed/exact-decimal values, same bare conversion keys across sources, six-digit
precision, redundant nine-digit zeros and nonzero observation nanoseconds. Additional tests cover
malformed/non-ISO transport, all-or-none subjects, excessive decimal precision, immediate caller mutation,
accessors, explicit dependency roots and copied installations.

## Evidence and read-only resume

The runner saves complete HTTP payloads, PostgreSQL queries/results/snapshots, source identity input,
full prepared projection, rendered SQL, full ledger output, native job metadata/errors, byte counts,
source/fixture hashes and labels in timestamped Downloads evidence. Failed jobs remain errors; they
are never converted into synthetic unknown findings. Interrupted reports retain job handles.

To recheck recorded jobs without creating a database or submitting another job:

```sh
node skills/first-party-pixel/scripts/test-mta-integration.mjs \
  --resume-report /absolute/path/to/prior-evidence.json \
  --project YOUR_BILLING_PROJECT --location US \
  --report /absolute/path/to/new-read-only-evidence.json
```

Resume requires identical current source/fixture hashes, project, location and recorded query
bytes. It retrieves native job metadata and completed results and compares full current goldens.
It never overwrites the original report or resubmits missing/failed work automatically. Review any
native failure before explicitly authorizing a changed source invocation or a new job. Test-owned
collector/PostgreSQL and temporary dependency copies are cleaned up, with a separate cleanup audit.
Metrics, allocated value, spend reconciliation and reporting remain separate work after this ledger
handoff; no claim about that later chain is made here.

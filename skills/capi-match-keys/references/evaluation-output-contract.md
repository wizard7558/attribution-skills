# Evaluation projection contract

This is a deterministic projection of the accepted public helpers and native outbox behavior,
not a replacement producer API. Return one JSON object. Preserve outer case labels and case
order exactly as supplied, and preserve request order within each case. Do not include prose,
extra keys, fixture names, provenance, or unrequested identity fields. Missing is different from
null. Every projected property is required; nullable properties must be explicit null.

The input `sha256_oracle` is a trusted cryptographic utility table of exact UTF-8 preimages and
lowercase SHA-256 digests, supplied identically to both evaluation conditions. It includes
plausible alternative preimages. Select the correct normalization or business-ID tuple using the
contracts, then look up its digest. Do not choose a preimage based on table position or infer a
provider label from it. Scoring checks selection and semantics; it does not claim the model
computed cryptographic digests unaided. The actual helper tests separately validate SHA-256.

## Keys

Output `{cases:[{case,results:[result,...]},...]}`. For each ordered identity request, return
exactly `{operation,platform,kind,normalized,hash,error}`. `operation` is `identity`; platform
and kind echo input. `normalized` and `hash` are exactly the results of
`normalizePlatformIdentity` and `hashPlatformIdentity` on the same raw value. Null normalized
identity implies null hash; otherwise hash is lowercase SHA-256 of the normalized UTF-8 bytes,
not of a JSON string and not a second hash. `error` is null unless the helper throws TypeError,
in which case both results are null and `error` is `TypeError`. Unsupported enums throw;
malformed raw identity normally returns null instead. These keys are provider matching
representations, never evidence to merge canonical people. The projection does not perform
an identity-graph join.

For each ordered FBC request, return exactly `{operation,value,error}` with `operation: "fbc"`.
Call `buildMetaFbc(input)`; retain the resulting string or null as `value`, with null error.
On TypeError return null value and `error: "TypeError"`. Do not include variable exception text.
A valid existing cookie wins before capture validation. Missing/unusable click does not fabricate
a cookie; malformed explicitly supplied existing cookie is an error. See the key contract for
normalization distinctions, calendar/capture rules and exact existing-cookie preservation.

## Conversions

Output `{cases:[{case,results:[{operation,result},...]},...]}`. Each operation is exactly the
supplied public function name: `conversionFromStage`, `prepareConversion`, or `makeConversionId`.
`result` is the complete native public return, with no fields dropped or added. For the ID
function it is a string. Status/reason vocabulary, exact projection fields, qualified ordering,
known/unknown/mixed money, decimal string preservation, and inclusive instant boundaries are
fully defined by the conversion contract. This interface does not conflate undated,
not-achieved, unknown or nonprimary stages, and does not override the provider event ID with
the separate business identity. Selection and exclusion order follow that contract; input row
order is not a substitute for qualified tie-breaking. An ineligible event retains diagnostics.

## Delivery

Output `{cases:[{case,result},...],review:{...}}`. Each case calls the builder corresponding to
its explicit platform using the full raw input. Project exactly:

```text
result = {status, reasons, destination, body, diagnostics}
```

`status`, `reasons`, `destination`, and `diagnostics` copy the actual builder result.
`body` copies `payload.request.body` when ready and is null when blocked. This is a JSON object
projection, not a serialization challenge: object-key order is irrelevant, array order and
cardinality are exact. Include only the actual provider fields and nested structures. No raw
identity is permitted in the body. Monetary numbers are finite JSON numbers; preserve strings
where the provider contract uses decimal text. Full public request URL/headers/authorization
are outside this projection, though the builder and outbox contracts still govern routing.

The `review` summarizes the supplied native operation sequence and uses exactly these fields:

- `replay_disposition`: native enqueue disposition (`inserted` or `replayed`) for the specified
  unchanged repeat. `replay_adds_audit`: whether that repeat adds an audit row.
- `conflicts`: ordered `{change,code,preserves_row,preserves_audit}` records for supplied same-domain
  changes. `change` echoes input (`business_conversion_id`, `provider_event_id`, `request_body`).
  `code` is the native SQLSTATE string or null when no error occurred. The general native
  conflict SQLSTATE is `P0001`: changing accepted body or either identity in the same domain
  conflicts and preserves existing data. The preservation flags
  compare the complete row and ordered audit before/after, not only the identity fields.
- `blocked_rollback` and `post_enqueue_rollback`: each exactly
  `{business_restored,outbox_restored,audit_restored}`. Each compares committed before/after state
  for its explicitly rolled-back transaction. A blocked bridge throws `capi_payload_blocked`
  before SQL; a later injected failure does not auto-commit the enqueue.
- `claim_transaction_open_during_send`: whether a transaction remains open during the specified
  send after claim commit. `retry_uses_stored_bytes`: whether the worker must use the persisted
  original request text as UTF-8 bytes, rather than rebuilding mutable inputs.
- `attempt_tokens`: ordered integer tokens of the supplied fresh claim and reclaim. Tokens start
  at zero before any claim and increase by one per claim. `stale_completion_applied` reports the
  old worker/token completion's native applied Boolean. A stale token never wins a newer claim.
- `audit_actions`: ordered native actions for the successful enqueue/claim/retry/reclaim/success
  sequence, excluding separately rolled-back trials and rejected conflicts. Vocabulary is
  `enqueued`, `claimed`, `retry`, `succeeded`, `permanent_failure`, `lease_expired`; rejected
  stale completion adds no action. `final_state` is the native terminal state, not an inference
  about remote ingestion.
- `persisted_request_parts`: ordered names of the requested persisted pieces, filtering the
  supplied `request_parts` list. The accepted SQL stores `destination`, `business_conversion_id`,
  `provider_event_id`, `request_body`. It does not store `url`, `headers`, `authorization`, or
  `api_version`. Keep immutable routing and credentials outside this body-only outbox.
- `provider_acceptance_proven`: whether the supplied local-loopback test proves actual provider
  acceptance. Local transport, storage, token fencing and controlled stub responses establish
  only their tested local behavior, never remote matching/ingestion or exactly-once delivery.

The review is an evaluation projection over the supplied scenario, not a new SQL function or
provider-response classifier. A 503-to-retry and 200-to-success classification is explicitly
supplied for the synthetic loopback scenario only. Other provider responses and ambiguous
outcomes require their own authorized classification/reconciliation.

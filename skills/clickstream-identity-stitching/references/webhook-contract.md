# Webhook stitching and receipt contract

## Scope and API

`resolveWebhookStitch` in `scripts/webhook-stitch.mjs` is a synchronous, pure resolver for an **already verified adapter submission**. The caller authenticates the provider webhook, verifies its signature and consent, and supplies capture-source context before calling it. This module does not receive HTTP requests, write a database, create contacts, send conversions, or call an external service.

```js
resolveWebhookStitch({
  submission, visitors: [], page_rule_events: [],
  recent_identity_edges: [], receipts: [], policy,
});
```

All input, including arbitrary metadata, must be JSON-compatible plain data. Dense arrays and plain objects with ordinary or null prototypes are accepted. Nonfinite numbers, undefined, nonplain objects, sparse arrays, cycles, symbols, accessors, and extra array properties are rejected. Required keys are nonempty exact strings without surrounding whitespace. Timestamps must be calendar-valid ISO strings with an explicit timezone; arithmetic uses JavaScript millisecond precision.

| Input | Required fields | Optional fields and meaning |
|---|---|---|
| `submission` | `source_system`, `source_scope`, `provider`, `submission_key`, `occurred_at` | `visitor_key`, `page_rule_event_key`, `email`, `phone`; null or absent means unavailable |
| `visitors[]` | `source_system`, `source_scope`, `visitor_key`, `last_seen_at` | Caller-owned snapshot of known visitors |
| `page_rule_events[]` | `source_system`, `source_scope`, `visitor_key`, `page_rule_event_key`, `event_at` | Exact event correlation from a verified capture adapter |
| `recent_identity_edges[]` | `source_system`, `source_scope`, `visitor_key`, `evidence_key`, `evidence_at` | At least one non-null `email_hash` or `phone_hash`, each lowercase 64-character SHA-256 hex |
| `receipts[]` | `receipt_key`, `payload_sha256`, `resolution` | Previously persisted resolver receipts; strict output schema below |
| `policy` | `page_rule_window_minutes`, `recent_visitor_window_minutes`, `confidence` | Exactly these fields; windows are finite nonnegative minutes |
| `policy.confidence` | `visitor_field`, `page_rule`, `recent_visitor`, `new_visitor` | Exactly these fields; finite scores in `[0, 1]` |

Example policy:

```json
{
  "page_rule_window_minutes": 10,
  "recent_visitor_window_minutes": 30,
  "confidence": {
    "visitor_field": 1,
    "page_rule": 0.8,
    "recent_visitor": 0.8,
    "new_visitor": 0
  }
}
```

Confidence values are configured operational scores, **not calibrated probabilities**. A missing policy or confidence entry is rejected. Email and phone use the [shared local identity primitives](identity-contract.md); non-null malformed or empty identities are rejected, even if an earlier ladder method would otherwise match. An identity hash has no scope embedded in it: scope authorization is separate.

Visitors dedupe on `(source_system, source_scope, visitor_key)`, page events on `(source_system, source_scope, page_rule_event_key)`, and evidence on `(source_system, source_scope, visitor_key, evidence_key)`. Identical rows collapse. Conflicting rows under a key are structural errors, including a page event key assigned to two visitors. Inputs are validated before replay or method selection; an unused malformed row is still rejected. Arbitrary metadata is ignored for resolution and never copied to output.

## Resolution ladder

Evaluate these methods in order, stopping at the first successful match:

1. **`visitor_field`**: the supplied visitor key must exist in the exact submission capture system/scope. Existence is sufficient for this explicit method; the recent-visitor window does not apply. An explicit unknown or other-site key records `visitor_field_unknown` and continues.
2. **`page_rule`**: the exact supplied page event key must resolve to one known visitor in the exact capture scope. `event_at` must lie in the inclusive interval `[submission.occurred_at - page_rule_window_minutes, submission.occurred_at]`. No key gives no page-rule attempt. Missing, old/future, or unknown-visitor events record `page_rule_not_found`, `page_rule_out_of_window`, or `page_rule_unknown_visitor`. A URL, IP, or approximate page visit is never a correlation key.
3. **`recent_visitor`**: union all known qualified visitors whose established evidence matches at least one submission identity hash in the exact capture scope. **Both** the edge's `evidence_at` and the visitor's `last_seen_at` must lie in the inclusive recent window ending at the submission. Future evidence or activity does not qualify. Exactly one visitor matches; multiple visitors record `recent_visitor_ambiguous` with a sorted, qualified candidate list and continue. Never select an arbitrary newest candidate. No candidates records `recent_visitor_no_match`; no submission identity records `identity_unavailable`.
4. **`new_visitor`**: return a new deterministic visitor key without inferring earlier behavior:

   ```text
   "webhook_" + SHA256(JSON.stringify([
     source_system, source_scope, provider, submission_key
   ]))
   ```

The new visitor can subsequently receive an explicit identify observation using the verified submitted identity. Creation by itself creates no graph contact, touch, historical session, or conversion credit. A webhook resolving a visitor also does not resolve that visitor's contact ownership: a shared-device graph touch can remain ambiguous.

## Output and replay

```js
{
  receipt_key: '["pixel","site","form","submission-1"]',
  payload_sha256: '64 lowercase hex characters',
  replayed: false,
  resolution: {
    status: 'matched', // or 'created' only for new_visitor
    visitor: { source_system: 'pixel', source_scope: 'site', visitor_key: 'v1' },
    method: 'recent_visitor',
    confidence: 0.8,
    diagnostics: [],
  },
  receipt: { receipt_key, payload_sha256, resolution },
}
```

The receipt's resolution is a separate value copy of the top-level resolution. Returned receipts use a strict schema, validate qualified scope, status/method, confidence, diagnostic shapes, and the deterministic new-visitor key. A caller must treat its durable receipt store as trusted application state; a hash is a fingerprint, not an authentication signature for arbitrary client-supplied receipts.

The receipt identity is `(capture source_system, capture source_scope, provider, submission_key)`. Reusing a bare provider submission ID in another scope or provider is not a duplicate. Identical stored receipt rows collapse; conflicting receipt rows reject.

`payload_sha256` fingerprints a recursively key-sorted object containing the submission's required keys, UTC-normalized timestamp, optional visitor/page event keys normalized to null, canonical email/phone hashes normalized to null, and the complete policy. Thus a change to any resolution-relevant submission field or policy causes a conflict under the same receipt key. Equivalent canonical identity spelling or timezone representation replays. Arbitrary metadata and candidate snapshots are excluded: visitors, events, and graph edges may change after the original receipt was committed.

A matching receipt fingerprint returns the validated **original resolution**, with `replayed: true`, even if the original candidate is no longer in the supplied visitor snapshot. The original status remains `created` when that original resolution created a visitor; `replayed` tells the caller that it must not create another visitor or identify. Same key with a different fingerprint throws `conflicting receipt payload`. Changing policy under an existing receipt deliberately conflicts; perform an explicit versioned repair or new business operation rather than silently re-resolving a transport retry.

Outputs never include raw email, phone, IP, URLs, or arbitrary input metadata. Caller-supplied keys must themselves be opaque non-PII identifiers. Identity hashes and qualified IDs remain pseudonymous data and need appropriate access and retention controls. This resolver's hashes are not outbound advertising-platform CAPI normalization.

## Graph adapter and integration

Only project **established `graph.edges`**, never unresolved or ambiguous `graph.observations.candidates`. Preserve every source qualifier and the evidence hashes; never fabricate an edge from IP, proximity, an unverified provider user ID, or a newest-contact guess.

```js
import { buildIdentityGraph } from './scripts/identity-graph.mjs';
import { resolveWebhookStitch } from './scripts/webhook-stitch.mjs';
import { canonicalizeEmail } from './scripts/identity-primitives.mjs';

const graph = buildIdentityGraph(graphInput);
const recent_identity_edges = graph.edges.map((edge) => ({
  source_system: edge.source_system,
  source_scope: edge.source_scope,
  visitor_key: edge.visitor_key,
  evidence_key: edge.edge_key,
  evidence_at: edge.occurred_at,
  email_hash: edge.evidence.email_hash,
  phone_hash: edge.evidence.phone_hash,
}));
const result = resolveWebhookStitch({
  submission, visitors, page_rule_events, recent_identity_edges, receipts, policy,
});
// Inside the caller's transaction, and only on first successful processing:
if (!result.replayed && submission.email != null) {
  const identify = {
    ...result.resolution.visitor,
    observation_key: `submission:${result.receipt_key}`,
    occurred_at: submission.occurred_at,
    email: canonicalizeEmail(submission.email),
  };
  // Persist the identify under its scoped unique key; then replay the graph.
  // Supply phone similarly when verified and available. This snippet does not write.
}
```

An explicit identify for another device may match the same qualified CRM contact. It can backfill that device's observed touches using the graph's edge-anchored lookback; it cannot synthesize earlier touches. Multiple established contacts for one visitor preserve global shared-device ambiguity. `scripts/test-webhook.mjs` executes the primitives → graph → adapter → webhook path and subsequent identify → graph backfill, retry, cross-device, and shared-device cases.

## Caller-owned durable persistence

An in-memory resolver and receipt array cannot promise crash-proof exactly-once delivery. Persist receipts and their effects atomically. For example, a PostgreSQL receipt table can use:

```sql
CREATE TABLE webhook_stitch_receipts (
  source_system text NOT NULL,
  source_scope text NOT NULL,
  provider text NOT NULL,
  submission_key text NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  resolution jsonb NOT NULL,
  PRIMARY KEY (source_system, source_scope, provider, submission_key)
);
```

Use matching qualified unique constraints for visitors `(source_system, source_scope, visitor_key)` and identify observations `(source_system, source_scope, visitor_key, observation_key)`. The table columns reconstruct the receipt's JSON array key; do not join by only `submission_key`.

Transaction pseudocode:

```text
begin serializable transaction
  read receipt by all four key columns
  read the verified, scoped visitor/event/established-edge snapshots
  resolveWebhookStitch(..., receipts=[existing receipt when present])
  if replayed:
    commit and return prior result; enqueue no effects
  if resolution.status == created:
    insert qualified visitor with deterministic visitor key
  insert explicit identify, if identity was supplied, with stable scoped observation key
  persist receipt and any authorized business effects / transactional outbox records
commit
on uniqueness race or serialization failure:
  roll back the whole transaction and retry from receipt read with bounded retries
on conflicting normalized receipt payload:
  reject for operator reconciliation; do not overwrite the original resolution
```

A uniqueness race is safe only when the losing transaction rolls back all its effects and reloads the winner's receipt. Do not write a receipt first and commit its effects later. Keep provider signature verification and authoritative scope selection outside this resolver.

Transport submission IDs and **business-event IDs are different**. Two delivery attempts may carry different transport IDs for the same order, appointment, or conversion. Persist an additional unique business-event key, such as `(source_system, source_scope, provider, business_event_id, event_type)`, derived from the provider's stable object/event identity. Verify semantic equality on conflicts. Use that stable business key for conversion deduplication and a transactional outbox; a consumer still needs its own idempotency handling. Do not manufacture business identity from visitor/time proximity.

## Verification

From this skill directory, run `node scripts/test-webhook.mjs`. The fixture file contains 30 complete golden resolutions. The runner also executes actual invalid JavaScript inputs and semantic receipt conflicts, compares full outputs under nontrivial permutations of every input array and object-key order, verifies input immutability and privacy, and rejects corrupted goldens through the same assertion used by successful fixtures. Counts printed by the runner reflect actual assertions and executed cases. These are local deterministic tests, not live webhook delivery or hosted database verification.

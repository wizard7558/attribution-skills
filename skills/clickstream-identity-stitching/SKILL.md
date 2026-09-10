---
name: clickstream-identity-stitching
description: Canonicalize first-party identity evidence, deduplicate source-scoped attribution touches, build a non-destructive identity graph, and resolve verified form webhooks with deterministic receipt replay. Use when connecting anonymous clickstream visitors to known CRM contacts or diagnosing cross-device, shared-device, late-arrival, and webhook attribution boundaries.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# Clickstream identity stitching

Use the local Node.js modules to make identity and attribution decisions reproducible. They take caller-owned records and return decisions; they do not authenticate webhooks, provision infrastructure, persist data, or send conversions.

## Choose the relevant contract

- For canonical identities, thirty-minute touch deduplication, Direct entry, or late arrivals, read [identity-contract.md](references/identity-contract.md) and use `scripts/identity-primitives.mjs`.
- For explicit contact bindings, observation evidence, cross-device backfill, or shared-device ambiguity, read [graph-contract.md](references/graph-contract.md) and use `scripts/identity-graph.mjs`.
- For verified webhook matching, graph-edge projection, and durable receipt integration, read [webhook-contract.md](references/webhook-contract.md) and use `scripts/webhook-stitch.mjs`.
- Preserve the source, channel, and downstream measurement boundaries in [channel-contract.md](references/channel-contract.md).

## Normalize identity without inventing evidence

Email normalization trims and lowercases but preserves dots and plus tags. Phone normalization requires an explicit `+` country code, removes supported formatting and trailing extensions, and never guesses a country from a national number. Invalid values return null in canonicalization primitives; graph and webhook inputs reject supplied malformed identities.

Hash valid canonical email/phone values with SHA-256 using `hashIdentity`. Hashes are pseudonymous identifiers, not anonymous data. The same canonical identity has the same digest across scopes, while authorization remains in separate source/scope bindings. Do not reuse these local identity rules as Google, Meta, LinkedIn, or other outbound CAPI normalization; use the destination's separately verified interface when that is the requested task.

Opaque source keys must not contain raw PII. Never join a bare visitor/contact ID globally, infer identity from IP or URL proximity, or emit raw email/phone or arbitrary metadata in graph/webhook outputs. Touch deduplication returns accepted clones with their raw fields retained, so protect those working records separately.

## Preserve touch journeys

Deduplicate attribution touches by qualified visitor and immediately preceding accepted signature: channel, bounded-decoded campaign, and click-ID names/opaque values. A repeated signature is suppressed only below thirty minutes; exactly thirty minutes is accepted. Suppressed events do not extend the original interval. Preserve different campaigns/click IDs and A → B → A journeys.

Accept Direct only as the first accepted attribution touch for a qualified visitor, including seeded history. This attribution rule does not redefine a collector's sessions or remove each new session's native landing evidence. An identical scoped touch key is idempotent; conflicting data under that key rejects. A new event older than supplied latest state requires a complete chronological replay, not an incremental shortcut.

## Build a non-destructive graph

Supply explicit bindings from `(visitor source_system, source_scope)` to `(contact source_system, source_scope)`. Union email and phone matches within authorized scopes. Exactly one qualified contact creates an immutable edge per observation; zero stays unresolved; multiple candidates stay ambiguous and create no edge. Never invent a contact from an unknown identifier or overwrite earlier evidence with the latest contact.

Project touches using `edge <= as_of`, `touch <= as_of`, and `touch >= edge - lookback_days`. The lookback bounds retrospective backfill before an identify, while an earlier edge can support later touches through `as_of`. Global visitor ownership uses all matched edges through `as_of`: more than one contact makes any touch with an eligible edge ambiguous with reason `shared_device`. No eligible edge leaves it unresolved. Global contact lists are ambiguity context; eligible evidence keys alone describe the touch's qualifying evidence. Ambiguous contacts receive no arbitrary attribution credit.

## Adapt existing identity sources explicitly

| Source | Preserve as native evidence | Required explicit bridge |
|---|---|---|
| GA4 export | Property/stream scope, `user_pseudo_id`, and optional `user_id` | A verified application identity mapping or identify observation linking the scoped visitor to a qualified known contact; `user_id` alone is not an email |
| PostHog | Project scope, distinct IDs, and verified identify/alias history | An adapter-authored observation with verified contact identity and a configured contact-scope binding |
| Segment | Workspace/source scope, `anonymousId`, `userId`, and identify event key/time | The verified identify event maps the scoped anonymous visitor to known contact evidence; never equate bare IDs across sources |
| Snowplow | Collector/app scope, `domain_userid`, `network_userid`, and identify evidence | Preserve which identifier is the visitor key and provide an explicit verified contact bridge; no inferred equivalence between ID types |

These are adapter contracts, not shipped vendor SDK connectors. Keep provenance, consent, and observation timestamps. Only established graph edges may become webhook `recent_identity_edges`; unresolved/ambiguous candidates are not evidence. The executable projection example is in the webhook contract.

## Resolve verified webhooks and persist receipts

Use the fixed ladder: known explicit visitor field → exact in-window page-rule event → one in-window visitor supported by matching established identity hashes → deterministic new visitor. The recent method requires both evidence time and visitor activity inside the configured window and excludes future data. Multiple recent visitors remain an ambiguity diagnostic and fall through to creation; never choose the newest by convenience.

Always supply explicit window and confidence policy. Example operational scores are `1`, `0.8`, `0.8`, and `0`; they are not calibrated probabilities. New visitor creation infers no earlier behavior, and identifying a visitor does not erase shared-device contact ambiguity.

Receipt keys contain capture system/scope, provider, and submission key. The fingerprint includes normalized semantic submission fields and policy. Identical retries return the original validated resolution with `replayed: true`; conflicting payloads reject. Persist the receipt, visitor/identify effects, and any outbox atomically under qualified unique constraints. On replay, enqueue no duplicate effects. Maintain stable business-event IDs separately from transport retries. Read the transaction recipe before adding durable storage; the pure module does not provide exactly-once delivery by itself.

## Verify locally

Run from the repository root:

```sh
node skills/clickstream-identity-stitching/scripts/test-primitives.mjs
node skills/clickstream-identity-stitching/scripts/test-graph.mjs
node skills/clickstream-identity-stitching/scripts/test-webhook.mjs
```

For a standalone installed copy, run `node scripts/test-primitives.mjs`, `node scripts/test-graph.mjs`, and `node scripts/test-webhook.mjs` from the skill directory. Imports stay within this skill and use only built-in Node.js modules.

Local tests include full graph/webhook goldens, scoped evidence, backfill boundaries, conflicting receipts, privacy, permutation invariance, input immutability, mutation guards, and a primitives → graph → webhook → identify → graph integration. They do not establish hosted delivery or database transaction correctness. The fixed three-group model manifest and offline verification are described in [eval.md](references/eval.md); live model evaluations and measured comparisons remain pending. Read the compact [identity decision reference](references/identity-quick-reference.md) and the shared [evaluation projection contract](references/evaluation-output-contract.md) for the declared evaluation context and output vocabulary.

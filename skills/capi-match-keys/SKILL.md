---
name: capi-match-keys
description: Prepare source-qualified conversion events, provider-specific match keys and exact payloads for Google, LinkedIn, Meta, TikTok and Reddit, then enqueue them transactionally for fenced delivery retries.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# CAPI match keys and conversion delivery

Use this skill to prepare business conversions for the five supported providers, preserve
provider-specific matching semantics, and connect exact request bytes to the native PostgreSQL
outbox. Pure helpers never send events, read credentials, infer identity joins, or read a clock.

Read the [implementation guide](references/implementation.md) for executable examples, then the
relevant exact contracts: [keys](references/key-contract.md),
[conversion preparation](references/conversion-contract.md),
[payloads](references/payload-contract.md) ([quick reference](references/payload-quick-reference.md)), [native outbox](references/outbox-contract.md), and
[provider bridge](references/provider-outbox-contract.md). The [canonical channel contract](references/channel-contract.md) preserves suite vocabulary;
channel labels never qualify an identity or click join. Provider assumptions and dated primary
sources are in [provider API evidence](references/provider-api-evidence.md).

## Workflow

1. Preserve source-system, source-scope and native conversion keys. Project an achieved native
   stage with `conversionFromStage`, or supply an explicitly qualified conversion. Never turn
   a lead, native user, IP address, email or channel name into an inferred cross-source person.
2. Declare `as_of`, positive `max_event_age_days`, positive `click_lookback_days`, and exact
   four-field conversion/click source bindings. Supply calendar-valid timestamps with offsets.
   The helpers compare exact instants, not local date strings; no report timezone is inferred.
3. Call `prepareConversion`. It uses qualified conversion references, explicit bindings,
   inclusive temporal bounds, and deterministic per-kind click selection. Preserve reasons,
   exclusions, both business/provider IDs, and any explicit browser `event_id` override.
4. Pass raw email/phone once to the selected provider builder with its exact configuration.
   Provider hashes are matching signals, not canonical identity-graph keys. Do not rehash
   prehashed inputs or double-decode opaque click values. Known zero remains known; unknown
   and mixed currency never become zero. Negative common money requires an adjustment route
   before the builders can submit it.
5. Within one caller-owned pinned transaction, write the business effect and call
   `enqueueProviderConversion(tx, platform, input)`. Propagate blocked errors to rollback.
   Accepted destinations and exact request bodies are immutable; changed accepted facts
   conflict instead of silently overwriting the event or minting a new identity.
6. Claim and commit before network I/O. Send only the stored UTF-8 request bytes. On retry,
   never rebuild from mutable inputs or the clock. Complete using the same destination,
   business ID, worker and attempt token. Reconcile ambiguous provider outcomes separately.

## Provider boundaries

- Meta preserves email dots/aliases and hashes phone digits without `+`; its FBC comes from
  the actual selected fbclid and that click's capture time. Website URL/user-agent requirements
  are explicit adapter policy. Existing-cookie handling is a separate key-helper API.
- Google removes Gmail/Googlemail local dots/aliases; LinkedIn preserves them. Both remove
  email whitespace. Google hashes E.164 phone including `+`; LinkedIn sends no phone hash.
- TikTok preserves email aliases and hashes E.164 phone including `+`. The builder uses
  `/open_api/v1.3/event/track/`, not the older pixel-track schema, and supports custom names.
- Reddit removes email local dots/aliases on all domains and hashes E.164 phone including `+`.
  Without a qualified selected rdt_cid, the builder omits any supplied URL to prevent provider
  URL fallback from introducing unqualified click evidence. Its exact seven-day age guard is
  separate from documented deduplication timing.

Google/LinkedIn destination event type is fixed `conversion`; their action/rule defines the
semantics. Meta/TikTok use the configured event name. Reddit uses a local JSON tuple of tracking
type and nullable custom name to avoid collisions. Account and destination ownership must be
established by the caller. Follow exact version, ID, source, consent and data-processing fields
in the payload contract; do not guess additional provider limits or current API availability.

The outbox stores body, domain and IDs, **not the full request envelope**. Keep routing URL,
API-version choice, public headers and authorization policy immutable for each destination,
and credentials outside the body/outbox. Local uniqueness and lease fencing do not establish
exactly-once provider delivery, match rates, deduplication, attribution or causal lift.

## Verification

From this standalone skill directory, with Node 22+:

```sh
node scripts/test-match-keys.mjs
node scripts/test-conversion-events.mjs
node scripts/test-provider-payloads.mjs
node scripts/test-eval-manifest.mjs
```

Manifest verification additionally needs Python 3, `tiktoken==0.13.0` for token estimates, and
the frozen shared scorer (see [eval.md](references/eval.md) for standalone configuration).
These commands are local; **NO SQL EXECUTED**. The native integration requires PostgreSQL 17+
and npm (the harness installs pinned `pg@8.16.3` in disposable scratch):

```sh
bash scripts/test-conversion-outbox.sh
```

The native harness owns a fresh loopback-only cluster. It tests five actual builders, committed
claims, transactional rollback and byte-identical retries using a local HTTP stub, with no
provider calls. Do not substitute production connection settings. Timestamped evidence and
cleanup results are saved in Downloads. This is local transport proof, not a provider API test.

See the [evaluation record](references/eval.md) for the fixed synthetic evaluation scope and
current status. Model scores are not general model rankings or provider acceptance evidence.

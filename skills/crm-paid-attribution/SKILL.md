---
name: crm-paid-attribution
description: Resolve CRM leads to paid channel and ad evidence with explicit precedence, scoped matching, confidence, and attribution-primary flags.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# CRM paid attribution

Use this skill when a CRM lead export must be connected to paid channel and ad evidence. It
returns one row per scoped lead and retains rows that cannot be matched. It does not prove
spend, incrementality, or revenue; downstream reports must declare their date mode, lookback,
currency, and whether they filter to `is_attribution_primary`.

Read [contract.md](references/contract.md) for input/config/output fields and precedence.
Use [sql.md](references/sql.md) for the runnable BigQuery reference and authenticated fixture
parity checks; regenerate SQL after resolver or local taxonomy changes.
Read [channel-contract.md](references/channel-contract.md) before joining to GA4, a pixel, or
another source. Use the byte-identical local [channel-taxonomy.mjs](scripts/channel-taxonomy.mjs)
as the only classifier authority. Run `node scripts/run-checks.mjs` for semantic fixtures.

## Required behavior

- Require complete source/lead identities and an explicit-offset ISO `created_at` or null.
  Reject invalid calendars and duplicate scoped lead keys. Retain every input lead.
- Select current click, current UTM, first-touch click, then first-touch UTM. Current
  tracking blocks first-touch replacement. `srsltid` is retained but never paid evidence.
- Classify raw evidence with the canonical module exactly once. Preserve its fallback
  channels, including Email and Paid Other for unknown sources with informative mediums.
- Normalize human join keys with five decoding passes, then plus-to-space, trim, lowercase.
  Opaque IDs preserve case and literal plus. Never feed decoded values back into decoding.
- Apply exact source/medium maps before ascending priority and lexical-ID patterns, only
  on the UTM path. Validate canonical channels and reject conflicting configuration rows.
- Join ads only within authorized network/accounts. Nonempty binding arrays cannot infer
  an account. Empty bindings allow visible single-account inference; multiple accounts
  remain ambiguous. Return qualified winning identities and typed sorted candidates.
- Deduplicate the attribution denominator by scoped selected click, including first-touch
  clicks. Earliest valid date then lexical lead key wins; null sorts last. Every UTM-only
  lead remains primary, and every lead remains available for funnel counts.
- Keep raw evidence limited to string tracking fields; do not copy arbitrary CRM PII.

Run `node scripts/check-fixture-sensitivity.mjs` after changing the fixtures or harness.

The implementation is dependency-free and runnable with Node. The fixtures and evaluation
prompts are synthetic; expected answers are kept in fixture data, separate from model context.

# Compact pixel operational reference

Use with [SKILL.md](../SKILL.md). These are general native rules, not case answers. The shared taxonomy classifier is bundled; `deriveChannel` is a compatibility wrapper over the shared module.

## Touchpoint and channel normalization

Collector touchpoints retain `taxonomy_version`, raw click IDs including `srsltid`, and legacy rows remain identifiable with `native_channel` and version `legacy`. Sessions use `attribution_basis = first_touch`, expose source-scoped identity fields, and use `legacy/unclassified` for no-touch fallback unless a valid signal-free landing URL proves Direct. `channel_daily` is site-scoped and UTC-grained; two conversions in one session do not duplicate sessions, and unknown or mixed currencies produce NULL value with an explicit status.

## Identity projection and snapshot

Identity projection binds touches and observations through explicit scope bindings only. Canonical SHA-256 email and phone hashes use the clickstream normalization contract; native contacts and external CRM contacts remain separate catalogs. Snapshot reads are transaction-scoped evidence with site filters; missing sites are explicit, not inferred absent.

## Metrics handoff and MTA inputs

MTA adapter inputs preserve identity projection outputs, conversion scopes, and spend scopes separately. Ledger and coverage rows remain source-scoped; unresolved conversions stay in coverage with explicit statuses rather than being dropped.

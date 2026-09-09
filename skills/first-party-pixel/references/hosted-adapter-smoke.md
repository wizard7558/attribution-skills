# Hosted adapter smoke (Vercel + Neon)

Disposable end-to-end collector smoke recorded 2026-09-09. Machine-readable companion: [`hosted-adapter-smoke.json`](hosted-adapter-smoke.json).

## Result

**Pass.** Schema apply, HTTP collector roundtrip, and Neon row verification succeeded; disposable Vercel and Neon projects were torn down afterward.

| Step | Outcome |
| --- | --- |
| Disposable Neon project | Created in personal org `org-empty-credit-28346059` as `attribution-pixel-smoke-20260909` (`ancient-hill-30300306`, `aws-us-east-1`) |
| Schema + seed | Applied `assets/schema.sql`; seeded sites `smoke` and `site_test` |
| Disposable Vercel project | Deployed collector at `https://attribution-pixel-smoke-20260909.vercel.app/api/collect` |
| HTTP smoke | `pageview` → 204; `identify` → 204 |
| DB verify | 2 events, 1 visitor |
| Teardown | Vercel project removed; Neon project absent from org project list |

## Boundaries

- Disposable Neon + disposable Vercel only; no customer projects reused.
- Connection strings and passwords stay in the private Downloads journal (`pixel-hosted-smoke-20260909T2302Z`); not committed.
- Public summary redacts hostnames to basenames and omits credentials.

## Private evidence

SHA-256 of private create/smoke artifacts is recorded in `hosted-adapter-smoke.json` under `private_evidence` for provenance without leaking secrets.

# Attribution skills completion plan

This plan completes the public attribution skill catalog as twelve interoperable skills. It is intentionally implementation-focused: every step names its skill paths, required evidence, tests, documentation, and risks. The skills remain source-agnostic and can run against exports, warehouse tables, CRM data, or an owner-controlled first-party event store.

## Scope and shared contract

The deliverable is exactly twelve skills: three existing skills and nine remaining skills. The work stops at the catalog, its tests, its documentation, its evaluation matrices, standalone installation checks, and public publication. Synter/social/partnership execution is outside this completion plan.

Every producer and consumer follows these norms:

- Preserve `source_system` and `source_scope` on every source-native row and key. Do not collapse sources by matching labels.
- Use canonical taxonomy version `0.1.0`; the channel-taxonomy skill is the single classifier authority. Generated or bundled copies must be checked for drift.
- Make identity bridges explicit. A shared channel name never proves that two sources describe the same person, session, or conversion.
- Declare timezone, lookback window, date mode (`cohort` or `activity`), grain, and currency at each report boundary.
- Represent unknown monetary values and statuses as `NULL` with an explicit status or reason. Do not coerce unknown revenue to zero.
- Preserve unmatched spend, spend-only rows, unattributed leads, and other reconciliation buckets. No join may hide them.
- Never assume GA4 and first-party pixel populations overlap or can be deduplicated without an explicit identity bridge.
- Keep each `SKILL.md` under 500 lines, author it as Riley Sorenson, use MIT licensing, and put runnable SQL in `references/` or the relevant skill asset directory.
- Give every skill three fixed evaluation prompts, run each with and without Fable 5.1, Sonnet 5, and one open-weight model, and keep expected answers separate from model context. Never fabricate model results.

## Ordered completion steps

### 1. Shared downstream contract and CRM paid attribution

**Skill paths touched:** `skills/channel-taxonomy/` (contract and generated artifacts), `skills/ga4-bigquery-export/` (bundled contract checks), `skills/first-party-pixel/` (bundled contract checks), `skills/crm-paid-attribution/` (new).

**Implementation:** Freeze the source-scoped downstream contract and add CRM-to-paid attribution. The CRM skill must normalize with `LOWER(TRIM())`, multi-pass URL decoding, and click-ID hygiene; apply click ID, current UTM, then first-touch UTM precedence; use seed maps plus pattern fallbacks; fail visibly as `unmapped`; preserve no-click-ID platforms; support N:M candidates with `is_attribution_primary`; map `utm_content` to ad identifiers with HIGH, MEDIUM, or UNMATCHED confidence.

**Required tests and docs:** Add synthetic CRM, ad, UTM, encoded URL, malformed click-ID, no-click-ID, and N:M fixtures. Add semantic assertions for precedence, hygiene, confidence, primary uniqueness, and preservation of unmatched records. Add `SKILL.md`, a contract reference, runnable SQL, `references/eval.md`, three fixed prompts, and standalone install instructions.

**Acceptance evidence:** All four producer/consumer contract checks agree on taxonomy version and field semantics; CRM fixtures produce the documented attribution and reconciliation buckets; `skills-ref validate` passes; each model matrix has complete prompt, expected-answer, and recorded-result columns. An unavailable model or credential is recorded as an outstanding blocker with an owner and rerun command, never counted as completion.

**Risks:** URL encoding and ad-platform conventions can silently produce false matches; mitigate with raw-evidence columns, explicit `unmapped`, and adversarial fixtures. Contract drift can break standalone installs; mitigate with generated-artifact checks.

### 2. Funnel truth, identity stitching, and CRM attribution profiler

**Skill paths touched:** `skills/funnel-truth-and-cost-per-stage/`, `skills/clickstream-identity-stitching/`, `skills/crm-attribution-profiler/` (all new), plus downstream contract references in the three existing skills.

**Implementation:** Build funnel truth around CRM stage records and explicit cohort/activity date modes, lookback partitions, late-stage rewrites, exclusion seeds, conversion flags, and all-opportunity Closed Won logic. Use a `FULL OUTER JOIN` between spend and funnel so matched, ambiguous, unmatched, unattributed, and spend-only buckets remain visible. Build a non-destructive visitor/contact graph using canonicalized, hashed email and phone only; support identify backfill, cross-device widening, webhook confidence, 30-minute touch dedup, and one direct-entry touch. Build a profiler that gates on populated data, classifies field shapes, excludes outbound-tool fields, detects archetypes, and returns corroborate/propose/pre-window/reject verdicts.

**Required tests and docs:** Add fixtures for cohort versus activity dates, late rewrites, missing stages, duplicate opportunities, unknown revenue, unmatched spend, identity collisions, invalid identifiers, confidence transitions, and profiler verdicts. Add semantic SQL or script checks, schema/output references, integration guidance, three prompts per skill, and expected answers outside the model context.

**Acceptance evidence:** Funnel totals remain additive across all reconciliation buckets; identity joins never use IP and never destructively overwrite touches; profiler verdicts are reproducible from fixture population and shape evidence; all validators and deterministic tests pass.

**Risks:** Date-mode or identity mistakes can inflate conversion rates and widen people incorrectly; mitigate with explicit declarations, confidence scores, bounded lookbacks, and negative fixtures.

### 3. MTA, quality tripwires, CAPI, and MMM/incrementality framing

**Skill paths touched:** `skills/multi-touch-models-sql/`, `skills/attribution-data-quality-tripwires/`, `skills/capi-match-keys/`, `skills/mmm-and-incrementality-framing/` (all new).

**Implementation:** Add touch-grain first, last, linear, time-decay with a real half-life, and position-based ledgers with clamped lookbacks and conversion-window modes. Add runnable quality assertions for spend conservation, funnel additivity, unmapped-share ceilings, match-rate floors, primary uniqueness, source parity bands, no-PII columns, empty-column probes, and deleted-ad caveats. Add platform-specific CAPI match-key rules, hashing, E.164 handling, `fbc` synthesis, browser `event_id` deduplication, click lookback, CRM-stage conversion values, deterministic conversion IDs, and a destination-scoped idempotency ledger. Add MMM guidance with guarded weekly regression, Hill saturation, incrementality factors, and plain-language projection bands.

**Required tests and docs:** Add ledger fixtures proving one row per conversion/model/touch and credits sum to one; tripwire fixtures for passing, failing, and unknown states; CAPI fixtures for each key and platform rule, duplicate event IDs, missing keys, and stage values; MMM fixtures for insufficient data, saturation guardrails, projection bands, and MTA-versus-MMM interpretation. Each skill gets runnable SQL/templates, a troubleshooting reference, `references/eval.md`, three prompts, expected answers, and model-result recording instructions.

**Acceptance evidence:** Ledger sums and CAC/ROAS tie to the documented source grain; tripwires fail on injected semantic defects; CAPI IDs are deterministic and the idempotency ledger is destination-scoped; MMM outputs refuse unsupported conclusions and expose assumptions; validator, fixture, and integration suites pass.

**Risks:** Attribution models can manufacture precision, and platform hashing rules can be confused across destinations; mitigate with conservation checks, minimum-data guards, explicit uncertainty, and per-platform references.

### 4. Attribution audit composition

**Skill paths touched:** `skills/attribution-audit/` (new), with references to all eleven other skill directories.

**Implementation:** Compose the entry workflow: inventory coverage, verify taxonomy and source contracts, inspect capture and identity gaps, choose cohort/activity and model boundaries, run tripwires, reconcile the report, and state unresolved unknowns. Calls must be explicit and ordered; the audit must not duplicate classifiers or silently infer bridges.

**Required tests and docs:** Add a synthetic end-to-end audit fixture with complete, partial, and contradictory sources. Add assertions that every finding links to evidence, missing inputs remain unknown, and all reconciliation buckets survive composition. Document the call graph, input/output contract, escalation rules, three fixed prompts, separate expected answers, and standalone installation.

**Acceptance evidence:** The audit produces a deterministic evidence-backed report from the fixture, identifies each deliberate gap, and invokes the correct upstream skill without changing its semantics. No client-specific language or private identifiers appear in tracked files.

**Risks:** Composition can hide upstream uncertainty or create circular dependencies; mitigate with a one-way call graph, evidence references, and integration tests that inspect intermediate outputs.

### 5. Finish existing GA4, pixel, and taxonomy gaps

**Skill paths touched:** `skills/ga4-bigquery-export/`, `skills/first-party-pixel/`, `skills/channel-taxonomy/`, plus their existing scripts and references.

**Implementation:** Complete GA4 live-export validation, wildcard-date pruning and cost caps, schema compatibility notes, and the GA4 model evaluation. Complete live verification of the first-party pixel hosted adapters and its model evaluation. Finish taxonomy evaluation so the open-weight model produces meaningful complete outputs; preserve the existing classifier authority and generated artifacts.

**Required tests and docs:** Run GA4 SQL over representative nested export fixtures and a bounded live-export check with recorded bytes/limits. Run disposable hosted-adapter smoke checks for the supported runtimes and the existing pixel roundtrip. Run all three fixed prompts with and without each required model for all three existing skills; record raw responses, parser status, scores, and unavailable reasons without inventing results. Missing credentials or hosted-runtime access remain explicit blockers with rerun commands, not passing evidence. Update compatibility, evaluation, and standalone-install references.

**Acceptance evidence:** GA4 query checks prove `_TABLE_SUFFIX` pruning, sessionization, traffic-source selection, key events, ecommerce fanout, intraday/daily boundaries, and unknown revenue handling. Pixel adapter checks prove collector parity and runtime delivery. Taxonomy open-weight results are complete enough to score semantically. A reproducible model or runtime limitation may be documented for triage, but remains an outstanding blocker and cannot satisfy completion. All local validators pass.

**Risks:** Live schemas, hosted runtimes, credentials, and model availability can drift; mitigate with bounded checks, synthetic fallbacks, pinned compatibility notes, and explicit evidence status.

### 6. Integration, full evaluation matrices, standalone installs, and public publication

**Skill paths touched:** all `skills/*/` directories; `README.md`; `LICENSE`; `.github/workflows/`; `scripts/`; all `references/eval.md` and eval-result files.

**Implementation:** Integrate all twelve skills against the shared contract, validate every directory, and verify standalone installation for each skill in three supported agents. Produce one complete model matrix per skill with three prompts, with-skill and without-skill runs, Fable 5.1, Sonnet 5, and one open-weight model, plus separate expected answers and provenance. Update the catalog and install commands, run confidentiality checks, and publish the public repository.

**Required tests and docs:** Run `skills-ref validate` for all skills; all deterministic fixture, SQL, artifact, collector, and composition tests; the full integration matrix; standalone install smoke checks; line-count and MIT-license checks; and public confidentiality scanning. Document commands, prerequisites, source boundaries, model-evaluation limitations, and known live checks.

**Acceptance evidence:** Exactly twelve skills are listed with exact paths and status; every skill is under 500 lines; every skill has three fixed prompts and separate expected answers; all integration and standalone checks pass; the public repository contains no private paths, client names, client identifiers, or fabricated results; publication points to a reproducible commit and install command.

**Risks:** Cross-skill generated copies or evaluation records can drift, and publication can expose accidental private text; mitigate with CI regeneration checks, repository-wide scanners, staged-file review, and a final exact catalog/path/count audit.

## Catalog status and requirements

| Skill | Path | Status at plan start | Completion requirement |
| --- | --- | --- | --- |
| `channel-taxonomy` | `skills/channel-taxonomy/` | Published; open-weight evaluation is incomplete | Single classifier authority, canonical taxonomy `0.1.0`, source mappings, fixtures, runnable SQL, complete meaningful model outputs, and drift checks |
| `ga4-bigquery-export` | `skills/ga4-bigquery-export/` | Published; live-export and model evidence outstanding | Sessionize export events, select traffic-source structures, key events/ecommerce, intraday/daily handling, consent gaps, UI reconciliation, pruned SQL, live bounded evidence, and model matrix |
| `first-party-pixel` | `skills/first-party-pixel/` | Published; hosted-runtime and model evidence outstanding | Owner-controlled collector/schema, shared output shapes, consent and adapter paths, hosted-runtime smoke evidence, roundtrip tests, and model matrix |
| `crm-paid-attribution` | `skills/crm-paid-attribution/` | Planned | Precedence chain, normalization/decoding, click-ID hygiene, seed/fallback mapping, no-click-ID pattern, N:M primary flag, confidence, SQL, fixtures, and eval |
| `funnel-truth-and-cost-per-stage` | `skills/funnel-truth-and-cost-per-stage/` | Planned | Cohort/activity modes, CRM stage truth, lookbacks, late rewrites, full outer reconciliation, five buckets, NULL unknowns, SQL, fixtures, and eval |
| `clickstream-identity-stitching` | `skills/clickstream-identity-stitching/` | Planned | Non-destructive bipartite graph, email/phone SHA-256 keys, backfill, cross-device widening, confidence ladder, touch dedup, direct-entry rule, tests, and eval |
| `crm-attribution-profiler` | `skills/crm-attribution-profiler/` | Planned | Population gating, field-shape classification, outbound exclusion, archetypes, four verdicts, fixtures, tests, and eval |
| `multi-touch-models-sql` | `skills/multi-touch-models-sql/` | Planned | Five touch-grain models, real half-life, clamped lookbacks, conversion modes, conserved credit ledger, CAC/ROAS, SQL, fixtures, and eval |
| `attribution-data-quality-tripwires` | `skills/attribution-data-quality-tripwires/` | Planned | Runnable semantic assertions for conservation, additivity, ceilings/floors, uniqueness, parity, no PII, empty columns, and deleted-ad caveat |
| `capi-match-keys` | `skills/capi-match-keys/` | Planned | Platform hashing rules, E.164 and provider-specific handling, `fbc`, `event_id`, click lookback, CRM stage values, deterministic conversion IDs, destination-scoped idempotency ledger, tests, and eval |
| `mmm-and-incrementality-framing` | `skills/mmm-and-incrementality-framing/` | Planned | Guarded weekly MLR, Hill saturation, incrementality factor, projection bands, buyer-journey framing, uncertainty tests, and eval |
| `attribution-audit` | `skills/attribution-audit/` | Planned | Evidence-backed composition of coverage, taxonomy, capture, identity, model, tripwire, and reconciliation workflows with gap reporting |

## Definition of done

The catalog is complete only when all twelve rows above have their required files, semantic tests, documentation, three-prompt evaluation matrices, and validation evidence; all shared artifacts agree; standalone installs work; public confidentiality checks pass; and the public repository is published with MIT licensing. No live result, model score, or runtime claim is recorded without evidence.
| `budget-scenario-planning` | `skills/budget-scenario-planning/` | Completed | Project marketing budget using Monte Carlo sampling, calibrate Hill-saturation curves, and optimize using KKT allocation without claiming causal lift |

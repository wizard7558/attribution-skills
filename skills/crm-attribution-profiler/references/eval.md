# Offline model evaluation

The fixed manifest has exactly three groups and ten independent inputs. The model receives
only `SKILL.md`, `references/api.md`, and `scripts/profile.mjs`; fixture names, expected values,
and the builder are excluded from model context. Inputs use neutral case IDs (`A`, `B`, `C`,
`D`) and must produce a keyed `results` object with the manifest's types-only output schema.
The `results` object is keyed by those case IDs and has exactly the declared case keys;
each value contains every declared snake_case field, using null when the source value is
undefined.

Build and verify the manifest from the repository root:

```sh
node skills/crm-attribution-profiler/scripts/build-eval-cases.mjs
node skills/crm-attribution-profiler/scripts/test-eval-cases.mjs
```

The builder maps the accepted fixture cases to the groups below and independently executes
each selected fixture's existing expected dot paths before writing the manifest. It then
projects candidate 0, `rowCounts.validInWindow`, and root `archetype` into every declared
output field. Manifest checks are the model goldens; numeric checks use tolerance `1e-9`.

| Group | Neutral cases | Fixture mapping kept outside model context |
| --- | --- | --- |
| `scoped-normalization` | A–D | `authorized-cross-system`, `unauthorized-ad-source_scope`, `opaque-plus-distinct-from-space`, `property-wrapper` |
| `population-exclusions` | A–C | `conservative-exclusion-denominator`, `malformed-outside-denominator`, `empty-paid-population` |
| `temporal-archetypes` | A–C | `pre-window-real-recent-cohort`, `archetype-omitted-paid-field`, `outbound-archetype-ip-irrelevant` |

No model run has been executed yet. Scores and model conclusions are therefore unavailable;
this file records the reproducible offline setup only.

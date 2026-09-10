# CRM attribution profiler model evaluation

This report records the completed 18-cell evaluation matrix for the three-group synthetic
benchmark. Each model ran with and without the profiler skill across all three groups. Every
cell completed with a valid structured output, exact requested model identity, and no transport
or model errors. Incorrect answers remain counted as failed checks.

| Model | With skill | Without skill | Unweighted group-rate mean (with / without) |
| --- | ---: | ---: | ---: |
| Claude Fable 5.1 | 90/90 | 48/90 | 100.000% / 51.235% |
| Claude Sonnet 5 | 90/90 | 34/90 | 100.000% / 38.272% |
| Qwen 3:4b | 63/90 | 19/90 | 69.753% / 20.988% |

The numerator and denominator in the first two score columns are check counts. The group-rate
mean is the unweighted mean of the three group percentages; it is shown separately from the
check-count totals because the groups contain 36, 27, and 27 checks and must not be pooled
without labeling that choice.

## Group breakdown

| Model | Condition | Scoped normalization (36) | Population exclusions (27) | Temporal archetypes (27) |
| --- | --- | ---: | ---: | ---: |
| Claude Fable 5.1 | with skill | 36/36 | 27/27 | 27/27 |
| Claude Fable 5.1 | without skill | 26/36 | 10/27 | 12/27 |
| Claude Sonnet 5 | with skill | 36/36 | 27/27 | 27/27 |
| Claude Sonnet 5 | without skill | 12/36 | 10/27 | 12/27 |
| Qwen 3:4b | with skill | 26/36 | 21/27 | 16/27 |
| Qwen 3:4b | without skill | 8/36 | 6/27 | 5/27 |

## Reproduction and provenance

The accepted run used the generic evaluator with one resumed probe. The reproducible command
shape is:

```sh
python3 scripts/run-skill-evals.py \
  --skill skills/crm-attribution-profiler --run \
  --resume <accepted-probe-results.json> \
  --models claude-fable-5-1 claude-sonnet-5 qwen3:4b \
  --condition both --output skills/crm-attribution-profiler/references/eval-results.json
```

The matrix manifest SHA-256 is
`f6712cce63c1e1829acef5a7d9794c5f8c91bb2edf35eacb923f0863cf12ac0d`.
The context hashes are:

- `SKILL.md`: `5b4dbabf95e9557732d49cf780558c0947c8fdbf4740b913bd2a113ca2268443`
- `references/api.md`: `ffe47b831673e03cdf9fdd2ae58a3ca8c8094af477f296e413dafb25ac648b41`
- `scripts/profile.mjs`: `2707ce2b8d9a7665dc046237fe5c50e3eeb1a6d422b2fd567962486677dc950d`

The actual run harness SHA-256 retained in the result metadata is
`7426c32596f1b3cee52f12d66e1f21a36eb29e0f5d1317845f8303c54c585f97`. The later report-only resume bookkeeping correction is not substituted for that recorded run harness; a literal resume requires the recorded harness environment or a fresh evaluation. The first accepted probe
ran at `2026-09-08T22:56:25.391847+00:00`; the expanded run retained that earliest start and
completed at `2026-09-08T23:16:45.349389+00:00`. The result metadata records the resumed-run
history and both conditions. Model identities were verified from the actual Claude primary
usage metadata and Ollama response metadata; the Qwen cache digest was
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.

No model spend or cost was recorded by the evaluator, so no cost claim is made.

## Limits

This is a small fixed synthetic benchmark of policy cases, not a production accuracy estimate.
It describes the observed model outputs under these prompts, context files, and run settings.
The with-skill and without-skill comparison is an observed benchmark comparison and does not
establish causation, generalization, or production lift. The check totals also do not measure
runtime, latency, or data coverage.

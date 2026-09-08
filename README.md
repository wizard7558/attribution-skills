# Attribution skills

Agent skills for marketing attribution, revenue operations, and marketing measurement, written by Riley Sorenson from production work. Each skill reads from any data source you point it at: an ads MCP, a warehouse, raw BigQuery, and depends on no product.

## Install

Install every skill in this repository:

```bash
npx skills add wizard7558/attribution-skills
```

Install one skill:

```bash
npx skills add wizard7558/attribution-skills --skill ga4-bigquery-export
```

## Skills

| Skill | What it does | Status |
| --- | --- | --- |
| [`ga4-bigquery-export`](skills/ga4-bigquery-export) | Sessionize and attribute raw GA4 BigQuery export events | Draft |
| [`first-party-pixel`](skills/first-party-pixel) | Intake-driven setup of a first-party pixel, collector, and Postgres schema the site owner controls | Draft |

## Conventions

Every skill in this repository follows the [Agent Skills specification](https://agentskills.io/specification):

- `SKILL.md` stays under 500 lines.
- SQL lives in `references/`, not inline in `SKILL.md`.
- Runnable checks live in `scripts/`.
- Every SQL snippet uses `PROJECT.analytics_PROPERTY_ID` placeholders and prunes on `_TABLE_SUFFIX`, never a real project or property id.
- No client data, ever. Nothing that identifies a specific customer, account, or organization.

After cloning, enable the pre-push confidentiality check:

```bash
git config core.hooksPath .githooks
```

## Validate

Skills are validated with [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref), the reference validation library for the Agent Skills spec:

```bash
pip install "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref"
skills-ref validate skills/ga4-bigquery-export
```

## License

MIT

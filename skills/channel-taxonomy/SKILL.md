---
name: channel-taxonomy
description: Classify marketing and acquisition signals into a stable 11-label channel taxonomy across GA4, first-party pixel, Shopify, and other source systems.
license: MIT
metadata:
  author: Riley Sorenson
  version: "0.1.0"
---

# Channel taxonomy

Use this skill when a user needs channel classification to be consistent across raw GA4,
first-party pixel, Shopify, ad-network, or CRM inputs. It supplies one dependency-free
classifier and a generated BigQuery JavaScript UDF; it does not claim that a channel label
proves spend, ad-platform matching, or causal attribution.

The canonical labels are: Paid Search, Paid Social, Paid Other, Organic Search, Organic
Social, Email, SMS, Direct, Referral, Affiliate, and Other. Unknown, null, malformed, and
unmapped values become Other. Preserve native labels and raw signals alongside the canonical
label. A valid landing URL with no marketing signals and no external referrer may infer Direct.

Read [channel-contract.md](references/channel-contract.md) before joining this taxonomy to
another source. Read [source-mappings.md](references/source-mappings.md) when translating a
native channel, network, Shopify field, referrer, or click ID. The executable authority is
[`scripts/channel-taxonomy.mjs`](scripts/channel-taxonomy.mjs); its `classifyChannel(input)`
returns a string and `classify(input)` returns `{channel, rule_id, taxonomy_version}`.

For BigQuery, run the generated, table-free example in
[classify_channels.sql](references/sql/classify_channels.sql). Regenerate it with
`node scripts/build-artifacts.mjs`; `node scripts/build-artifacts.mjs --check` detects stale
output. The UDF accepts one JSON string and returns only the canonical channel. BigQuery
JavaScript UDFs use more slots than SQL, so classify after reducing to the relevant session or
event grain and do not add remote libraries.

Use [eval.md](references/eval.md) for realistic evaluation prompts and
[fixtures.json](references/fixtures.json) for synthetic golden cases. Run
`node scripts/run-checks.mjs` after changes.

## Rules that matter

Precedence is click IDs, explicit network, paid medium, informative native channel, non-paid
medium, recognized Shopify type, source-only hints, referrer, explicit or inferred Direct, then Other.
The complete ordered rules and conflict semantics are in source-mappings.md. `dclid` maps
to Paid Other; `gclid`, `gbraid`, `wbraid`, and `msclkid` map to Paid Search; Meta, TikTok,
Reddit, LinkedIn, Twitter/X, Pinterest, and Snapchat click IDs map to Paid Social. These are
routing conventions: click IDs can occur on organic links and do not prove paid spend.
`srsltid` is retained as evidence but never establishes paid traffic.

The classifier normalizes without mutating its input, decodes query values at most five times,
rejects blank and bogus click-ID values, and uses boundary-safe host matching. The same source
body is embedded into the BigQuery UDF to avoid a second implementation.

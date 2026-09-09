# API contract

The executable module is `scripts/profile.mjs` and exports `profileCrmAttribution`,
`normalizeJoinValue`, `classifyShape`, `shapeDistribution`, `isCandidateField`,
`logicalFieldName`, `isExcludedLabelValue`, and `decideVerdict`.

```js
profileCrmAttribution({
  source: { source_system, source_scope, rows, timestampField },
  candidates: [{ rawField, kind, platform, entity_type }],
  adHistory: [{ source_system, source_scope, platform, entity_type, key_kind, value, observed_at }],
  ad_scope_bindings: [{ crm_source_system, crm_source_scope, ad_source_system, ad_source_scope, platform, entity_type }],
  window: { startInclusive, endExclusive, timezone },
  recentWindow: { startInclusive, endExclusive, timezone },
  config: { thresholds: { /* all values below are required */ } }
})
```

`kind` is one of `id`, `name`, `presence`, or `enum`. If `candidates` is omitted, the
runtime infers candidate fields from attribution-like column names, but inferred fields
use `platform: "unknown"` and `entity_type: "unknown"`; they still require an explicit
binding to join. Candidate `rawField` is preserved while exactly one leading
case-insensitive `property_` wrapper is removed for classification.

The required threshold policy is:

```js
{
  populationPctFloor, populationRowFloor,
  proposeWeighted, proposeDistinct, rejectExactFloor,
  preWindowDistinct, highWeighted, highDistinct,
  outboundDominanceFloor
}
```

Rate thresholds are numbers from 0 through 1. `populationPctFloor` is a percentage (for example,
`1` means one percent), and `populationRowFloor` is a non-negative integer. All nine
values are required; there are no hidden production defaults. The fixture policy uses
illustrative values `{ populationPctFloor: 1, populationRowFloor: 20,
proposeWeighted: .5, proposeDistinct: .7, rejectExactFloor: .25,
preWindowDistinct: .7, highWeighted: .75, highDistinct: .9,
outboundDominanceFloor: .6 }` and is not a client threshold claim.

Both timestamp fields and `observed_at` must be ISO-8601 strings with `Z` or an explicit
numeric offset. Naive timestamps are invalid and excluded with `malformed_timestamp`.
`timezone` must be an explicitly supplied valid IANA timezone; a missing timezone is
invalid. Invalid calendar dates, hours, and offsets are rejected rather than normalized.
`recentWindow`, when supplied, must be contained within the full window and have the
identical timezone string. Windows are half-open `[startInclusive,
endExclusive)`; the end instant is excluded. Full and recent rates are computed from raw
rows, not caller-supplied aggregates. Population percentages use only valid CRM rows
inside the window as the denominator. Recent rates use only recent CRM rows and recent
ad keys; a full-window key alone cannot satisfy the recent comparison.
`rowCounts` reports CRM input, valid-in-window, malformed, and outside-window counts.
Aggregate `malformed_timestamp` and `outside_window` diagnostics identify CRM or ad input
and report counts without values.

Source identities, timestamp field names, candidate descriptors, and every binding
identity must be nonempty strings. Missing, blank, or incorrectly typed identities are
structural errors, including identities on unused ad-history rows or bindings.
A candidate must explicitly supply all four descriptor fields when `candidates` is given.

Every join must match an authorized binding on CRM source system/scope, ad source
system/scope, platform, and entity type. CRM and ad source names may differ, but no bare
ID or cross-scope match is permitted. Ad keys are restricted to their binding and window.
Matching applies up to five URL-decoding passes and trimming on both sides. Human
`name` keys additionally convert `+` to space and lowercase; opaque `id` keys preserve
case and literal `+`. Strings are accepted; IDs may also be safe-integer numbers.
Objects, arrays, booleans, and unsafe integers cannot join through string coercion.
Invalid values are excluded from populated counts and rate numerators/denominators,
with `invalid_join_value` counts on the candidate or ad diagnostics. Their CRM rows
remain in the valid-row population denominator. Blank values are unpopulated; encoded values that normalize to an empty key are also
excluded and cannot match one another. Fuzzy
similarity is diagnostic only and never produces `propose`.

For nonempty fields, the population gate fires only when both the percentage and row
floors are below their thresholds. An empty field always fails the population gate,
even when both configured floors are zero. Paid-capture fields then return `capture_missing`; other fields return
`reject`. `presence` and `enum` fields return `corroborate` after passing the gate.
`propose` requires actual exact-match evidence and a weighted or distinct rate to meet its configured threshold; high
confidence requires either high threshold. A recent distinct rate can produce
`pre_window` only after proposal fails and the recent cohort has actual matched values.
Zero thresholds never turn zero evidence or an empty recent cohort into a proposal or
`pre_window`. Otherwise the result is `reject`, with a
`fuzzy_match_not_used` diagnostic when the exact distinct rate is below the reject floor.

`config.excludedLabelValues` optionally replaces the built-in outbound label list, and
`config.sfNonAdPrefixes` optionally replaces the built-in Salesforce internal-record
prefix list. An empty array explicitly disables that exclusion. Labels use the human
name normalization; Salesforce prefixes are case-sensitive three-character alphanumeric
strings and apply only to values with a Salesforce record-ID shape. The default prefix
list is `701`, `001`, `003`, `00Q`, `006`, `00v`, and `005`; the default outbound labels
are the public vendor labels listed in the module, not client-specific values.

Excluded values never count as matches even when an authorized ad key is identical.
They remain populated, unmatched observations in weighted and distinct denominators.
`joinRates.excludedCount`, `sfInternalFkCount`, and `outboundLabelExcludedCount` report
measured exclusions; their union defines `excludedCount`. Candidate diagnostics use
`sf_internal_fk` and `outbound_label_excluded`. Enum/presence fields may still corroborate
capture after the population gate; corroboration does not assert an ad-key join.

Output contains candidate descriptors, counts, percentages, shape distributions, measured
rates, verdicts, confidence, and stable diagnostic codes. It never contains raw row or ad
values. The outbound-BD archetype scans every attribution-like source field, independently of
selected candidates. It requires no populated paid-capture field (UTM fields, supported
click identifiers, and HubSpot click-ID fields), at least one observed excluded outbound
label in a source-like field, and outbound-label dominance meeting
`outboundDominanceFloor`. IP addresses do not establish paid capture. Only valid,
in-window rows contribute; 0/0 or non-outbound labels at a zero threshold never establish
outbound-BD. `archetypeEvidence` reports paid capture presence, source-label observation
and excluded-label counts, and measured dominance.

Run `node scripts/run-checks.mjs` to execute each typed fixture and its golden expected
fields, plus immutability and permutation/privacy assertions. The optional first argument
is an alternate fixture JSON path. Run `node scripts/check-fixture-sensitivity.mjs` to
verify that independently perturbing every golden field and expected error makes the
harness fail on that exact case. Fixtures are full API inputs or named helper operations;
case descriptions alone are not counted as executed tests.

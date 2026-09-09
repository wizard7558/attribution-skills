# Compact GA4 operational reference

Use with [SKILL.md](../SKILL.md). These are general native rules, not case answers. The [projection interface](evaluation-output-contract.md) is supplied to both evaluation conditions; [schema.md](schema.md) and the linked contracts remain production references.

## Sessions and source evidence

Identity is `(source_system,source_scope,session_key)`, with local visitor + dot + selected integer session ID. NULL visitor/session IDs are excluded. There is no platform/stream split or cross-source person bridge. Start, landing and date are observed-window values; property timezone stays NULL.

Per event choose the entire cross-channel source/medium/campaign/native-label struct if any consumed field is non-NULL, including empty strings; otherwise choose its manual struct. Select the first such struct by timestamp and deterministic selected-evidence JSON. Never merge partial fields. Landing is first non-NULL URL, otherwise first observed event; referrer/collected fields stay with it. Blank/invalid non-NULL URLs still participate. Later clicks cannot replace landing evidence. [Shared reduction](../scripts/session-ctes.sql).

Collected gclid/dclid/srsltid take priority unless exactly empty; other IDs come from the chosen URL. Retained raw text is not proof of validity. Canonical parsing ignores fragments, decodes keys, retains first duplicates including empty first, uses at most five decode passes, turns raw plus into space while preserving encoded plus, and preserves UTM value case. Empty decoded UTM becomes NULL. URL status distinguishes missing, invalid and valid; missing UTMs do not invent Direct labels.

Paid IDs override conflicting native/email evidence: dclid→Paid Other; gclid/gbraid/wbraid/msclkid→Paid Search; fbclid/ttclid/rdt_cid/li_fat_id/twclid/epik/sccid→Paid Social. srsltid alone is not paid. Retain all 13 fields regardless of the winning signal. Other canonical labels are Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate and Other. Native Unassigned→Other; Display/Paid Shopping/Cross-network/Paid Video/Audio→Paid Other. Missing evidence is not automatically Direct. Native and canonical labels differ. See [channel rules](channel_rules.md).

Engagement is any selected flag '1', ≥10000 accumulated integer engagement milliseconds, ≥2 page views or a configured key event. It is an observed proxy, not UI settings/duration/screen-view reconstruction. Raw key events retain repeats. Maximum selected session_number=1 identifies first-session rows; new_users counts those rows, not people. Landing groups across the whole window; traffic compares the native pair directly against UTM evidence. Both are top-20 samples. [Companion contract](companion-session-contract.md).

## Parameters and observations

First matching parameter offset wins, including typed NULL. Number coalesces float_value/double_value/integer cast within that record only; never parse strings or use later duplicates. Duplicate count=max(matches−1,0). Numeric diagnostic engagement can differ from integer session engagement. [Parameter authority](../scripts/parameter-helpers.sql).

Params includes raw page views with missing IDs; inline/helper common fields agree. Key events exclude missing visitor/selected session IDs and retain repeated occurrences plus supplied USD NULL/zero/negative. Their limits remain samples. Date-spine zeros prove neither table absence nor completeness. Identifier counts overlap; cause stays unknown. Spans group present visitor/session pairs and count groups seen on multiple event dates; window censoring prevents lifetime or UI-cause claims. Empty fractions stay NULL. [Diagnostic contract](parameter-diagnostic-contract.md).

## Two purchase policies

Channel daily deduplicates exact nonempty transaction IDs inside a session, with no whitespace trim. Other sessions remain separate. Choose earliest non-NULL USD amount; aggregate before joining session metrics. Contradictions are not reconciled; ordinary FLOAT64 SUM has no finite/overflow guard. Missing/empty IDs→NULL/unkeyed_purchases; otherwise no purchases→zero/no_purchases; any all-NULL selected amount→NULL/unknown; else sum/complete. Complete does not certify finite money. [Native channel daily](sql/channel_daily.sql).

Ecommerce domain is source/scope/platform/stream/visitor/exact transaction, excluding session/date. NULL/trim-empty keys are unkeyed; other bytes remain exact. First observed timestamp/date/evidence assigns date. Compare entire selected payload, including tax/shipping/native money/currency/quantities/ordered items. Identical repeats collapse; any variant, including NULL vs populated or item-only changes, is conflict with no authoritative money/items. Finite zero/negative is known, missing unknown, nonfinite invalid.

Items come once from an accepted payload with original offsets. Any unkeyed event anywhere in the window makes all daily all-population counts and authoritative totals NULL; retain qualified counts/subtotals. Both accepted and conflicting qualified orders count. Sum known finite pieces scaled by max absolute value, then safely multiply back: all known zero→0, no known pieces→NULL, overflow→NULL/numeric_failure. FLOAT64 cancellation stays approximate; no native-currency aggregate or exact finance/UI parity. [Ecommerce contract](ecommerce-contract.md), [SQL](sql/ecommerce.sql).

## Execution

The fixed eight-template wrapper validates Gregorian dates, standard lowercase project IDs, ASCII alphanumeric/underscore datasets, location and positive decimal INT64 cap before credentials. Billing defaults to source, location US, cap1073741824. Literal suffixes select daily tables, excluding intraday. Standard SQL/no cache/explicit cap apply to each job; never auto-raise. LIMIT does not bound scanned bytes, and zero script dry-run estimate does not prove a free/valid full script.

REST success requires matching identity/schema, jobComplete=true, consistent totalRows, no repeated pageToken and exact accumulated count. Preserve nested/repeated/NULL values and INT64/decimal/TIMESTAMP strings; useInt64Timestamp means signed microseconds. Complete retrieval does not remove SQL limits. Resume preserves original bytes and recorded handles; config/source/wrapper changes reject it. Missing handles remain retrieval_pending_or_failed and native errors query_failed, with no replacement queries. [Wrapper](../scripts/run-export-checks.mjs), [execution contract](export-execution-contract.md).

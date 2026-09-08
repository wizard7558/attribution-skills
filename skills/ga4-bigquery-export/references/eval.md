# Evaluation prompts

Three prompts a reviewer can run against an agent with and without this skill loaded, each
with a checklist of expected behaviors. Score each behavior pass/fail; the skill is working
if the with-skill run passes every item and the without-skill run misses at least one.

## Eval 1: "Give me sessions by channel for the last 7 days for property PROJECT.analytics_PROPERTY_ID."

Expected behavior:
- [ ] Prunes the wildcard with `_TABLE_SUFFIX BETWEEN '<7-days-ago>' AND '<yesterday>'` (or
      equivalent explicit date bounds) - never an unbounded `events_*` scan.
- [ ] Builds the session key from both `user_pseudo_id` and `ga_session_id`
      (`CONCAT(user_pseudo_id, '.', CAST(ga_session_id AS STRING))`), not `ga_session_id`
      alone.
- [ ] Uses `session_traffic_source_last_click` (or explicitly derives its own channel and
      states why) rather than `traffic_source` for channel/session attribution.
- [ ] Reads session source/medium from `cross_channel_campaign` (or uses
      `default_channel_group`), not `manual_campaign`, so Direct sessions are not reported as
      Unassigned.
- [ ] Classifies medium `paid-social` as Paid Social, not Organic Social.
- [ ] Does not select all raw columns from `events_*`; projection from reduced session CTEs is acceptable.
- [ ] Caveats that the most recent 1-3 days may be incomplete because daily tables can land
      up to 72 hours late, before presenting numbers for those days as final.
- [ ] Sets or recommends a bytes cap (`--maximum_bytes_billed` / `maximumBytesBilled`) before
      running, or dry-runs first.

## Eval 2: "Why doesn't my BigQuery purchase revenue match what the GA4 UI shows for last month?"

Expected behavior:
- [ ] Checks (or instructs the user to check) `ecommerce.purchase_revenue` vs.
      `purchase_revenue_in_usd` and asks/states which currency the UI number is in, rather
      than assuming a mismatch is a bug.
- [ ] Dedupes purchases on `ecommerce.transaction_id` before summing revenue - flags
      `COUNT(*)`/`SUM()` without a transaction_id dedupe as a likely cause if the raw query
      didn't do this.
- [ ] Runs (or recommends) the daily-table-completeness check
      (`references/sql/ui_reconciliation.sql` check 1) for the queried window before
      concluding there's a real discrepancy.
- [ ] Mentions at least one of: HLL-based UI approximation, thresholding, modeled data, or
      `(not set)` handling as a plausible source of small differences, without treating every
      GA4 UI vs. BigQuery gap as an anomaly to be forced into exact agreement.
- [ ] Does not silently assume the two numbers should match exactly.

## Eval 3: "Tag which sessions came from Google Ads using click IDs, for the current quarter."

Expected behavior:
- [ ] Uses `collected_traffic_source.gclid` as the primary signal, not
      `session_traffic_source_last_click` alone. Does not use `.dclid` for this - `dclid` is a
      Campaign Manager 360 / Display & Video 360 click id (canonical Paid Other; native Display), not Google Ads
      search, and should not be tagged as Google Ads search traffic.
- [ ] Does not assume `gbraid`/`wbraid` exist as columns on `collected_traffic_source` -
      either states they are not present as dedicated fields, or falls back to
      `REGEXP_EXTRACT` on `page_location` for them.
- [ ] Notes that `collected_traffic_source` is populated on the events that carried the
      click ID, not backfilled across the whole session - so a plain per-event filter for
      `gclid IS NOT NULL` needs to be selected at the first landing event and rolled up to the session key; later click IDs must not silently change session attribution.
- [ ] For a "current quarter" window (likely >1 week), dry-runs the query or explicitly
      warns about scan size before running, per the cost/safety checklist.
- [ ] Filters `_TABLE_SUFFIX` to the quarter's date range, not an open-ended wildcard.

## Integration regressions

Run `bash scripts/run_checks.sh --synthetic` to execute both actual query templates against
synthetic nested GA4 events. Assertions cover all canonical classifier fixtures, conflicting
paid IDs and email, all 13 retained click-ID fields, direct versus unknown, first-landing
selection versus later clicks, coherent campaign fields, cross-midnight sessions, canonical
native-label aggregation, multiple purchases/key events, transaction duplicates, partial
unknown revenue, unkeyed purchase visibility, URL fragments, and encoded query keys. This is deterministic integration validation, not a new model evaluation.

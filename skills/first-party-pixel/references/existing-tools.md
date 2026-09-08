# If the user already has an analytics tool

Read this before Step 0 finishes if `existing_accounts` in the intake names PostHog, Segment,
Snowplow, or a GA4 BigQuery export. Building a duplicate pixel from scratch is rarely the right
first move for these users.

## PostHog, Segment, or Snowplow already in place

Offer three options and let the user pick before continuing the rest of the intake:

**Option A: run the pixel alongside, dedupe on visitor id.**
Install this skill's pixel independently and reconcile the two datasets later by matching on a
shared identifier (email after identify, or a shared anonymous id if both tools can be
configured to read the same first-party cookie). Best when the existing tool serves a different
purpose (product analytics, session replay) that this skill's pixel is not meant to replace, and
the user specifically wants an attribution-focused dataset separate from it.

**Option B: forward the existing tool's events into the same `pixel` schema.**
Keep the existing tool as the single collection point, and add a destination that writes into
`pixel.events` and related tables instead of running a second pixel:
- **PostHog** - configure a webhook destination (Data pipelines > Destinations > Webhook) that
  POSTs each event to the collector's `/collect` endpoint in the shape `assets/collector/core.js`
  expects.
- **Segment** - configure an HTTP destination (or a custom Functions destination) that forwards
  each track/identify/page call to the same `/collect` endpoint.
Best when the user wants one collection point and is comfortable mapping the existing tool's
event shape to this schema's shape.

**Option C: skip the pixel, add UTM and click-ID capture to the existing tool only.**
If the only gap is attribution fields (UTMs, `gclid`, `fbclid`, and similar), add capture of
those fields to the existing tool's own first-touch/last-touch properties instead of building a
parallel pixel and database. This is the smallest change and often the right one when the user's
complaint is specifically "I can't see which channel drove this," not "I want to own my data
outside this tool."

Ask which of the three the user wants before moving past Step 0; the answer changes whether
Steps 1-4 of the build workflow (database, collector, subdomain, pixel install) happen at all.

## GA4 BigQuery export already in place

Do not duplicate session and channel data GA4 already provides. Run this skill's pixel for what
GA4 does not give: identity resolution from forms and a first-party visitor id independent of
Google's own cookie behavior. Keep GA4 as the source of session and channel data.

To join the two datasets, capture GA4's `client_id` (the value GA4 sets in the `_ga` cookie,
formatted `GA1.1.<client_id>`) in the pixel's own event payload alongside the pixel's own
visitor id, so a later join to `analytics_<property_id>.events_*`'s `user_pseudo_id` is possible
without probabilistic matching. See the sibling `ga4-bigquery-export` skill for the export's
schema and how to read `user_pseudo_id`.

Set `downstream.ga4_export = true` in `pixel.config.json` for this case, and treat
`downstream.warehouse` as the target GA4 already exports to (typically `bigquery`) rather than
asking the user to set up a second export.

## Google Tag Manager already in place

Not a conflict - GTM is a delivery mechanism, not a data store. Install the pixel as a Custom
HTML tag with a consent trigger; see `references/install/tag-manager.md`.

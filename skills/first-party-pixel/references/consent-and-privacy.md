# Consent and privacy

Plain-language guidance for wiring consent into the pixel. This is engineering guidance, not
legal advice - point the user to counsel for a jurisdiction determination.

## The three consent modes

- **`required`** - no cookie is written and no event leaves the browser until the CMP records
  an accept. The pixel queues nothing client-side before consent; it does not call
  `fpx('track', ...)` internally until the consent callback fires. Use this for EU, UK, and
  Switzerland traffic by default.
- **`anonymous-until-consent`** - the pixel tracks immediately using a session-only, non-persistent
  identifier (no cookie, no `localStorage` write) and stores events without a durable visitor
  id. Once consent is granted, the pixel switches to a persistent visitor id (cookie or
  `localStorage`) and the collector links subsequent events to that identity. Before consent,
  IP is still hashed on arrival, never stored raw. Use this for California traffic by default,
  and it is the recommended (though not required) default for US-only traffic.
- **`none`** - the pixel writes a persistent visitor id and tracks immediately, with no consent
  gate. Only appropriate where no applicable consent regulation requires a gate; even then,
  `anonymous-until-consent` is the safer default absent a specific reason to use `none`.

## CMP hook points

Wire the pixel's internal consent state to the CMP's own signal rather than maintaining a
second, independent consent flag:

- **Cookiebot** - listen for `window.addEventListener('CookiebotOnAccept', ...)` and
  `window.addEventListener('CookiebotOnDecline', ...)`; read `Cookiebot.consent.statistics` for
  the analytics-category decision specifically, since Cookiebot separates categories
  (necessary, preferences, statistics, marketing).
- **OneTrust** - OneTrust calls `window.OptanonWrapper()` when consent state changes; inside
  it, read `window.OnetrustActiveGroups` (a comma-delimited string of active category ids) and
  check whether the analytics/performance category id configured in the OneTrust account is
  present.
- **Klaro** - register a callback through Klaro's `callback` config option or watch its
  `klaro:consent-change` DOM event, and read the consent state for the analytics purpose/service
  the pixel is registered under in the Klaro config.
- **Custom CMP** - call `window.fpx('consent', { analytics: true|false, ads: true|false })`
  directly from the CMP's own accept/decline handler. This is also the fallback call for any
  CMP not listed above: wrap its accept/decline callback to call `fpx('consent', ...)`.

## Global Privacy Control

Check `navigator.globalPrivacyControl === true` (or the `Sec-GPC: 1` request header, read
server-side by the collector) and treat it as an explicit opt-out signal: in `required` and
`anonymous-until-consent` modes, GPC blocks the switch to a persistent identifier and blocks
any event that is not already permitted by the CMP's own consent state, equivalent to a
decline. In `none` mode, honor GPC anyway as a matter of respecting the signal even where not
legally mandated, since the setting represents an explicit user preference.

## IP handling

Hash the visitor's IP address with the salt in `privacy.hash_salt_env`
(`PIXEL_IP_SALT` by default) before it is written to any table. Never write a raw IP to
`pixel.events`, `pixel.visitors`, or any other table intended for query access. If a raw IP is
needed transiently (for example, for geolocation lookup at ingest time), discard it after use
rather than persisting it, and purge whatever transient store holds it within
`privacy.ip_retention_days`.

## Retention

`privacy.ip_retention_days` (default 7) governs how long any raw or reversibly-identifiable IP
data is kept before purge. The schema's `pixel.purge_raw_ip()` function (see
`references/implementation.md`) should run on a schedule (daily is typical) and delete or
irreversibly hash any IP data older than the configured window. Hashed IPs used for bot
filtering or fraud checks can be retained longer than raw IPs, since a salted hash is not by
itself sufficient to re-identify a visitor.

## What to write in the privacy policy

Document, in plain language the user can adapt: what is collected (page views, click ids, form
submissions with the specific fields captured, IP address before hashing), why (site analytics
and marketing attribution), how long it is kept (the `ip_retention_days` value, and, separately,
how long event and identity data itself is retained if that differs), who has access (the site
owner and whoever operates the database and collector), and how the consent mechanism works
(the CMP in use, or the absence of one if `consent.mode = none`). This skill does not draft
policy language; produce a short, factual summary of the pixel.config.json settings for the
user to hand to whoever writes or reviews their privacy policy.

## Region-based defaults

| Region signal | Default `consent.mode` |
|---|---|
| EU, UK, or Switzerland traffic | `required` |
| California traffic (no EU/UK/Switzerland) | `anonymous-until-consent` acceptable, with GPC honored |
| US-only, no California-specific signal | `none` allowed, `anonymous-until-consent` recommended |

These are starting defaults for the intake in `references/intake.md`, not a substitute for the
user's own legal review, especially for a site with traffic from a region not listed here.

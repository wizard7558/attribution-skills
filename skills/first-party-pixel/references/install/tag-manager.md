# Install: Google Tag Manager

Add the pixel as a Custom HTML tag rather than editing site templates directly.

## Tag setup

1. In GTM, create a new tag, type **Custom HTML**.
2. Paste:

   ```html
   <script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
   ```

3. Trigger: **All Pages** (or the specific pages to track), fired on **Page View** (or **DOM
   Ready** if the site is a single-page app and route changes are tracked separately - see
   below).

## Consent trigger

If `consent.mode = required` or `anonymous-until-consent`, do not fire the tag unconditionally
on Page View. Use GTM's built-in Consent settings on the tag (Additional Consent Checks, or the
tag's own Consent Settings section) to require the relevant consent type (for example
Analytics Storage) before the tag fires, matching whatever the site's CMP writes to GTM's
consent state. If the site uses Google Consent Mode v2, the pixel tag should honor the same
`analytics_storage` signal the CMP already sets, rather than maintaining a second consent state
independent of it. See `references/consent-and-privacy.md` for how each CMP surfaces its
consent decision to code the pixel can read.

## SPA route changes

If the site GTM is installed on is a single-page app, fire a GTM **History Change** trigger (or
the site's own custom event pushed to `dataLayer`) that calls
`window.fpx('track', { event: 'page_view' })` on each route change, since the Page View trigger
only fires once on initial load in a SPA.

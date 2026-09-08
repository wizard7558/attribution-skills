# Install: Webflow

Add the snippet through Webflow's site-wide custom code, not a page-level embed, so it loads on
every page without editing each one individually.

## Steps

1. In the Webflow Designer, open **Site settings > Custom code**.
2. Paste into the **Footer Code** box (loads before `</body>`, after the page content, which
   keeps the pixel out of the render-blocking path):

   ```html
   <script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
   ```

3. Publish the site. Webflow's custom code only takes effect after a publish, including for the
   staging domain if testing there first.

## Notes

- Webflow is not a single-page app in the typical sense - full page navigations reload the
  page, so no extra route-change handling is needed beyond the tag itself.
- Webflow forms: if `identity.forms` includes `native` and the site's forms are Webflow's own
  native form element, wire the identify call to Webflow's form-submit behavior by adding a
  small inline script near the form (or in the same footer block) that listens for Webflow's
  `w-form-done` class being applied to the form's parent, then calls
  `window.fpx('identify', { email, ... })` with the submitted field values.
- If forms are embedded from HubSpot, JotForm, Typeform, or Calendly instead, follow that
  tool's own identify wiring rather than the native-form listener above.

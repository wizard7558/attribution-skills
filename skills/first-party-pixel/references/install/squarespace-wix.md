# Install: Squarespace and Wix

Both platforms are closed hosted builders without theme file access; use each platform's own
site-wide code injection panel.

## Squarespace

1. **Settings > Advanced > Code Injection** (on some plans, **Settings > Advanced > Developer
   Mode** is not required for this).
2. Paste into the **Footer** field:

   ```html
   <script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
   ```

3. Save. Squarespace applies footer code injection sitewide, including on the store checkout on
   most plans; verify on the specific plan, since checkout page code injection support has
   varied by Squarespace commerce plan tier.

## Wix

1. **Settings > Custom Code** (previously called Tracking & Analytics on some Wix editors).
2. Add a new custom code entry, paste the same script tag, set it to load on **All pages**, and
   place it in the **Body - end** position.
3. Publish the site. Wix custom code, like Webflow's, only takes effect after publishing.

## Notes

- Neither platform is a single-page app for top-level navigation between pages, so no
  route-change handling is needed beyond the tag itself.
- Wix and Squarespace native forms: wiring `identity.identify_on = form_submit` for native
  forms on either platform typically requires the platform's own form-submission automation
  (Wix Automations, Squarespace's form Storage/notification settings) to forward the
  submission server-side into an identify call, since neither platform exposes a reliable
  client-side DOM event for arbitrary custom code to hook into. Prefer routing native form
  submissions through email notification plus a lightweight webhook receiver, or through one of
  the supported form tools (HubSpot, JotForm, Typeform, Calendly) embedded on the page instead.

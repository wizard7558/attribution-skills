# Install: WordPress

Add the snippet to the theme, not to a post or page, so it loads sitewide.

## Option A: theme footer (if the user edits the theme directly)

Add to the active theme's `footer.php`, immediately before `wp_footer();` closes or immediately after
it:

```php
<script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
```

Risk: a theme update overwrites `footer.php` and silently removes the snippet unless the site
uses a child theme.

## Option B: snippet or header/footer plugin (preferred for most users)

Use a code-snippet plugin (for example one that inserts arbitrary HTML into `wp_footer`)
rather than editing theme files directly, so the snippet survives theme updates. Paste the same
script tag into the plugin's footer-code field.

## Notes

- WordPress is not a single-page app by default; full page loads mean no extra route-change
  handling is needed.
- If the site uses a page builder with its own AJAX-based navigation (some Elementor or
  WooCommerce flows), verify pageviews are still firing on each navigation, not only on the
  first load, since AJAX-swapped content does not re-execute a footer script tag automatically.
- WooCommerce checkout: for reliable purchase capture, prefer a server-side WooCommerce webhook
  (order created/completed) writing into `pixel.conversion_events` over relying on the
  client-side pixel firing on the thank-you page, which can be skipped by back-button
  navigation or ad blockers.

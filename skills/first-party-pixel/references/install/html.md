# Install: plain HTML

Add the snippet directly before the closing `</body>` tag, on every page that should be
tracked:

```html
<script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
```

Notes:

- `async` lets the rest of the page render without waiting on the pixel script; the script
  queues any `window.fpx(...)` calls made before it loads.
- If the site is a static multi-page site with no shared template, add the tag to every HTML
  file, or move to a shared include (server-side include, build-time partial) so there is one
  place to update the site key or endpoint later.
- `data-consent-mode` should match `consent.mode` from `pixel.config.json` exactly - see
  `references/consent-and-privacy.md` for what each value blocks.

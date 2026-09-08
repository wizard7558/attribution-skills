# Install: Shopify

Two install paths exist, with a real tradeoff between them.

## Option A: Shopify custom pixel (preferred)

Shopify's custom pixel sandbox runs in a restricted Web Worker context, separate from the
storefront's main thread, and is Shopify's supported mechanism for third-party and first-party
tracking since checkout extensibility replaced `checkout.liquid`.

Tradeoffs:

- Runs in a sandbox: no direct DOM access, no arbitrary `fetch` to non-approved domains without
  the pixel's network-access configuration allowing it. `assets/pixel.js` must be adapted to
  the sandbox's message-passing API (`analytics.subscribe(eventName, callback)` and the
  sandboxed `fetch`) rather than loaded as a plain `<script>` tag.
  See `references/implementation.md` for how the collector-facing send call is adapted for the
  sandbox.
- Covers storefront and checkout events (Shopify emits `page_viewed`, `product_viewed`,
  `checkout_started`, `checkout_completed`, and more through the same subscription API), which
  a theme-only snippet cannot reach on Shopify's hosted checkout.
- Configured through **Settings > Customer events** in the Shopify admin, or via the
  Shopify CLI/Admin API for programmatic setup, not by editing theme files.

## Option B: theme.liquid include

Add the snippet to `theme.liquid`, inside `<head>` or immediately before `</body>`:

```html
<script async src="https://t.example.com/pixel.js" data-site-key="SITE_KEY" data-endpoint="https://t.example.com/collect" data-consent-mode="required"></script>
```

Tradeoffs:

- Simpler to install and matches the plain-HTML pattern exactly.
- Does not run on Shopify's hosted checkout pages (`checkout.shopify.com`), so checkout-step
  and purchase events are not visible to this pixel unless paired with Shopify's checkout
  webhook (order creation) delivered server-to-server into `pixel.conversion_events` instead of
  client-side.
- Theme updates or a theme change can silently remove the snippet if it is not preserved during
  the update.

## Recommendation

Use Option A (custom pixel) when purchase and checkout-step events matter, which is the common
case for a store owner asking for attribution. Use Option B only for a quick storefront-only
capture, paired with a server-side order-creation webhook for conversion events if purchases
need to be captured reliably.

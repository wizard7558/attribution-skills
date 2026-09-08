# Install: Next.js

Next.js apps are commonly single-page apps after the first load (client-side routing through
`next/link`), so a plain `<script>` tag alone only fires a pageview on the very first page.

## Script placement

Use `next/script` with the `afterInteractive` strategy in the root layout (App Router) or
`_app` (Pages Router), rather than a raw `<script>` tag, so Next.js manages loading and
deduplication correctly:

```tsx
import Script from 'next/script'

<Script
  src="https://t.example.com/pixel.js"
  data-site-key="SITE_KEY"
  data-endpoint="https://t.example.com/collect"
  data-consent-mode="required"
  strategy="afterInteractive"
/>
```

## Route-change handling (App Router)

Client-side navigations do not trigger a full page load, so `pixel.js`'s automatic pageview
does not fire again on its own. Add a small client component that watches the pathname and
search params and calls `window.fpx('track', { event: 'page_view' })` on change:

```tsx
'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

export function PixelRouteTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    window.fpx?.('track', { event: 'page_view' })
  }, [pathname, searchParams])

  return null
}
```

Mount `PixelRouteTracker` once in the root layout, alongside the `Script` tag.

## Route-change handling (Pages Router)

Subscribe to the router's `routeChangeComplete` event in `_app.tsx` and call the same
`window.fpx('track', { event: 'page_view' })` from that handler instead.

## Collector co-location

If `collector.runtime = vercel` and the site itself deploys on Vercel, the collector can live
in the same project as an API route (`assets/collector/vercel/api/collect.js`) rather than a
separate deployment, which also means the pixel's `data-endpoint` can point at the app's own
domain path instead of a separate subdomain if `pixel.hosting = collector-url`.

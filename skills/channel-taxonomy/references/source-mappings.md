# Source mappings

Keep the original native label, source, medium, click IDs, network, and Shopify fields for
audit. A mapped label is a reporting projection, not proof of spend, platform delivery, or
causality. In particular, click IDs may occur on organic links, and a Google Ads ID does not
by itself prove a Search campaign.

## Native labels

| Native value | Canonical label |
| --- | --- |
| Paid Search, Paid Social, Paid Other, Organic Search, Organic Social, Email, SMS, Direct, Referral, Affiliate, Other | Same label |
| Affiliates | Affiliate |
| Display, Paid Shopping, Cross-network, Paid Video, Paid Audio, Audio | Paid Other |
| Organic Video | Organic Social |
| Organic Shopping | Organic Search |
| AI Assistant | Referral (custom loss of native detail) |
| Unassigned, `(not set)`, mobile push, unknown, null | Other |

These are custom projections, not GA4 UI parity. See [Google's native channel definitions](https://support.google.com/analytics/answer/9756891).

## Click IDs and networks

`dclid` → Paid Other; `gclid`, `gbraid`, `wbraid`, `msclkid` → Paid Search; `fbclid`,
`ttclid`, `rdt_cid`, `li_fat_id`, `twclid`, `epik`, `sccid` → Paid Social. `srsltid` is
preserved but never used as paid evidence. This click-ID routing is a coarse convention, not
an ad match.

`google_ads`, `google_ads_pmax`, `bingads`, `paid_search` → Paid Search;
`facebook_ads`, `linkedin_ads`, `reddit_ads`, `reddit`, `pinterest_ads`, `paid_social`,
`tiktok_*` → Paid Social; `criteo`, `stackadapt`, `stackadapt_ads` → Paid Other;
`affiliate` → Affiliate. PMax is a legacy custom convention; native Cross-network remains
Paid Other and raw provenance is retained.

Affiliate source/network aliases are `cj`, `rakuten`, `impact`, `shareasale`, `awin`, and
`partnerize`. Source-only email hints include `mailchimp`, `klaviyo`, `hubspot`, `customer.io`,
`iterable`, `sendgrid`, `braze`, `newsletter`, `email`, and `e-mail`; SMS hints include `attentive`, `postscript`,
`klaviyo_sms`, and `sms`.

## Mediums, sources, referrers, and Shopify

Use this fixed precedence, stopping at the first applicable rule:

1. Valid click IDs: `dclid`, then search IDs, then social IDs (the groups above).
2. A recognized explicit network ID.
3. Paid medium: explicit `paid_search` → Paid Search and `paid_social` → Paid Social,
   regardless of source. Display, banner, CPM, native, video, audio, `paid_other`,
   `paid_video`, and `paid_audio` → Paid Other. Space and hyphen separators are equivalent
   to underscores. Generic paid, CPC, CPA, CPV, CPE, CPP, PPC, SEM, retargeting, remarketing,
   and other `paid_*` forms split by a known search/social source, otherwise Paid Other.
   A substring such as `unpaid` never establishes a paid medium.
4. Informative native channel; Direct and Other defer to later evidence.
5. Nonpaid medium: email/newsletter, SMS/text, affiliate, organic/SEO, social, referral.
   Organic with a known social source → Organic Social; other organic/SEO → Organic Search.
   An explicit referral medium → Referral even with a search/social source or a self-referrer.
6. Recognized Shopify source type, with Direct deferred as described below.
7. Source-only email, SMS, affiliate, search, or social hints, inspecting UTM source first,
   then Shopify source. Unrecognized mediums and Shopify types do not stop this fallback.
8. Valid external referrer: search → Organic Search, social → Organic Social, otherwise Referral.
   Self-referrers are ignored using exact host or parent/subdomain boundaries. Malformed
   referrers supply no channel and prevent inferred Direct.
9. Explicit Direct from native/Shopify labels or `(direct)` plus `(none)`/`(not set)`; otherwise
   infer Direct only from a captured valid landing with no source, medium, campaign,
   network, native label, or Shopify signals and no external or malformed referrer.
10. Other.

String signals are trimmed, decoded at most five times, and compared without case sensitivity.
Malformed percent encoding is preserved at the point decoding fails. Click IDs reject blank,
null/undefined placeholders and `[object object]` without regard to case, including encoded
placeholders. Missing, null, or whitespace-only UTM fields fall back to the valid landing URL's
query; an explicit nonblank UTM field wins. URL fragments do not provide query evidence.
Only valid HTTP(S) or protocol-relative URLs with valid DNS-style hosts and optional numeric
ports provide landing/referrer evidence; malformed URLs do not create click evidence or Direct.

Known bounded search hosts include Google (including the listed supported ccTLDs), Bing, Yahoo,
DuckDuckGo, Baidu, Yandex, Ecosia, Brave Search, Ask, and AOL. Known social hosts include
Facebook, Instagram, LinkedIn, Twitter/X, TikTok, Reddit, Pinterest, Snapchat, YouTube, and
`t.co`; host matching accepts their subdomains but rejects lookalike suffixes such as
`google.com.evil.test`.

Shopify source types `email`, `sms`, `affiliate`, `search`, `social`, `seo`, `organic`, `post`,
`newsletter`, `referral`, and `direct` map respectively to Email, SMS, Affiliate, Organic
Search, Organic Social, Organic Search, Organic Search, Organic Social, Email, Referral, and
Direct. `ad` and `retargeting` require
platform evidence; without it they map to Paid Other. Bare Shopify Search/Social source labels
are coarse conventions and cannot prove unpaid traffic. Unknown source types and unrecognized
bare source labels defer to other source/referrer evidence, then Other. Explicit Shopify Direct
also defers until source and referrer evidence has been considered. See [Shopify marketing reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/marketing-reports).

# Channel grouping rules

The raw GA4 BigQuery export carries a default channel group in exactly one place:
`session_traffic_source_last_click.cross_channel_campaign.default_channel_group` (verified
against the live schema - see `references/schema.md`). When that value is present and you
only need it for the session's last-click traffic, use it directly and skip the rules below.

Rebuild your own channel group when you need event-level classification, when
`default_channel_group` is NULL or `(not set)` for the row, or when the user wants a custom
grouping. Read source/medium from `cross_channel_campaign`, not `manual_campaign` - see "Why
`cross_channel_campaign`, not `manual_campaign`" below. Apply the rules in order; stop at the
first match. Never leave a session or event unclassified - anything that reaches the end
unmatched gets labeled `Unassigned`, GA4's own term, never `Other`.

Normalize `source` before every list match: `LOWER()`, then strip a leading `www.`. `medium`
is matched case-insensitively (`LOWER()`) throughout.

## Rule order

1. **Click ID present** → Paid. Check `collected_traffic_source.gclid` /
   `.dclid` first (dedicated export columns), then fall back to `REGEXP_EXTRACT` on
   `page_location` for click IDs that only ever appear as URL params (see the click-ID map
   below). Route to Display, Paid Search, or Paid Social per the platform - `dclid` (Campaign
   Manager 360 / Display & Video 360) is Display, not Paid Search.
2. **GA4's own paid-medium test** - `REGEXP_CONTAINS(LOWER(medium), r'^(.*cp.*|ppc|retargeting|paid.*)$')`
   → Paid. This is GA4's own regex, not a short fixed list of literal values - it is what
   catches `paid-social` (the hyphenated medium Meta, Reddit, and Pinterest paid traffic
   arrives with) that a `medium IN ('cpc', 'ppc', 'paid', 'sem')` check misses (see pitfall
   16). Split the match: `source` in the search-engine list → Paid Search; `source` in the
   social-source list → Paid Social; anything else → **Paid Other**.
3. **`medium = organic`** → Organic Search.
4. **`medium = email`** → Email.
5. **`medium = sms`** → SMS.
6. **`medium` contains `affiliate`, or `source` in (`cj`, `rakuten`, `impact`, `shareasale`,
   `awin`, `partnerize`)** → Affiliates.
7. **`medium = referral`** → Referral.
8. **`source` in the social-source list** → Organic Social.
9. **`source = (direct)` and `medium = (none)`** → Direct.
10. **Everything else**, including `(not set)`/`(not set)` → `Unassigned`. This is GA4's own
    channel group for sessions with no usable source information. Do not emit NULL, and do not
    label this case `Direct` - `Direct` is reserved for the explicit `(direct)`/`(none)` match
    in rule 9.

## Click ID → platform map

| Click ID param | Platform | Channel |
|---|---|---|
| `gclid` | Google Ads | Paid Search |
| `gbraid` | Google Ads (iOS, privacy-safe) | Paid Search |
| `wbraid` | Google Ads (web, privacy-safe) | Paid Search |
| `dclid` | Google Campaign Manager 360 / Display & Video 360 | Display |
| `fbclid` | Meta (Facebook/Instagram) | Paid Social |
| `ttclid` | TikTok | Paid Social |
| `li_fat_id` | LinkedIn | Paid Social |
| `rdt_cid` | Reddit | Paid Social |
| `msclkid` | Microsoft Ads | Paid Search |
| `twclid` | X (Twitter) | Paid Social |
| `epik` | Pinterest | Paid Social |
| `sccid` | Snapchat | Paid Social |

Only `gclid`, `dclid`, and `srsltid` have dedicated columns in
`collected_traffic_source`; every other click ID in this table exists only as a URL query
parameter on `page_location`. Extract with:

```sql
REGEXP_EXTRACT(page_location, r'[?&]fbclid=([^&]+)')
```

`srsltid` (Google Shopping's free-listing click id) is present as a dedicated
`collected_traffic_source` column but does not by itself imply Paid - it appears on organic
Shopping surfaces too. Do not add it to the paid-classification check without also verifying
`medium`.

## Social-source list

Use for the Paid Social split in rule 2 and the Organic Social match in rule 8. Match
case-insensitively (normalize with `LOWER()` and strip a leading `www.`); GA4 sources appear
both as bare platform names (`facebook`, `meta`, `ig`) and as hostnames (`facebook.com`,
`l.instagram.com`, `lm.facebook.com`).

```
facebook, facebook.com, m.facebook.com, l.facebook.com, lm.facebook.com,
instagram, instagram.com, l.instagram.com, meta, ig,
tiktok, tiktok.com,
linkedin, linkedin.com,
pinterest, pinterest.com,
reddit, reddit.com, old.reddit.com,
twitter, twitter.com, t.co, x, x.com,
snapchat, snapchat.com
```

`meta` and `ig` are observed GA4 `source` values on live exports (not just documentation
guesses) - add them alongside the hostname/platform-name forms, not in place of them.

Extend this list per property - some properties see additional social referrers (Threads,
Mastodon instances, YouTube community posts) that are not universally present.

## Search-engine list

Use to sanity-check `medium = organic` rows and to decide Paid Search vs. Paid Social vs. Paid
Other for rows that match the paid-medium regex in rule 2 (a `source` on this list with a
paid medium is Paid Search, never Paid Social or Paid Other).

```
google, google.com, bing, bing.com, yahoo, duckduckgo, baidu, yandex, ecosia, ask, aol
```

## GA4's default channel groups

`cross_channel_campaign.default_channel_group` was non-NULL on 100% of events with a
`user_pseudo_id` on the day checked, across both verification properties. Distinct values
observed:

```
Direct, Paid Search, Paid Social, Paid Shopping, Cross-network, Organic Search,
Organic Social, Organic Shopping, Organic Video, Email, SMS, Referral, Affiliates,
AI Assistant, Unassigned
```

Documented GA4 channel groups not observed on the verification day, but that can still appear:
`Display`, `Paid Video`, `Paid Other`, `Audio`, `Mobile Push Notifications`. `AI Assistant` is
a newer group (traffic from AI chat/assistant surfaces, e.g. `chatgpt.com` with medium
`ai-assistant`) observed in live exports in 2026 - GA4's channel-group list grows over time;
do not treat either list here as exhaustive or final.

## Why `cross_channel_campaign`, not `manual_campaign`

`session_traffic_source_last_click.manual_campaign.source`/`.medium` read `(not set)`/
`(not set)` for both GA4 `Direct` sessions and GA4 `Unassigned` sessions - the two cannot be
told apart from `manual_campaign` alone. `cross_channel_campaign.source`/`.medium` read
`(direct)`/`(none)` for Direct sessions and `(not set)`/`(not set)` for Unassigned, so it is
the field pair that actually distinguishes them.

## Notes

- `medium` and `source` values are inconsistent across properties and over time - GA4 has
  changed default medium values (`organic` vs `(organic)`, presence/absence of parentheses)
  across SDK versions. Normalize with `LOWER()` and strip surrounding parentheses before
  comparing, or match on `LIKE '%organic%'` style patterns if a property shows drift.
- `(not set)`/`(not set)` on `cross_channel_campaign.source`/`.medium` resolves to
  `Unassigned`, not `Direct` - see "Why `cross_channel_campaign`, not `manual_campaign`" above.
  `(not set)` and `(not provided)` are distinct GA4 sentinel values, not the same as NULL;
  treat both as unclassified input that should still resolve to a channel via the rules above.
  Typical `Unassigned` residents: custom affiliate/influencer link mediums (e.g.
  `Affiliate_link_25p`), affiliate networks with a NULL medium or a publisher name as the
  source, programmatic traffic (medium `Programmatic`), and QR-code traffic (`qrcode`). This
  is exactly where a custom rule table earns its keep over reading `default_channel_group`
  as-is.
- See `references/sql/channel_daily.sql` for the rule table implemented as a single `CASE`
  expression, tested against two live GA4 export datasets.

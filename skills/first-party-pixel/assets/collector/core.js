// First-party pixel collector: runtime-agnostic core.
//
// handleCollect(payload, ctx, db) implements the entire /collect endpoint
// contract; every adapter in ../node, ../vercel, ../supabase, ../cloudflare
// is a thin shim that extracts (payload, ctx) from its runtime's request
// object and calls this function against a `db.query(text, params) =>
// Promise<{ rows }>` wrapper.
//
//   ctx = {
//     ip: string | null,          // caller's IP, as seen by the adapter
//     userAgent: string | null,
//     origin: string | null,      // request Origin header
//     now: () => Date,            // injected clock, defaults to `() => new Date()`
//     salt: string,               // server-side secret used to hash IPs
//     ipRetention: number,        // days; informational, purge runs separately
//   }
//
// Uses the Web Crypto API (globalThis.crypto.subtle) for hashing so the same
// module runs unmodified on Node 20+, Deno, Cloudflare Workers, and in a
// browser, no runtime-specific crypto import.

const CLICK_ID_PARAMS = [
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "ttclid",
  "rdt_cid",
  "li_fat_id",
  "msclkid",
  "twclid",
  "epik",
  "sccid",
];

const PLATFORM_COOKIE_KEYS = ["_fbp", "_fbc", "_rdt_uuid", "_ttp"];

const EVENT_TYPES = ["pageview", "track", "identify", "form_submit", "consent"];

const CONVERSION_EVENT_NAMES = ["purchase", "generate_lead", "sign_up", "form_submit"];

const BOT_UA_RE = /bot|crawl|spider|slurp|headless|phantomjs|lighthouse|pingdom|monitor/i;

const TOUCHPOINT_DEDUPE_WINDOW_MINUTES = 30;

const MAX_STRING_LEN = 2048;
const MAX_PROPERTIES_JSON_LEN = 20000;

// ---------------------------------------------------------------------------
// Channel derivation (also exported standalone for unit testing)
// ---------------------------------------------------------------------------

const SEARCH_ENGINE_SOURCES = new Set([
  "google",
  "bing",
  "yahoo",
  "duckduckgo",
  "baidu",
  "yandex",
  "ecosia",
  "ask",
  "aol",
]);

const SEARCH_ENGINE_HOST_FRAGMENTS = [
  "google.",
  "bing.com",
  "yahoo.",
  "duckduckgo.com",
  "baidu.com",
  "yandex.",
  "ecosia.org",
  "ask.com",
  "aol.com",
];

const SOCIAL_SOURCES = new Set([
  "facebook",
  "instagram",
  "meta",
  "ig",
  "tiktok",
  "linkedin",
  "pinterest",
  "reddit",
  "twitter",
  "x",
  "snapchat",
  "threads",
]);

const SOCIAL_HOST_FRAGMENTS = [
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "twitter.com",
  "t.co",
  "x.com",
  "snapchat.com",
  "threads.net",
];

const AFFILIATE_NETWORK_SOURCES = new Set(["cj", "rakuten", "impact", "shareasale", "awin", "partnerize"]);

const PAID_MEDIUM_RE = /^(.*cp.*|ppc|retargeting|paid.*)$/;

function normalizeLower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hostOf(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const host = new URL(url).host.toLowerCase();
    return host.replace(/^www\./, "");
  } catch (e) {
    const match = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
    if (!match) return null;
    return match[1].toLowerCase().replace(/^www\./, "");
  }
}

function hostMatchesAny(host, fragments) {
  if (!host) return false;
  return fragments.some((fragment) => host.indexOf(fragment) !== -1);
}

/**
 * Derives one of the 12 fixed channel labels from a touch's raw signals.
 * Deterministic precedence, evaluated in order, first match wins:
 *
 *  1. dclid                                          -> Display
 *  2. gclid/gbraid/wbraid/msclkid                     -> Paid Search
 *  3. fbclid/ttclid/li_fat_id/rdt_cid/twclid/epik/sccid -> Paid Social
 *  4. medium matches /^(.*cp.*|ppc|retargeting|paid.*)$/
 *       -> Paid Search (source is a search engine)
 *       -> Paid Social (source is a social platform)
 *       -> Paid Other  (anything else)
 *  5. medium = organic                                -> Organic Search
 *  6. medium = email                                  -> Email
 *  7. medium = sms                                    -> SMS
 *  8. medium contains "affiliate", or source is a known affiliate network
 *                                                      -> Affiliates
 *  9. medium = referral, or an external referrer with no utm params at all
 *       -> Organic Search (referrer host is a search engine)
 *       -> Organic Social (referrer host is a social platform)
 *       -> Referral (anything else)
 * 10. no signal whatsoever                             -> Direct
 * 11. everything else                                  -> Unassigned
 *
 * input: {
 *   utm_source, utm_medium: string | null,
 *   click_ids: { <12 click-id names>: string | null },
 *   referrer, landing_url: string | null,
 * }
 */
export function deriveChannel(input) {
  const params = input || {};
  const source = normalizeLower(params.utm_source);
  const medium = normalizeLower(params.utm_medium);
  const clickIds = params.click_ids || {};

  if (clickIds.dclid) return "Display";
  if (clickIds.gclid || clickIds.gbraid || clickIds.wbraid || clickIds.msclkid) return "Paid Search";
  if (
    clickIds.fbclid ||
    clickIds.ttclid ||
    clickIds.li_fat_id ||
    clickIds.rdt_cid ||
    clickIds.twclid ||
    clickIds.epik ||
    clickIds.sccid
  ) {
    return "Paid Social";
  }

  if (medium && PAID_MEDIUM_RE.test(medium)) {
    if (SEARCH_ENGINE_SOURCES.has(source)) return "Paid Search";
    if (SOCIAL_SOURCES.has(source)) return "Paid Social";
    return "Paid Other";
  }

  if (medium === "organic") return "Organic Search";
  if (medium === "email") return "Email";
  if (medium === "sms") return "SMS";
  if ((medium && medium.indexOf("affiliate") !== -1) || AFFILIATE_NETWORK_SOURCES.has(source)) return "Affiliates";

  const referrerHost = hostOf(params.referrer);
  const pageHost = hostOf(params.landing_url);
  const externalReferrer = !!referrerHost && referrerHost !== pageHost;
  const noUtmAtAll = !source && !medium;

  if (medium === "referral" || (externalReferrer && noUtmAtAll)) {
    if (hostMatchesAny(referrerHost, SEARCH_ENGINE_HOST_FRAGMENTS)) return "Organic Search";
    if (hostMatchesAny(referrerHost, SOCIAL_HOST_FRAGMENTS)) return "Organic Social";
    return "Referral";
  }

  const hasAnyClickId = Object.keys(clickIds).some((key) => clickIds[key]);
  const hasAnySignal = !!(source || medium || externalReferrer || hasAnyClickId);
  if (!hasAnySignal) return "Direct";

  return "Unassigned";
}

// ---------------------------------------------------------------------------
// Hashing + canonicalization
// ---------------------------------------------------------------------------

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

// Best-effort E.164 canonicalization: keep a leading '+' if the source value
// had one, strip everything but digits. This is not full phone-number
// validation (no country-code inference for numbers without a '+'); it is
// enough to make the same phone typed two different ways hash identically.
function canonicalizePhone(phone) {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  const hasPlus = trimmed.charAt(0) === "+";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return (hasPlus ? "+" : "") + digits;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validPayload(payload) {
  if (!isPlainObject(payload)) return "payload must be an object";
  if (typeof payload.site_key !== "string" || !payload.site_key || payload.site_key.length > 200) {
    return "site_key is required";
  }
  if (typeof payload.visitor_uid !== "string" || !payload.visitor_uid || payload.visitor_uid.length > 200) {
    return "visitor_uid is required";
  }
  if (typeof payload.event_type !== "string" || EVENT_TYPES.indexOf(payload.event_type) === -1) {
    return "event_type must be one of " + EVENT_TYPES.join(", ");
  }
  if (payload.event_name != null && (typeof payload.event_name !== "string" || payload.event_name.length > 200)) {
    return "event_name must be a short string or null";
  }
  if (payload.url != null && (typeof payload.url !== "string" || payload.url.length > MAX_STRING_LEN)) {
    return "url is too long";
  }
  if (payload.referrer != null && (typeof payload.referrer !== "string" || payload.referrer.length > MAX_STRING_LEN)) {
    return "referrer is too long";
  }
  if (typeof payload.occurred_at !== "string" || Number.isNaN(Date.parse(payload.occurred_at))) {
    return "occurred_at must be a parseable timestamp";
  }
  if (payload.properties != null) {
    if (!isPlainObject(payload.properties)) return "properties must be an object";
    if (JSON.stringify(payload.properties).length > MAX_PROPERTIES_JSON_LEN) return "properties is too large";
  }
  if (payload.utm != null && !isPlainObject(payload.utm)) return "utm must be an object";
  if (payload.click_ids != null && !isPlainObject(payload.click_ids)) return "click_ids must be an object";
  if (payload.platform_cookies != null && !isPlainObject(payload.platform_cookies)) {
    return "platform_cookies must be an object";
  }
  if (payload.identity != null && !isPlainObject(payload.identity)) return "identity must be an object or null";
  if (payload.consent != null && !isPlainObject(payload.consent)) return "consent must be an object or null";
  return null;
}

// ---------------------------------------------------------------------------
// handleCollect
// ---------------------------------------------------------------------------

export async function handleCollect(payload, ctx, db) {
  const now = ctx && typeof ctx.now === "function" ? ctx.now() : new Date();
  const salt = (ctx && ctx.salt) || "";

  const validationError = validPayload(payload);
  if (validationError) {
    return { status: 400, body: { error: validationError } };
  }

  const siteRows = (await db.query("SELECT allowed_origins FROM pixel.sites WHERE site_key = $1", [payload.site_key])).rows;
  if (!siteRows.length) {
    return { status: 403, body: { error: "unknown site_key" } };
  }
  const allowedOrigins = siteRows[0].allowed_origins || [];
  const origin = ctx && ctx.origin;
  if (allowedOrigins.length > 0 && (!origin || allowedOrigins.indexOf(origin) === -1)) {
    return { status: 403, body: { error: "origin not allowed" } };
  }

  const userAgent = (ctx && ctx.userAgent) || "";
  if (BOT_UA_RE.test(userAgent)) {
    return { status: 204, body: null };
  }

  const occurredAt = new Date(payload.occurred_at);
  const ip = (ctx && ctx.ip) || null;
  const ipHash = ip ? await sha256Hex(salt + ip) : null;

  const visitorRow = (
    await db.query(
      `INSERT INTO pixel.visitors (site_key, visitor_uid, first_seen_at, last_seen_at, user_agent, ip_hash, last_ip)
       VALUES ($1, $2, $3, $3, $4, $5, $6)
       ON CONFLICT (site_key, visitor_uid) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         user_agent = COALESCE(EXCLUDED.user_agent, pixel.visitors.user_agent),
         ip_hash = COALESCE(EXCLUDED.ip_hash, pixel.visitors.ip_hash),
         last_ip = COALESCE(EXCLUDED.last_ip, pixel.visitors.last_ip)
       RETURNING id`,
      [payload.site_key, payload.visitor_uid, now.toISOString(), userAgent || null, ipHash, ip]
    )
  ).rows[0];
  const visitorId = visitorRow.id;

  const eventRow = (
    await db.query(
      `INSERT INTO pixel.events (site_key, visitor_id, event_type, event_name, url, referrer, properties, ip, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        payload.site_key,
        visitorId,
        payload.event_type,
        payload.event_name || null,
        payload.url || null,
        payload.referrer || null,
        JSON.stringify(payload.properties || {}),
        ip,
        occurredAt.toISOString(),
      ]
    )
  ).rows[0];
  const eventId = eventRow.id;

  // Known-contact lookup: a visitor already resolved by an earlier event
  // (this is a fresh invocation per request, so nothing carries forward in
  // memory) gets every subsequent touchpoint/conversion on this visitor
  // stamped with that contact_id immediately, not just retroactively via the
  // back-fill UPDATE below. The identity block further down overrides this
  // when the current event itself resolves (or re-resolves) identity.
  let contactId = null;
  {
    const existingLink = (
      await db.query(`SELECT contact_id FROM pixel.identity_links WHERE visitor_id = $1 ORDER BY created_at DESC LIMIT 1`, [
        visitorId,
      ])
    ).rows;
    if (existingLink.length) contactId = existingLink[0].contact_id;
  }

  // ---- identity resolution (identify / form_submit) ------------------------
  if ((payload.event_type === "identify" || payload.event_type === "form_submit") && payload.identity) {
    const emailCanonical = canonicalizeEmail(payload.identity.email);
    const phoneE164 = canonicalizePhone(payload.identity.phone);
    if (emailCanonical || phoneE164) {
      const emailHash = emailCanonical ? await sha256Hex(emailCanonical) : null;
      const phoneHash = phoneE164 ? await sha256Hex(phoneE164) : null;

      let contactRow;
      if (emailHash) {
        contactRow = (
          await db.query(
            `INSERT INTO pixel.contacts (site_key, email_canonical, email_hash, phone_e164, phone_hash)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (site_key, email_hash) DO UPDATE SET
               phone_e164 = COALESCE(pixel.contacts.phone_e164, EXCLUDED.phone_e164),
               phone_hash = COALESCE(pixel.contacts.phone_hash, EXCLUDED.phone_hash)
             RETURNING id`,
            [payload.site_key, emailCanonical, emailHash, phoneE164, phoneHash]
          )
        ).rows[0];
      } else {
        contactRow = (
          await db.query(
            `INSERT INTO pixel.contacts (site_key, email_canonical, email_hash, phone_e164, phone_hash)
             VALUES ($1, NULL, NULL, $2, $3)
             ON CONFLICT (site_key, phone_hash) DO UPDATE SET
               phone_e164 = EXCLUDED.phone_e164
             RETURNING id`,
            [payload.site_key, phoneE164, phoneHash]
          )
        ).rows[0];
      }
      contactId = contactRow.id;

      await db.query(
        `INSERT INTO pixel.identity_links (visitor_id, contact_id, confidence, source)
         VALUES ($1, $2, 1.0, $3)
         ON CONFLICT (visitor_id, contact_id) DO NOTHING`,
        [visitorId, contactId, payload.event_type]
      );

      // Additive back-fill: any touchpoint already recorded for this visitor
      // that hasn't been linked to a contact yet gets this one.
      await db.query(`UPDATE pixel.touchpoints SET contact_id = $1 WHERE visitor_id = $2 AND contact_id IS NULL`, [
        contactId,
        visitorId,
      ]);
    }
  }

  // ---- consent -----------------------------------------------------------
  if (payload.event_type === "consent" && payload.consent) {
    await db.query(
      `INSERT INTO pixel.consent_state (visitor_id, analytics, ads, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (visitor_id) DO UPDATE SET
         analytics = EXCLUDED.analytics,
         ads = EXCLUDED.ads,
         updated_at = EXCLUDED.updated_at`,
      [visitorId, !!payload.consent.analytics, !!payload.consent.ads, now.toISOString()]
    );
  }

  // ---- touchpoint derivation (pageview only) ------------------------------
  if (payload.event_type === "pageview") {
    const utm = payload.utm || {};
    const clickIds = payload.click_ids || {};
    const hasUtm = !!(utm.source || utm.medium || utm.campaign || utm.content || utm.term);
    const hasClickId = CLICK_ID_PARAMS.some((name) => clickIds[name]);
    const referrerHost = hostOf(payload.referrer);
    const pageHost = hostOf(payload.url);
    const hasExternalReferrer = !!referrerHost && referrerHost !== pageHost;
    const carriesSourceSignal = hasUtm || hasClickId || hasExternalReferrer;

    // "The visitor's first event ever" is the degenerate case of a broader
    // rule: every session's landing pageview gets a touchpoint, signal or
    // not, so pixel.sessions always has a real channel to join against
    // instead of falling back to its own no-touchpoint Direct/Unassigned
    // guess. A session starts when there is no prior pageview/track/
    // form_submit event for this visitor in the preceding 30 minutes - the
    // same inactivity window pixel.sessions itself sessionizes on.
    const priorEventInWindow = (
      await db.query(
        `SELECT 1 FROM pixel.events
         WHERE visitor_id = $1
           AND event_type IN ('pageview', 'track', 'form_submit')
           AND occurred_at < $2::timestamptz
           AND occurred_at >= $2::timestamptz - interval '30 minutes'
         LIMIT 1`,
        [visitorId, occurredAt.toISOString()]
      )
    ).rows;
    const startsNewSession = priorEventInWindow.length === 0;

    if (carriesSourceSignal || startsNewSession) {
      const channel = deriveChannel({
        utm_source: utm.source,
        utm_medium: utm.medium,
        click_ids: clickIds,
        referrer: payload.referrer,
        landing_url: payload.url,
      });

      const existing = (
        await db.query(
          `SELECT id FROM pixel.touchpoints
           WHERE visitor_id = $1 AND channel = $2
             AND occurred_at >= $3::timestamptz - make_interval(mins => $4)
             AND occurred_at <= $3::timestamptz
           ORDER BY occurred_at DESC
           LIMIT 1`,
          [visitorId, channel, occurredAt.toISOString(), TOUCHPOINT_DEDUPE_WINDOW_MINUTES]
        )
      ).rows;

      if (!existing.length) {
        await db.query(
          `INSERT INTO pixel.touchpoints (
             site_key, visitor_id, contact_id, event_id, channel,
             utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             gclid, gbraid, wbraid, dclid, fbclid, ttclid, rdt_cid, li_fat_id, msclkid, twclid, epik, sccid,
             referrer, landing_url, occurred_at
           )
           VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
             $23, $24, $25
           )`,
          [
            payload.site_key,
            visitorId,
            contactId,
            eventId,
            channel,
            utm.source || null,
            utm.medium || null,
            utm.campaign || null,
            utm.content || null,
            utm.term || null,
            clickIds.gclid || null,
            clickIds.gbraid || null,
            clickIds.wbraid || null,
            clickIds.dclid || null,
            clickIds.fbclid || null,
            clickIds.ttclid || null,
            clickIds.rdt_cid || null,
            clickIds.li_fat_id || null,
            clickIds.msclkid || null,
            clickIds.twclid || null,
            clickIds.epik || null,
            clickIds.sccid || null,
            payload.referrer || null,
            payload.url || null,
            occurredAt.toISOString(),
          ]
        );
      }
    }
  }

  // ---- conversion detection (form_submit / track) -------------------------
  // Every form_submit is a conversion by definition (the whitelisted event
  // name "form_submit" below documents that rather than gating on it, an
  // event_type check is used instead so callers don't have to also set
  // event_name to get the credit). A track event only counts when the
  // caller flagged it explicitly (properties.is_conversion) or its name is
  // on the fixed conversion-name list.
  const properties = payload.properties || {};
  const isConversion =
    payload.event_type === "form_submit" ||
    (payload.event_type === "track" &&
      (properties.is_conversion === true || CONVERSION_EVENT_NAMES.indexOf(payload.event_name) !== -1));

  if (isConversion) {
    const value = typeof properties.value === "number" ? properties.value : null;
    const currency = typeof properties.currency === "string" ? properties.currency : null;
    await db.query(
      `INSERT INTO pixel.conversion_events (site_key, visitor_id, contact_id, event_id, event_name, occurred_at, value, currency, page_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        payload.site_key,
        visitorId,
        contactId,
        eventId,
        payload.event_name || payload.event_type,
        occurredAt.toISOString(),
        value,
        currency,
        payload.url || null,
      ]
    );
  }

  return { status: 204, body: null };
}

export const __internal = {
  CLICK_ID_PARAMS,
  PLATFORM_COOKIE_KEYS,
  hostOf,
  canonicalizeEmail,
  canonicalizePhone,
  sha256Hex,
};

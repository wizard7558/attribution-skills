// First-party pixel collector: runtime-agnostic core.
//
// handleCollect(payload, ctx, db) implements the entire /collect endpoint
// contract; every adapter in ../node, ../vercel, ../supabase, ../cloudflare
// is a thin shim that extracts (payload, ctx) from its runtime's request
// object and calls this function against a database with query(text, params)
// and transaction(async tx => result). All request queries use tx.query.
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

import { classify, classifyChannel, extractRawTrackingEvidence, TAXONOMY_VERSION } from "./channel-taxonomy.mjs";
import { parseCollectorTimestamp } from "./timestamp.mjs";
import { canonicalizeEmail, canonicalizePhone } from "./identity-normalization.mjs";

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
  "srsltid",
];

const UTM_PARAMS = ["source", "medium", "campaign", "content", "term"];

// Preserve only recognized raw string evidence; decoding belongs to the classifier.
function rawTracking(source, names) {
  return Object.fromEntries(names.map((name) => [name, typeof source?.[name] === "string" ? source[name] : null]));
}

const PLATFORM_COOKIE_KEYS = ["_fbp", "_fbc", "_rdt_uuid", "_ttp"];

const EVENT_TYPES = ["pageview", "track", "identify", "form_submit", "consent"];

const CONVERSION_EVENT_NAMES = ["purchase", "generate_lead", "sign_up", "form_submit"];

const BOT_UA_RE = /bot|crawl|spider|slurp|headless|phantomjs|lighthouse|pingdom|monitor/i;

const MAX_STRING_LEN = 2048;
const MAX_PROPERTIES_JSON_LEN = 20000;

// URL host extraction used only for touchpoint signal detection. Channel
// semantics remain exclusively in the shared taxonomy module.
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

// The shared taxonomy is the only channel implementation. This compatibility
// wrapper keeps the collector's public helper stable for existing callers.
export function deriveChannel(input) {
  return classifyChannel(input);
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

function normalizeCurrency(currency) {
  if (typeof currency !== "string") return null;
  const normalized = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
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

  let timestamp;
  try { timestamp = parseCollectorTimestamp(payload.occurred_at); }
  catch (error) { return { status: 400, body: { error: error.message } }; }

  if (!db || typeof db.transaction !== "function") {
    throw new TypeError("collector database must support interactive transactions");
  }
  return db.transaction(async (tx) => {
    const siteRows = (await tx.query("SELECT allowed_origins FROM pixel.sites WHERE site_key = $1", [payload.site_key])).rows;
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

    const utm = rawTracking(payload.utm, UTM_PARAMS);
    const clickIds = rawTracking(payload.click_ids, CLICK_ID_PARAMS);
    const ip = (ctx && ctx.ip) || null;
    const ipHash = ip ? await sha256Hex(salt + ip) : null;

    const visitorRow = (
      await tx.query(
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
      await tx.query(
        `INSERT INTO pixel.events (site_key, visitor_id, event_type, event_name, url, referrer, properties, ip, occurred_at, utm, click_ids, occurred_at_iso)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          timestamp.postgres,
          JSON.stringify(utm),
          JSON.stringify(clickIds),
          timestamp.original,
        ]
      )
    ).rows[0];
    const eventId = eventRow.id;

    // Native ownership is current-event evidence only. Prior visitor links are
    // neither a person-selection rule nor authority to rewrite earlier touches.
    let contactId = null;

    // ---- identity resolution (identify / form_submit) ------------------------
    if (payload.event_type === "identify" || payload.event_type === "form_submit") {
      const emailCanonical = canonicalizeEmail(payload.identity?.email);
      const phoneE164 = canonicalizePhone(payload.identity?.phone);
      const emailHash = emailCanonical ? await sha256Hex(emailCanonical) : null;
      const phoneHash = phoneE164 ? await sha256Hex(phoneE164) : null;
      await tx.query(
        `INSERT INTO pixel.identity_observations
         (event_id, site_key, visitor_id, source_event_type, occurred_at, occurred_at_iso,
          email_hash, phone_hash, identity_input_format, identity_normalization_version, capture_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'canonical_sha256_v1', '0.1.0', $9)`,
        [eventId, payload.site_key, visitorId, payload.event_type, timestamp.postgres, timestamp.original,
          emailHash, phoneHash, emailHash || phoneHash ? 'eligible' : 'no_valid_identity']
      );
      if (emailHash || phoneHash) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('pixel.identity:' || $1, 0))", [payload.site_key]);
        const rows = (await tx.query(
          `SELECT id, email_canonical, email_hash, phone_e164, phone_hash, email_hash_format, phone_hash_format
           FROM pixel.contacts WHERE site_key = $1 AND (email_hash = $2 OR phone_hash = $3)
           ORDER BY id FOR UPDATE`,
          [payload.site_key, emailHash, phoneHash]
        )).rows;
        const candidates = [...new Map(rows.map((row) => [row.id, row])).values()];
        if (candidates.length === 0) {
          contactId = (await tx.query(
            `INSERT INTO pixel.contacts (site_key, email_canonical, email_hash, phone_e164, phone_hash, email_hash_format, phone_hash_format)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [payload.site_key, emailCanonical, emailHash, phoneE164, phoneHash,
              emailHash ? 'canonical_sha256_v1' : null, phoneHash ? 'canonical_sha256_v1' : null]
          )).rows[0].id;
        } else {
          const unique = candidates.length === 1;
          for (const candidate of candidates) {
            const patch = {};
            for (const [rawKey, hashKey, formatKey, raw, hash] of [
              ['email_canonical', 'email_hash', 'email_hash_format', emailCanonical, emailHash],
              ['phone_e164', 'phone_hash', 'phone_hash_format', phoneE164, phoneHash]
            ]) {
              if (!hash) continue;
              const matches = candidate[hashKey] === hash;
              const fillHash = unique && candidate[hashKey] === null && (candidate[rawKey] === null || candidate[rawKey] === raw);
              if (!matches && !fillHash) continue;
              if (fillHash) patch[hashKey] = hash;
              if (unique && candidate[rawKey] === null) patch[rawKey] = raw;
              if (candidate[formatKey] !== 'canonical_sha256_v1') patch[formatKey] = 'canonical_sha256_v1';
            }
            const keys = Object.keys(patch);
            if (keys.length) await tx.query(
              `UPDATE pixel.contacts SET ${keys.map((key, index) => `${key} = $${index + 3}`).join(', ')} WHERE site_key = $1 AND id = $2`,
              [payload.site_key, candidate.id, ...keys.map((key) => patch[key])]
            );
          }
          if (unique) contactId = candidates[0].id;
        }
        if (contactId !== null) await tx.query(
          `INSERT INTO pixel.identity_links (visitor_id, contact_id, confidence, source)
           VALUES ($1, $2, 1.0, $3)
           ON CONFLICT (visitor_id, contact_id) DO NOTHING`,
          [visitorId, contactId, payload.event_type]
        );
      }
    }

    // ---- consent -----------------------------------------------------------
    if (payload.event_type === "consent" && payload.consent) {
      await tx.query(
        `INSERT INTO pixel.consent_state (visitor_id, analytics, ads, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (visitor_id) DO UPDATE SET
           analytics = EXCLUDED.analytics,
           ads = EXCLUDED.ads,
           updated_at = EXCLUDED.updated_at`,
        [visitorId, !!payload.consent.analytics, !!payload.consent.ads, now.toISOString()]
      );
    }

    // Every accepted pageview is one native observation. Session first-touch
    // reporting uses these rows; canonical attribution dedupe runs on full exports.
    if (payload.event_type === "pageview") {
      const classificationInput = {
        utm_source: utm.source,
        utm_medium: utm.medium,
        utm_campaign: utm.campaign,
        utm_content: utm.content,
        utm_term: utm.term,
        click_ids: clickIds,
        referrer: payload.referrer,
        landing_url: payload.url,
      };
      const classification = classify(classificationInput);
      const evidence = extractRawTrackingEvidence(classificationInput);
      const channel = classification.channel;
      await tx.query(
        `INSERT INTO pixel.touchpoints (
           site_key, visitor_id, contact_id, event_id, channel,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           gclid, gbraid, wbraid, dclid, fbclid, ttclid, rdt_cid, li_fat_id, msclkid, twclid, epik, sccid, srsltid,
           referrer, landing_url, occurred_at, taxonomy_version, occurred_at_iso
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
           $23, $24, $25, $26, $27, $28
         )`,
        [
          payload.site_key,
          visitorId,
          contactId,
          eventId,
          channel,
          evidence.utm_source,
          evidence.utm_medium,
          evidence.utm_campaign,
          evidence.utm_content,
          evidence.utm_term,
          evidence.click_ids.gclid,
          evidence.click_ids.gbraid,
          evidence.click_ids.wbraid,
          evidence.click_ids.dclid,
          evidence.click_ids.fbclid,
          evidence.click_ids.ttclid,
          evidence.click_ids.rdt_cid,
          evidence.click_ids.li_fat_id,
          evidence.click_ids.msclkid,
          evidence.click_ids.twclid,
          evidence.click_ids.epik,
          evidence.click_ids.sccid,
          evidence.click_ids.srsltid,
          payload.referrer || null,
          payload.url || null,
          timestamp.postgres,
          classification.taxonomy_version || TAXONOMY_VERSION,
          timestamp.original,
        ]
      );
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
      const currency = normalizeCurrency(properties.currency);
      await tx.query(
        `INSERT INTO pixel.conversion_events (site_key, visitor_id, contact_id, event_id, event_name, occurred_at, value, currency, page_url, occurred_at_iso)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          payload.site_key,
          visitorId,
          contactId,
          eventId,
          payload.event_name || payload.event_type,
          timestamp.postgres,
          value,
          currency,
          payload.url || null,
          timestamp.original,
        ]
      );
    }

    return { status: 204, body: null };
  });
}

export const __internal = {
  CLICK_ID_PARAMS,
  PLATFORM_COOKIE_KEYS,
  hostOf,
  canonicalizeEmail,
  canonicalizePhone,
  normalizeCurrency,
  sha256Hex,
};

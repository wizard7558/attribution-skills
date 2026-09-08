/*!
 * First-party pixel: dependency-free browser tracking snippet.
 *
 * Install:
 *   <script src="https://cdn.example.com/pixel.js"
 *           data-site-key="site_abc123"
 *           data-endpoint="https://collect.example.com/collect"
 *           data-consent-mode="anonymous-until-consent"
 *           data-forms="native,hubspot"></script>
 *
 * Public API: window.fpx(command, ...args). Calls made before this script
 * has loaded are queued by the standard snippet stub and drained on load:
 *
 *   window.fpx = window.fpx || function () { (fpx.q = fpx.q || []).push(arguments); };
 *
 *   fpx('track', 'clicked_pricing', { plan: 'pro' })
 *   fpx('identify', { email: 'person@example.com', phone: '+15555550123' })
 *   fpx('consent', { analytics: true, ads: false })
 *
 * Consent modes (data-consent-mode):
 *   - "none"                       No consent gate. Events send from the first
 *                                   page load using the persistent visitor id.
 *   - "anonymous-until-consent"    Default. Events send immediately using a
 *                                   random, page-load-scoped id and no cookie.
 *                                   Once consent is granted, the pixel mints
 *                                   the persistent id and switches to it.
 *   - "required"                   No cookie is set and nothing is sent until
 *                                   consent is granted.
 *
 * Payload contract (JSON POST body), one shape for every event type:
 *   {
 *     site_key, visitor_uid, event_type, event_name, url, referrer,
 *     occurred_at, properties,
 *     utm: { source, medium, campaign, content, term },
 *     click_ids: { gclid, gbraid, wbraid, dclid, fbclid, ttclid, rdt_cid,
 *                  li_fat_id, msclkid, twclid, epik, sccid, srsltid },
 *     platform_cookies: { _fbp, _fbc, _rdt_uuid, _ttp },
 *     identity: { email, phone } | null,
 *     consent: { analytics, ads } | null
 *   }
 *
 * Transport: navigator.sendBeacon first, fetch(..., { keepalive: true }) as
 * the fallback. Content-Type is text/plain (not application/json) so the
 * request stays a CORS "simple request" and never triggers a preflight.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();
  if (!script) return;

  var SITE_KEY = script.getAttribute("data-site-key");
  var ENDPOINT = script.getAttribute("data-endpoint");
  if (!SITE_KEY || !ENDPOINT) {
    if (window.console) console.warn("[pixel] missing data-site-key or data-endpoint");
    return;
  }

  var CONSENT_MODE = script.getAttribute("data-consent-mode") || "anonymous-until-consent";
  var FORMS_ATTR = script.getAttribute("data-forms");
  var ENABLED_FORM_ADAPTERS = FORMS_ATTR
    ? FORMS_ATTR.split(",").reduce(function (set, name) {
        name = name.replace(/^\s+|\s+$/g, "").toLowerCase();
        if (name) set[name] = true;
        return set;
      }, {})
    : { native: true };

  // ---- storage keys ---------------------------------------------------------
  var VISITOR_KEY = "_fpv";
  var CONSENT_KEY = "_fpx_consent";
  var CLICK_ID_STORE_KEY = "_fpx_cids";
  var CLICK_ID_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var VISITOR_COOKIE_DAYS = 400;
  var CLICK_ID_MAX_LEN = 512;

  var CLICK_ID_PARAMS = [
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

  var PLATFORM_COOKIES = ["_fbp", "_fbc", "_rdt_uuid", "_ttp"];

  var BOT_UA_RE = /bot|crawl|spider|slurp|headless|phantomjs|lighthouse|pingdom|monitor/i;

  // ---- small utilities --------------------------------------------------------
  function trim(v) {
    return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "");
  }

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      if (window.crypto && crypto.getRandomValues) {
        var bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var hex = [];
        for (var i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1));
        return (
          hex[0] + hex[1] + hex[2] + hex[3] + "-" + hex[4] + hex[5] + "-" + hex[6] + hex[7] + "-" +
          hex[8] + hex[9] + "-" + hex[10] + hex[11] + hex[12] + hex[13] + hex[14] + hex[15]
        );
      }
    } catch (e) {}
    return "fpx-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  }

  function readCookie(name) {
    var match = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return match ? decodeURIComponent(match.pop()) : null;
  }

  // Best-effort registrable domain: walk from the full hostname up one label
  // at a time, writing a probe cookie at each level, and keep the shortest
  // level where the cookie is still readable back. Falls back to no domain
  // attribute (host-only cookie) when this can't be determined, which is
  // always safe, just narrower than a shared subdomain cookie.
  function registrableDomain() {
    var host = window.location.hostname;
    if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    var labels = host.split(".");
    for (var i = labels.length - 2; i >= 0; i--) {
      var candidate = labels.slice(i).join(".");
      var probeName = "_fpx_probe";
      try {
        document.cookie = probeName + "=1;domain=." + candidate + ";path=/";
        if (readCookie(probeName) === "1") {
          document.cookie = probeName + "=;domain=." + candidate + ";path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT";
          return candidate;
        }
      } catch (e) {}
    }
    return null;
  }

  var REGISTRABLE_DOMAIN = registrableDomain();

  function writeCookie(name, value, days) {
    try {
      var expires = new Date();
      expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
      var cookie = name + "=" + encodeURIComponent(value) + ";expires=" + expires.toUTCString() + ";path=/;SameSite=Lax";
      if (window.location.protocol === "https:") cookie += ";Secure";
      if (REGISTRABLE_DOMAIN) cookie += ";domain=." + REGISTRABLE_DOMAIN;
      document.cookie = cookie;
    } catch (e) {}
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {}
  }

  function isBot() {
    return BOT_UA_RE.test(navigator.userAgent || "");
  }

  // ---- visitor id -------------------------------------------------------------
  // Sanctioned only once consent allows it (see consent gating below); reads
  // an existing id from either storage without side effects.
  function readPersistedVisitorId() {
    return readCookie(VISITOR_KEY) || storageGet(VISITOR_KEY);
  }

  function mintPersistedVisitorId() {
    var existing = readPersistedVisitorId();
    if (existing) return existing;
    var id = uuid();
    writeCookie(VISITOR_KEY, id, VISITOR_COOKIE_DAYS);
    storageSet(VISITOR_KEY, id);
    return id;
  }

  // A random id scoped to this page load only, used by "anonymous-until-
  // consent" mode before consent is granted. Never persisted.
  var EPHEMERAL_VISITOR_ID = uuid();

  function hasConsent() {
    var stored = storageGet(CONSENT_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch (e) {
      return null;
    }
  }

  function analyticsGranted() {
    var c = hasConsent();
    return !!(c && c.analytics);
  }

  function setConsent(consent) {
    storageSet(CONSENT_KEY, JSON.stringify(consent));
  }

  function currentVisitorId() {
    if (CONSENT_MODE === "none") return mintPersistedVisitorId();
    if (CONSENT_MODE === "required") {
      return analyticsGranted() ? mintPersistedVisitorId() : null;
    }
    // anonymous-until-consent
    return analyticsGranted() ? mintPersistedVisitorId() : EPHEMERAL_VISITOR_ID;
  }

  function shouldSend() {
    if (CONSENT_MODE === "required") return analyticsGranted();
    return true; // "none" and "anonymous-until-consent" both send unconditionally
  }

  // ---- URL parsing --------------------------------------------------------
  function queryParam(search, name) {
    try {
      return new URLSearchParams(search).get(name);
    } catch (e) {
      var match = search.match(new RegExp("[?&]" + name + "=([^&]*)"));
      return match ? decodeURIComponent(match[1]) : null;
    }
  }
  function queryParamCI(search, name) {
    var match = search.match(new RegExp("[?&]" + name + "=([^&]*)", "i"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  // ≤512 chars, no whitespace/quotes/control characters. Same rule the
  // collector applies server-side, applied here too so a bad value never
  // gets persisted to localStorage in the first place.
  function sanitizeClickId(value) {
    if (typeof value !== "string") return null;
    var v = trim(value);
    if (!v || v.length > CLICK_ID_MAX_LEN) return null;
    if (/\s/.test(v) || /['"`]/.test(v)) return null;
    for (var i = 0; i < v.length; i++) {
      var code = v.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return null;
    }
    return v;
  }

  function currentUtm() {
    var search = window.location.search;
    return {
      source: queryParam(search, "utm_source"),
      medium: queryParam(search, "utm_medium"),
      campaign: queryParam(search, "utm_campaign"),
      content: queryParam(search, "utm_content"),
      term: queryParam(search, "utm_term"),
    };
  }

  function currentClickIds() {
    var search = window.location.search;
    var out = {};
    for (var i = 0; i < CLICK_ID_PARAMS.length; i++) {
      var name = CLICK_ID_PARAMS[i];
      var raw = name === "sccid" ? queryParamCI(search, name) : queryParam(search, name);
      var clean = sanitizeClickId(raw);
      if (clean) out[name] = clean;
    }
    return out;
  }

  function readClickIdStore() {
    var raw = storageGet(CLICK_ID_STORE_KEY);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      var now = Date.now();
      var out = {};
      for (var key in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        var entry = parsed[key];
        if (!entry || typeof entry.v !== "string" || typeof entry.at !== "number") continue;
        if (now - entry.at > CLICK_ID_TTL_MS) continue;
        out[key] = entry;
      }
      return out;
    } catch (e) {
      return {};
    }
  }

  function persistClickIds(found) {
    var keys = Object.keys(found);
    if (!keys.length) return;
    var store = readClickIdStore();
    var now = Date.now();
    for (var i = 0; i < keys.length; i++) store[keys[i]] = { v: found[keys[i]], at: now };
    storageSet(CLICK_ID_STORE_KEY, JSON.stringify(store));
  }

  // Merged view for outgoing payloads: current-URL click ids win over the
  // persisted store, filled out to all 12 keys (null when absent) so every
  // payload has a stable shape.
  function clickIdsForPayload() {
    var fromUrl = currentClickIds();
    persistClickIds(fromUrl);
    var stored = readClickIdStore();
    var out = {};
    for (var i = 0; i < CLICK_ID_PARAMS.length; i++) {
      var name = CLICK_ID_PARAMS[i];
      if (fromUrl[name]) out[name] = fromUrl[name];
      else if (stored[name]) out[name] = stored[name].v;
      else out[name] = null;
    }
    return out;
  }

  function platformCookiesForPayload() {
    var out = {};
    for (var i = 0; i < PLATFORM_COOKIES.length; i++) {
      var name = PLATFORM_COOKIES[i];
      out[name] = readCookie(name) || null;
    }
    return out;
  }

  // Strips email/phone query params before the URL is sent, so raw PII a
  // form redirect might tack onto the URL never leaves the browser.
  function sanitizedUrl() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("email");
      url.searchParams.delete("phone");
      return url.toString();
    } catch (e) {
      return window.location.href;
    }
  }

  // ---- transport ------------------------------------------------------------
  function send(eventType, eventName, properties, identity) {
    if (isBot()) return;
    if (!shouldSend()) return;
    var visitorUid = currentVisitorId();
    if (!visitorUid) return; // required mode, no consent yet

    var utm = currentUtm();
    var body = {
      site_key: SITE_KEY,
      visitor_uid: visitorUid,
      event_type: eventType,
      event_name: eventName || null,
      url: sanitizedUrl(),
      referrer: document.referrer || null,
      occurred_at: new Date().toISOString(),
      properties: properties || {},
      utm: utm,
      click_ids: clickIdsForPayload(),
      platform_cookies: platformCookiesForPayload(),
      identity: identity && (identity.email || identity.phone) ? { email: identity.email || null, phone: identity.phone || null } : null,
      consent: hasConsent(),
    };

    var json = JSON.stringify(body);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: "text/plain" });
        var ok = navigator.sendBeacon(ENDPOINT, blob);
        if (ok) return;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: json,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      })["catch"](function () {});
    } catch (e) {}
  }

  // ---- public API -------------------------------------------------------------
  function api(command) {
    var args = Array.prototype.slice.call(arguments, 1);
    switch (command) {
      case "track":
        send("track", args[0], args[1] || {}, null);
        break;
      case "identify":
        var traits = args[0] || {};
        send("identify", null, {}, { email: traits.email, phone: traits.phone });
        break;
      case "consent":
        var consent = args[0] || {};
        setConsent({ analytics: !!consent.analytics, ads: !!consent.ads });
        // Granting consent switches "anonymous-until-consent" mode over to
        // the persistent id starting with this event.
        send("consent", null, { granted: !!(consent.analytics || consent.ads) }, null);
        break;
      default:
        if (window.console) console.warn("[pixel] unknown command:", command);
    }
  }

  var queued = window.fpx;
  window.fpx = api;
  if (queued && queued.q && queued.q.length) {
    for (var i = 0; i < queued.q.length; i++) api.apply(null, queued.q[i]);
  }

  // ---- pageview + SPA route change tracking -----------------------------------
  var lastPath = window.location.pathname + window.location.search;

  function maybeSendPageview() {
    var path = window.location.pathname + window.location.search;
    if (path === lastPath) return;
    lastPath = path;
    send("pageview", null, {}, null);
  }

  function patchHistoryMethod(method) {
    var original = history[method];
    if (!original) return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      try {
        maybeSendPageview();
      } catch (e) {}
      return result;
    };
  }

  send("pageview", null, {}, null);
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
  window.addEventListener("popstate", maybeSendPageview);

  // ---- form capture -------------------------------------------------------------
  var lastFormSignature = null;
  var lastFormAt = 0;
  var FORM_DEDUPE_WINDOW_MS = 10000;

  function submitFormOnce(identity, properties) {
    var now = Date.now();
    var signature = (identity.email || "") + "|" + (identity.phone || "");
    if (signature === lastFormSignature && now - lastFormAt < FORM_DEDUPE_WINDOW_MS) return;
    lastFormSignature = signature;
    lastFormAt = now;
    send("form_submit", null, properties || {}, identity);
  }

  function fieldMatches(el) {
    var type = (el.type || "").toLowerCase();
    var key = ((el.name || "") + " " + (el.id || "")).toLowerCase();
    if (type === "email" || /e-?mail/.test(key)) return "email";
    if (type === "tel" || /phone|tel/.test(key)) return "phone";
    return null;
  }

  function extractIdentityFromForm(form) {
    var identity = {};
    var inputs = form.querySelectorAll("input, textarea");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!el.value) continue;
      var kind = fieldMatches(el);
      if (kind === "email" && !identity.email) identity.email = el.value;
      else if (kind === "phone" && !identity.phone) identity.phone = el.value;
    }
    return identity;
  }

  if (ENABLED_FORM_ADAPTERS.native) {
    document.addEventListener(
      "submit",
      function (ev) {
        var form = ev.target;
        if (!form || !form.tagName || form.tagName.toLowerCase() !== "form") return;
        var identity = extractIdentityFromForm(form);
        if (!identity.email && !identity.phone) return;
        submitFormOnce(identity, {
          form_id: form.id || null,
          form_name: form.getAttribute("name") || null,
        });
      },
      true
    );
  }

  // Vendor bridges: each vendor announces a submission via postMessage.
  // Payloads are treated as untrusted page data: parsed defensively, never
  // eval'd, and mapped only to the fields this pixel understands.
  window.addEventListener("message", function (ev) {
    var data = ev.data;
    if (!data || typeof data !== "object") return;

    if (ENABLED_FORM_ADAPTERS.hubspot && data.type === "hsFormCallback" && data.eventName === "onFormSubmitted") {
      var values = (data.data && data.data.submissionValues) || {};
      submitFormOnce(
        { email: values.email, phone: values.phone },
        { form_id: data.id || null, vendor: "hubspot" }
      );
      return;
    }

    if (ENABLED_FORM_ADAPTERS.jotform && data.action === "submission-completed") {
      submitFormOnce({}, { form_id: data.formID ? String(data.formID) : null, vendor: "jotform" });
      return;
    }

    if (ENABLED_FORM_ADAPTERS.typeform && data.type === "form-submit") {
      submitFormOnce({}, { form_id: data.formId ? String(data.formId) : null, vendor: "typeform" });
      return;
    }

    if (ENABLED_FORM_ADAPTERS.calendly && data.event === "calendly.event_scheduled") {
      var payload = data.payload || {};
      submitFormOnce(
        {},
        {
          vendor: "calendly",
          event_uri: (payload.event && payload.event.uri) || null,
          invitee_uri: (payload.invitee && payload.invitee.uri) || null,
        }
      );
      return;
    }
  });
})();

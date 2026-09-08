// First-party pixel: end-to-end simulation against a running collector.
//
// Posts a realistic five-event sequence to COLLECTOR_URL (default
// http://localhost:8787/collect): a Paid Search landing session (two
// pageviews + a form_submit that resolves identity), then, three hours
// later, a second Direct session (pageview + a purchase). Run via
// scripts/roundtrip.sh, which stands up the collector and database first.
//
// Exits non-zero on any non-2xx/204 response so roundtrip.sh can fail fast.

const COLLECTOR_URL = process.env.COLLECTOR_URL || "http://localhost:8787/collect";

const HEADERS = {
  "Content-Type": "text/plain",
  Origin: "https://example.com",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const EMPTY_UTM = { source: null, medium: null, campaign: null, content: null, term: null };
const EMPTY_CLICK_IDS = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  dclid: null,
  fbclid: null,
  ttclid: null,
  rdt_cid: null,
  li_fat_id: null,
  msclkid: null,
  twclid: null,
  epik: null,
  sccid: null,
};
const EMPTY_PLATFORM_COOKIES = { _fbp: null, _fbc: null, _rdt_uuid: null, _ttp: null };

function basePayload(overrides) {
  return {
    site_key: "site_test",
    visitor_uid: "visitor-1",
    url: "https://example.com/",
    referrer: null,
    properties: {},
    utm: EMPTY_UTM,
    click_ids: EMPTY_CLICK_IDS,
    platform_cookies: EMPTY_PLATFORM_COOKIES,
    identity: null,
    consent: null,
    ...overrides,
  };
}

async function post(payload) {
  const res = await fetch(COLLECTOR_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
  });
  if (res.status !== 204 && res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${payload.event_type} (${payload.event_name || ""}) failed: ${res.status} ${text}`);
  }
  return res;
}

async function main() {
  const t0 = new Date("2026-09-01T12:00:00.000Z");
  const plus = (ms) => new Date(t0.getTime() + ms).toISOString();

  // 1. Landing pageview with a Google Ads click id -> Paid Search touchpoint.
  await post(
    basePayload({
      event_type: "pageview",
      event_name: null,
      url: "https://example.com/?utm_source=google&utm_medium=cpc&gclid=TEST123",
      referrer: null,
      utm: { ...EMPTY_UTM, source: "google", medium: "cpc" },
      click_ids: { ...EMPTY_CLICK_IDS, gclid: "TEST123" },
      occurred_at: plus(0),
    })
  );

  // 2. Second pageview, same session (2 minutes later), no params.
  await post(
    basePayload({
      event_type: "pageview",
      url: "https://example.com/pricing",
      referrer: "https://example.com/",
      occurred_at: plus(2 * 60 * 1000),
    })
  );

  // 3. Form submit with identity, 1 minute after that -> resolves the contact.
  await post(
    basePayload({
      event_type: "form_submit",
      url: "https://example.com/pricing",
      referrer: "https://example.com/pricing",
      identity: { email: "Test.User@Example.com", phone: null },
      properties: { form_id: "contact-form" },
      occurred_at: plus(3 * 60 * 1000),
    })
  );

  // 4. Three hours later, a fresh direct pageview -> new session, no touchpoint.
  await post(
    basePayload({
      event_type: "pageview",
      url: "https://example.com/",
      referrer: null,
      occurred_at: plus(3 * 60 * 60 * 1000),
    })
  );

  // 5. Purchase track event, 1 minute later, same (Direct) session.
  await post(
    basePayload({
      event_type: "track",
      event_name: "purchase",
      url: "https://example.com/thank-you",
      referrer: "https://example.com/",
      properties: { value: 49, currency: "USD" },
      occurred_at: plus(3 * 60 * 60 * 1000 + 60 * 1000),
    })
  );

  console.log("simulate.mjs: all 5 events posted successfully");
}

main().catch((err) => {
  console.error("simulate.mjs failed:", err);
  process.exit(1);
});

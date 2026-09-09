// First-party pixel collector: Cloudflare Worker adapter.
//
// Imports ../core.js directly (not a copy). Requires a Hyperdrive binding
// named HYPERDRIVE pointed at the Postgres instance (wrangler.toml):
//
//   [[hyperdrive]]
//   binding = "HYPERDRIVE"
//   id = "<hyperdrive-id>"
//
// Uses `pg` against env.HYPERDRIVE.connectionString, same driver as the
// node/ and vercel/ adapters, since Hyperdrive proxies the TCP connection
// and Workers' pg support covers this path. Keep an interactive transaction-
// capable connection; a stateless HTTP query driver cannot replace it.
import pg from "pg";
import { createPgDatabase } from "../transaction-db.mjs";
import { handleCollect } from "../core.js";

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for");
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
    }

    let payload;
    try {
      payload = JSON.parse(await request.text());
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid JSON" }), {
        status: 400,
        headers: { "Access-Control-Allow-Origin": origin || "*", "Content-Type": "application/json" },
      });
    }

    const pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString });
    const db = createPgDatabase(pool);

    const ctx = {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
      origin,
      now: () => new Date(),
      salt: env.PIXEL_IP_SALT || "",
      ipRetention: Number(env.PIXEL_IP_RETENTION_DAYS) || 7,
    };

    try {
      const result = await handleCollect(payload, ctx, db);
      return new Response(result.body != null ? JSON.stringify(result.body) : null, {
        status: result.status,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          ...(result.body != null ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (err) {
      console.error("[pixel-collector] error handling /collect:", err);
      return new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
        headers: { "Access-Control-Allow-Origin": origin || "*", "Content-Type": "application/json" },
      });
    } finally {
      // Workers don't keep long-lived connections between requests the way a
      // node process does; close the pool created for this invocation so
      // Hyperdrive can recycle the underlying connection.
      _ctx.waitUntil(pool.end());
    }
  },
};

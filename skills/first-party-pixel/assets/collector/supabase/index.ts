// First-party pixel collector: Supabase (Deno) edge function adapter.
//
// Imports ../core.js directly (not a copy). Deploy as a Supabase edge
// function; DATABASE_URL should point at the project's Postgres connection
// string (session pooler recommended for edge functions).
//
// Uses "npm:postgres" (the porsager/postgres client) via Deno's npm
// specifier support, rather than a Postgres.js-native tagged-template query,
// so it can be adapted to the same `db.query(text, params)` shape the other
// adapters use. `sql.unsafe(text, params)` accepts a plain parameterized
// query string with $1-style placeholders, same as `pg`.
import postgres from "npm:postgres";
import { handleCollect } from "../core.js";
import { createPostgresDatabase } from "../transaction-db.mjs";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// Supabase's transaction-mode pooler (port 6543) rejects prepared statements.
const sql = postgres(DATABASE_URL, { max: 5, prepare: false });
const db = createPostgresDatabase(sql);

const IP_SALT = Deno.env.get("PIXEL_IP_SALT") || "";
const IP_RETENTION_DAYS = Number(Deno.env.get("PIXEL_IP_RETENTION_DAYS")) || 7;

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return null;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch (_e) {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Access-Control-Allow-Origin": origin || "*", "Content-Type": "application/json" },
    });
  }

  const ctx = {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    origin,
    now: () => new Date(),
    salt: IP_SALT,
    ipRetention: IP_RETENTION_DAYS,
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
  }
});

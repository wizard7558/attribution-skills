// First-party pixel collector: Vercel serverless function (Node runtime).
//
// Imports ../../core.js directly (not a copy). Deploy this file as-is at
// api/collect.js in a Vercel project; DATABASE_URL must point at a reachable
// Postgres instance (Vercel Postgres, Supabase, Neon, RDS, etc).
//
// Uses `pg` here because it is already a dependency of the node/ and
// cloudflare/ adapters in this skill and works unmodified on Vercel's Node
// runtime. Keep an interactive transaction-capable connection. A stateless
// HTTP query driver is not a replacement for this pinned-client transaction.
import pg from "pg";
import { createPgDatabase } from "../../transaction-db.mjs";
import { handleCollect } from "../../core.js";

let pool;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.status(400).json({ error: "invalid JSON" });
      return;
    }
  }

  const db = createPgDatabase(getPool());
  const ctx = {
    ip: clientIp(req),
    userAgent: req.headers["user-agent"] || null,
    origin,
    now: () => new Date(),
    salt: process.env.PIXEL_IP_SALT || "",
    ipRetention: Number(process.env.PIXEL_IP_RETENTION_DAYS) || 7,
  };

  try {
    const result = await handleCollect(payload, ctx, db);
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.status(result.status);
    if (result.body != null) res.json(result.body);
    else res.end();
  } catch (err) {
    console.error("[pixel-collector] error handling /collect:", err);
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.status(500).json({ error: "internal error" });
  }
}

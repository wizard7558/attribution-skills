// First-party pixel collector: plain node:http adapter.
//
// Imports ../core.js directly (not a copy). Run with:
//   DATABASE_URL=postgres://... PIXEL_IP_SALT=... node server.js
//
// Routes:
//   POST /collect   -> handleCollect
//   GET  /pixel.js  -> serves ../../pixel.js so a single deployment can host
//                      both the snippet and the endpoint it posts to
//   GET  /health    -> liveness probe, no DB round trip
//
// CORS: the pixel sends Content-Type: text/plain, which keeps a same-shape
// POST a CORS "simple request" (no preflight) as long as the browser doesn't
// require credentials. This adapter still answers OPTIONS defensively, for
// hosts that front it with something that does preflight. The real origin
// check (against the site's allowed_origins) happens inside handleCollect on
// the POST itself; OPTIONS just echoes the caller's Origin so the browser's
// preflight succeeds and the POST can proceed to the real check.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { handleCollect } from "../core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIXEL_JS_PATH = join(__dirname, "..", "..", "pixel.js");

const PORT = Number(process.env.PORT) || 8787;
const DATABASE_URL = process.env.DATABASE_URL;
const IP_SALT = process.env.PIXEL_IP_SALT || "";
const IP_RETENTION_DAYS = Number(process.env.PIXEL_IP_RETENTION_DAYS) || 7;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = { query: (text, params) => pool.query(text, params) };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS" && req.url === "/collect") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/pixel.js") {
    try {
      const contents = await readFile(PIXEL_JS_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
      res.end(contents);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (req.method === "POST" && req.url === "/collect") {
    try {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        res.writeHead(400, { "Access-Control-Allow-Origin": origin || "*" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      const ctx = {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || null,
        origin,
        now: () => new Date(),
        salt: IP_SALT,
        ipRetention: IP_RETENTION_DAYS,
      };

      const result = await handleCollect(payload, ctx, db);
      const headers = { "Access-Control-Allow-Origin": origin || "*" };
      if (result.body != null) headers["Content-Type"] = "application/json";
      res.writeHead(result.status, headers);
      res.end(result.body != null ? JSON.stringify(result.body) : undefined);
    } catch (err) {
      console.error("[pixel-collector] error handling /collect:", err);
      res.writeHead(500, { "Access-Control-Allow-Origin": origin || "*" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`pixel collector listening on :${PORT}`);
});

export default server;

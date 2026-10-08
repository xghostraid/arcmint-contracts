import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coinEvents, getLiveCoin, listBurns, listLiveCoins, openDb } from "./db.js";
import { renderBurns, renderCoin, renderFloor, renderHome, renderNotFound } from "./html.js";
import { handleMcpMessage, sseBody, wantsSse } from "./mcp.js";
import { publicStatus } from "./status.js";

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const DEFAULT_DB = path.resolve(fileURLToPath(new URL("../data/socket.sqlite", import.meta.url)));
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const CSP = [
  "default-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function send(res, status, type, body, extra = {}) {
  const headers = {
    "content-type": type,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    ...extra,
  };
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body, extra = {}) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), {
    "cache-control": "no-store",
    ...extra,
  });
}

function sendHtml(res, status, html) {
  send(res, status, "text/html; charset=utf-8", html, { "cache-control": "no-store" });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too big"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function publicOrigin(req) {
  const host = req.headers.host || "";
  const safe = /^[A-Za-z0-9.-]+(?::\d+)?$/.test(host) ? host : "127.0.0.1";
  const proto = req.socket?.encrypted ? "https" : "http";
  return `${proto}://${safe}`;
}

function serveAsset(res, rel) {
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    send(res, 403, "text/plain; charset=utf-8", "no");
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const cache = file.endsWith(".woff2") ? "public, max-age=86400" : "public, max-age=300";
  send(res, 200, type, fs.readFileSync(file), { "cache-control": cache });
}

async function route(req, res, db) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const status = () => publicStatus(db);

  if (pathname.startsWith("/assets/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "text/plain; charset=utf-8", "method");
      return;
    }
    serveAsset(res, pathname.slice("/assets/".length));
    return;
  }

  if (pathname === "/mcp") {
    if (req.method === "OPTIONS") {
      send(res, 204, "text/plain; charset=utf-8", "", {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, accept, mcp-protocol-version",
      });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32601, message: "Method not found" },
      }, { allow: "POST" });
      return;
    }
    const ctype = req.headers["content-type"] || "";
    if (!ctype.includes("application/json")) {
      sendJson(res, 415, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      return;
    }
    let raw;
    try {
      raw = await readBody(req, 1_000_000);
    } catch (err) {
      if (err.status === 413) {
        send(res, 413, "text/plain; charset=utf-8", "too big");
        return;
      }
      throw err;
    }
    let message;
    try {
      message = JSON.parse(raw || "");
    } catch {
      sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const out = handleMcpMessage(db, message);
    const cors = { "access-control-allow-origin": "*" };
    if (out.type === "notification") {
      send(res, 202, "text/plain; charset=utf-8", "", cors);
      return;
    }
    if ((out.status || 200) === 200 && wantsSse(req.headers.accept)) {
      send(res, 200, "text/event-stream; charset=utf-8", sseBody(out.body), {
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        "mcp-protocol-version": "2025-03-26",
        ...cors,
      });
      return;
    }
    sendJson(res, out.status || 200, out.body, {
      "mcp-protocol-version": "2025-03-26",
      ...cors,
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "method", { allow: "GET" });
    return;
  }

  if (pathname === "/api/status") {
    sendJson(res, 200, status());
    return;
  }

  if (pathname === "/api/coins") {
    const limitRaw = url.searchParams.get("limit");
    let limit = 200;
    if (limitRaw != null) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        sendJson(res, 400, { ok: false, error: "bad limit" });
        return;
      }
      limit = n;
    }
    const all = listLiveCoins(db);
    sendJson(res, 200, { live: true, total: all.length, coins: all.slice(0, limit) });
    return;
  }

  if (pathname.startsWith("/api/coins/")) {
    const mint = decodeURIComponent(pathname.slice("/api/coins/".length));
    if (!BASE58.test(mint)) {
      sendJson(res, 404, { ok: false, error: "not in the book" });
      return;
    }
    const coin = getLiveCoin(db, mint);
    if (!coin) {
      sendJson(res, 404, { ok: false, error: "not in the book" });
      return;
    }
    const { events, burnsAttributed } = coinEvents(db, coin);
    sendJson(res, 200, { ok: true, coin, events, burnsAttributed });
    return;
  }

  if (pathname === "/api/burns") {
    const burns = listBurns(db);
    const snap = status();
    sendJson(res, 200, {
      burns,
      tokensBurned: snap.tokensBurned,
      spentOnBurnsSol: snap.spentOnBurnsSol,
    });
    return;
  }

  if (pathname === "/") {
    sendHtml(res, 200, renderHome({ status: status(), mcpUrl: `${publicOrigin(req)}/mcp` }));
    return;
  }
  if (pathname === "/floor") {
    sendHtml(res, 200, renderFloor({ status: status(), coins: listLiveCoins(db) }));
    return;
  }
  if (pathname === "/burns") {
    sendHtml(res, 200, renderBurns({ status: status(), burns: listBurns(db) }));
    return;
  }
  if (pathname.startsWith("/coin/")) {
    const address = decodeURIComponent(pathname.slice("/coin/".length));
    const coin = BASE58.test(address) ? getLiveCoin(db, address) : null;
    const extra = coin ? coinEvents(db, coin) : { events: [], burnsAttributed: false };
    const page = renderCoin({
      status: status(),
      address,
      coin,
      events: extra.events,
      burnsAttributed: extra.burnsAttributed,
    });
    sendHtml(res, page.statusCode, page.html);
    return;
  }

  sendHtml(res, 404, renderNotFound(status()));
}

export function createServer({ dbPath = process.env.SOCKET_DB || DEFAULT_DB } = {}) {
  const db = openDb(dbPath);
  const server = http.createServer((req, res) => {
    route(req, res, db).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "read failed");
    });
  });
  server.db = db;
  return server;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Socket read path http://${host}:${port}`);
  });
}

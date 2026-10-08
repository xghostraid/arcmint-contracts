import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueNonce, proveWallet, sessionWallet, walletDesk } from "./desk.js";
import { coinEvents, getLiveCoin, getPicture, latestLiveRow, listBurns, listLiveCoins, LOCAL_WALLET, openDb, seedLocalCoin, storePicture, toLiveView } from "./db.js";
import { renderDraftCard } from "./draft-card.js";
import { renderBurns, renderCoin, renderDesk, renderFloor, renderHome, renderLivePreview, renderNotFound, renderPreview } from "./html.js";
import { renderLiveCard } from "./live-card.js";
import { cronAuthorized, lowFloatAlert, opsStatus } from "./ops.js";
import { watchPayouts } from "./payout.js";
import { handleMcpMessage, sseBody, wantsSse } from "./mcp.js";
import { PICTURE_MAX_BYTES, sniffImage } from "./picture.js";
import { buildQuote } from "./quote.js";
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

const CARD_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

const API_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

const PICTURE_ID = /^pic_[a-f0-9]{16}$/;

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
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

function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error("too big"), { status: 413, code: "size" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

function readBody(req, limit) {
  return readBodyBuffer(req, limit).then((buf) => buf.toString("utf8"));
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
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

async function route(req, res, db, env = process.env) {
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
    const out = handleMcpMessage(db, message, { origin: publicOrigin(req) });
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

  if (pathname === "/api/picture" || pathname === "/api/quote") {
    if (req.method === "OPTIONS") {
      send(res, 204, "text/plain; charset=utf-8", "", API_CORS);
      return;
    }
  }

  if (pathname === "/api/picture") {
    if (req.method !== "POST") {
      send(res, 405, "text/plain; charset=utf-8", "method", { allow: "POST", ...API_CORS });
      return;
    }
    let bytes;
    try {
      bytes = await readBodyBuffer(req, PICTURE_MAX_BYTES);
    } catch (err) {
      if (err.code === "size") {
        sendJson(res, 400, { ok: false, stored: false, error: "size" }, API_CORS);
        req.destroy();
        return;
      }
      throw err;
    }
    const mime = sniffImage(bytes);
    if (!mime) {
      sendJson(res, 400, { ok: false, stored: false, error: "format" }, API_CORS);
      return;
    }
    try {
      const stored = storePicture(db, { bytes, mime });
      sendJson(res, 200, {
        ok: true,
        stored: true,
        id: stored.id,
        expiresAt: stored.expiresAt,
        size: stored.size,
        mime: stored.mime,
      }, API_CORS);
    } catch {
      sendJson(res, 500, { ok: false, stored: false, error: "upload failed" }, API_CORS);
    }
    return;
  }

  if (pathname === "/api/quote") {
    if (req.method !== "POST") {
      send(res, 405, "text/plain; charset=utf-8", "method", { allow: "POST", ...API_CORS });
      return;
    }
    let raw;
    try {
      raw = await readBody(req, 100_000);
    } catch (err) {
      if (err.status === 413) {
        sendJson(res, 400, { ok: false, error: "size" }, API_CORS);
        return;
      }
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "format" }, API_CORS);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
    sendJson(res, 200, buildQuote(db, parsed), API_CORS);
    return;
  }

  if (pathname === "/api/desk/nonce" || pathname === "/api/desk/verify") {
    if (req.method !== "POST") {
      send(res, 405, "text/plain; charset=utf-8", "method", { allow: "POST" });
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(await readBody(req, 16_000) || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "rejected" });
      return;
    }
    const wallet = typeof parsed.wallet === "string" ? parsed.wallet.trim() : "";
    if (!BASE58.test(wallet)) {
      sendJson(res, 400, { ok: false, error: "rejected" });
      return;
    }
    if (pathname === "/api/desk/nonce") {
      sendJson(res, 200, issueNonce(db, wallet));
      return;
    }
    const proved = proveWallet(db, parsed, new Date(), { session: true });
    if (!proved.ok) {
      sendJson(res, 401, { ok: false, error: "rejected" });
      return;
    }
    sendJson(res, 200, { ok: true, wallet: proved.desk.wallet }, {
      "set-cookie": `socket_desk=${proved.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
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
  if (pathname === "/api/ops") {
    if (!cronAuthorized(req.headers.authorization, env)) {
      sendJson(res, 401, { ok: false, error: "rejected" });
      return;
    }
    sendJson(res, 200, opsStatus(env));
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

  if (pathname === "/api/img") {
    const id = url.searchParams.get("id") || "";
    const row = PICTURE_ID.test(id) ? getPicture(db, id) : null;
    if (!row) {
      send(res, 404, "text/plain; charset=utf-8", "missing", { "cache-control": "no-store", ...API_CORS });
      return;
    }
    send(res, 200, row.mime, Buffer.from(row.bytes), {
      "cache-control": "private, max-age=60",
      ...API_CORS,
    });
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

  if (pathname === "/card") {
    send(res, 200, "text/html; charset=utf-8", renderDraftCard(publicOrigin(req)), {
      "cache-control": "no-store",
      "content-security-policy": CARD_CSP,
      "x-frame-options": "SAMEORIGIN",
    });
    return;
  }
  if (pathname === "/card/live") {
    send(res, 200, "text/html; charset=utf-8", renderLiveCard(publicOrigin(req), toLiveView(db, latestLiveRow(db))), {
      "cache-control": "no-store",
      "content-security-policy": CARD_CSP,
      "x-frame-options": "SAMEORIGIN",
    });
    return;
  }
  if (pathname === "/preview/draft") {
    sendHtml(res, 200, renderPreview(status()));
    return;
  }
  if (pathname === "/preview/live") {
    sendHtml(res, 200, renderLivePreview(status()));
    return;
  }
  if (pathname === "/api/desk") {
    const wallet = sessionWallet(db, readCookie(req, "socket_desk"));
    if (!wallet) {
      sendJson(res, 401, { ok: false, error: "rejected" });
      return;
    }
    sendJson(res, 200, walletDesk(db, wallet));
    return;
  }
  if (pathname === "/desk" || pathname === "/preview/desk" || pathname === "/preview/desk/empty") {
    const preview = pathname.startsWith("/preview/desk");
    const emptyPreview = pathname === "/preview/desk/empty";
    const wallet = preview
      ? (emptyPreview ? null : LOCAL_WALLET)
      : sessionWallet(db, readCookie(req, "socket_desk"));
    const page = renderDesk({
      status: status(),
      mcpUrl: `${publicOrigin(req)}/mcp`,
      desk: emptyPreview
        ? { wallet: LOCAL_WALLET, coins: [], failed: [], paidSol: 0 }
        : (wallet ? walletDesk(db, wallet) : { wallet: "", coins: [], failed: [], paidSol: 0 }),
      preview,
      signedOut: !preview && !wallet,
    });
    sendHtml(res, 200, page);
    return;
  }
  if (pathname === "/" || pathname === "/floor" || pathname === "/burns") {
    const scene = {
      status: status(),
      mcpUrl: `${publicOrigin(req)}/mcp`,
      coins: listLiveCoins(db),
      burns: listBurns(db),
    };
    const html = pathname === "/floor"
      ? renderFloor({ ...scene, title: "The floor · promptfun.fun" })
      : pathname === "/burns"
        ? renderBurns(scene)
        : renderHome(scene);
    sendHtml(res, 200, html);
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

export function createServer({ dbPath = process.env.SOCKET_DB || DEFAULT_DB, env = process.env } = {}) {
  const db = openDb(dbPath);
  const server = http.createServer((req, res) => {
    route(req, res, db, env).catch((err) => {
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
  seedLocalCoin(server.db);
  const floatAlert = lowFloatAlert();
  if (floatAlert) console.error(floatAlert.text);
  const tick = () => {
    try {
      watchPayouts(server.db);
    } catch (err) {
      console.error(err);
    }
  };
  tick();
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === "function") timer.unref();
  server.listen(port, host, () => {
    console.log(`promptfun.fun http://${host}:${port}`);
  });
}

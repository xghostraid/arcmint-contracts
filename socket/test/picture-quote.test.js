import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storePicture } from "../server/db.js";
import { DRAFT_CARD_URI } from "../server/draft-card.js";
import { createServer } from "../server/index.js";
import { PICTURE_MAX_BYTES, sniffImage } from "../server/picture.js";
import { QUOTE_KEYS } from "../server/quote.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const BANNED = [
  "balanceSol",
  "launchesItCanPay",
  "keyMatchesWallet",
  "PLUGGED_FEE_ACCOUNT",
  "PLUGGED_TREASURY_KEY",
  "PLUGGED_LAUNCH_LIVE",
  "SOLANA_RPC_URL",
  "DATABASE_URL",
  "CRON_SECRET",
  "treasuryKey",
  "secretKey",
  "privateKey",
];

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  const server = createServer({ dbPath: path.join(dir, "t.sqlite") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    db: server.db,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      server.db.close();
    },
  };
}

async function postMcp(base, body) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text, json: JSON.parse(text) };
}

function rpc(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

test("sniff reads magic bytes", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a", "ascii")), "image/gif");
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  assert.equal(sniffImage(webp), "image/webp");
  assert.equal(sniffImage(Buffer.from("not an image")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test("picture upload, quote, and the draft card", async () => {
  const app = await start();
  try {
    const empty = await fetch(`${app.base}/api/picture`, { method: "POST" });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { ok: false, stored: false, error: "format" });

    const getPicture = await fetch(`${app.base}/api/picture`);
    assert.equal(getPicture.status, 405);

    const wrongType = await fetch(`${app.base}/api/picture`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: PNG,
    });
    assert.equal(wrongType.status, 200);
    const stored = await wrongType.json();
    assert.equal(stored.ok, true);
    assert.equal(stored.stored, true);
    assert.match(stored.id, /^pic_[a-f0-9]{16}$/);
    assert.equal(stored.mime, "image/png");

    const again = await fetch(`${app.base}/api/picture`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: PNG,
    });
    const deduped = await again.json();
    assert.equal(deduped.id, stored.id);

    const img = await fetch(`${app.base}/api/img?id=${stored.id}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.match(img.headers.get("cache-control"), /private/);
    assert.equal(Buffer.compare(Buffer.from(await img.arrayBuffer()), PNG), 0);

    const big = await fetch(`${app.base}/api/picture`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(PICTURE_MAX_BYTES + 1, 1),
    });
    assert.equal(big.status, 400);
    assert.deepEqual(await big.json(), { ok: false, stored: false, error: "size" });

    const quote = await fetch(`${app.base}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        picture_id: stored.id,
        name: "Amber",
        ticker: "AbC",
        description: "clay",
        x: "https://x.com/socket",
        website: "http://example.com",
        wallet: "not-a-wallet",
        image_url: "https://example.com/a.png",
      }),
    });
    const quoted = await quote.json();
    assert.deepEqual(Object.keys(quoted), [...QUOTE_KEYS]);
    assert.equal(quoted.canPay, false);
    assert.equal(quoted.launchesOn, false);
    assert.equal(quoted.paused, true);
    assert.equal(quoted.userPercent, 50);
    assert.equal(quoted.recipientPercent, 50);
    assert.equal(quoted.holderBalance, null);
    assert.equal(quoted.houseToken, false);
    assert.equal(quoted.picturePresent, true);
    assert.equal(quoted.pictureSource, "picture_id");
    assert.equal(quoted.pictureId, stored.id);
    assert.equal(quoted.ticker, "AbC");
    assert.equal(quoted.website, null);
    assert.equal(quoted.wallet, null);
    assert.ok(quoted.issues.some((issue) => issue.field === "website" && issue.error === "format"));
    assert.ok(quoted.issues.some((issue) => issue.field === "wallet" && issue.error === "format"));
    const rawQuote = JSON.stringify(quoted);
    for (const key of BANNED) assert.equal(rawQuote.includes(key), false);

    const tooLong = await fetch(`${app.base}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n".repeat(33), ticker: "t".repeat(11), description: "d".repeat(401) }),
    });
    const rejected = await tooLong.json();
    assert.equal(rejected.name, null);
    assert.equal(rejected.ticker, null);
    assert.equal(rejected.description, null);
    assert.deepEqual(
      rejected.issues.map((issue) => issue.error),
      ["size", "size", "size"],
    );

    app.db.prepare(`UPDATE pictures SET expires_at = ? WHERE id = ?`).run("2000-01-01T00:00:00.000Z", stored.id);
    const gone = await fetch(`${app.base}/api/img?id=${stored.id}`);
    assert.equal(gone.status, 404);
    const expired = await fetch(`${app.base}/api/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picture_id: stored.id }),
    });
    const expiredQuote = await expired.json();
    assert.equal(expiredQuote.picturePresent, false);
    assert.ok(expiredQuote.issues.some((issue) => issue.field === "picture_id" && issue.error === "missing"));

    const byUrl = await postMcp(app.base, rpc(1, "tools/call", {
      name: "quote_launch",
      arguments: { image_url: "https://example.com/coin.png", name: "Amber", ticker: "AMB" },
    }));
    const urlText = byUrl.json.result.content[0].text;
    assert.match(urlText, /image_url/);
    assert.match(urlText, /paused/);
    assert.match(urlText, /no house token/i);
    assert.equal(urlText.includes("75%"), false);
    assert.equal(byUrl.json.result.structuredContent.picturePresent, true);
    assert.equal(byUrl.json.result.structuredContent.pictureSource, "image_url");
    assert.equal(byUrl.json.result.structuredContent.canPay, false);
    assert.equal(byUrl.json.result.structuredContent.paused, true);
    assert.equal(byUrl.json.result._meta.ui.resourceUri, DRAFT_CARD_URI);
    for (const key of BANNED) assert.equal(JSON.stringify(byUrl.json.result).includes(key), false);

    const panel = await postMcp(app.base, rpc(2, "tools/call", {
      name: "open_picture_panel",
      arguments: { image_url: "https://example.com/coin.png" },
    }));
    assert.match(panel.json.result.content[0].text, /works without the iframe/);
    assert.equal(panel.json.result._meta.ui.resourceUri, DRAFT_CARD_URI);

    const panelOnly = await postMcp(app.base, rpc(3, "tools/call", {
      name: "open_picture_panel",
      arguments: {},
    }));
    assert.match(panelOnly.json.result.content[0].text, /Do not invent a picture_id/);
    assert.match(panelOnly.json.result.content[0].text, /draft card is open/);

    const listed = await postMcp(app.base, rpc(4, "tools/list"));
    const names = listed.json.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["ping", "quote_launch", "open_picture_panel", "launch_coin", "coin_status"]);
    const launchTool = listed.json.result.tools.find((tool) => tool.name === "launch_coin");
    assert.equal(launchTool.annotations.readOnlyHint, false);
    assert.equal(launchTool.annotations.idempotentHint, true);
    assert.equal(launchTool._meta.ui.resourceUri, DRAFT_CARD_URI);
    const quoteTool = listed.json.result.tools.find((tool) => tool.name === "quote_launch");
    assert.equal(quoteTool.annotations.readOnlyHint, true);
    assert.equal(quoteTool.annotations.openWorldHint, false);
    assert.equal(quoteTool._meta.ui.resourceUri, DRAFT_CARD_URI);

    const resources = await postMcp(app.base, rpc(5, "resources/list"));
    assert.equal(resources.json.result.resources[0].uri, DRAFT_CARD_URI);
    assert.equal(resources.json.result.resources[0].mimeType, "text/html;profile=mcp-app");

    const read = await postMcp(app.base, rpc(6, "resources/read", { uri: DRAFT_CARD_URI }));
    const html = read.json.result.contents[0].text;
    assert.equal(read.json.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(html.includes("<button"), false);
    assert.equal(html.includes("75%"), false);
    assert.equal(html.includes("2,500,000"), false);
    assert.equal(html.includes("2500000"), false);
    assert.ok(html.includes("Launches are paused."));
    assert.ok(html.includes("Recipient 50%"));
    assert.ok(html.includes("You 50%"));
    assert.ok(html.includes("approve launch_coin"));
    assert.ok(html.includes("ui/update-model-context"));
    assert.ok(html.includes(`${app.base}/assets/fonts/instrument-sans.woff2`));
    assert.equal(/bodoni|b68b4c|e6eef2/i.test(html), false);
    assert.equal(/d97757|4ade80|86efac|0c0f0d|gradient|Geist|Source Serif|Doto/i.test(html), false);
    assert.ok(html.includes('id="covered" hidden'));

    const card = await fetch(`${app.base}/card`);
    assert.equal(card.status, 200);
    assert.match(card.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.match(card.headers.get("content-security-policy"), /script-src 'unsafe-inline'/);
    assert.equal(card.headers.get("x-frame-options"), "SAMEORIGIN");
    const home = await fetch(`${app.base}/`);
    assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal((await home.text()).includes("/preview/draft"), false);

    const preview = await fetch(`${app.base}/preview/draft`);
    const previewHtml = await preview.text();
    assert.equal(preview.status, 200);
    assert.ok(previewHtml.includes('src="/card"'));
    assert.ok(previewHtml.includes("Ask quote_launch"));
    assert.equal(previewHtml.includes(">Launch<"), false);

    const launched = await postMcp(app.base, rpc(8, "tools/call", { name: "launch_coin", arguments: {} }));
    assert.equal(launched.json.result.isError, true);
    assert.equal(launched.json.result.content[0].text, "Launches are paused.");
    assert.deepEqual(launched.json.result.structuredContent.states, ["received", "quoted", "failed"]);
    assert.equal(launched.json.result.structuredContent.error, "paused");
    assert.equal(launched.json.result.structuredContent.userPercent, 50);
    assert.equal(launched.json.result.structuredContent.recipientPercent, 50);

    const init = await postMcp(app.base, rpc(9, "initialize", { protocolVersion: "2025-03-26" }));
    assert.equal(init.json.result.capabilities.resources.listChanged, false);
    assert.equal(init.json.result.capabilities.tools.listChanged, false);
    assert.match(init.json.result.instructions, /image_url/);
    assert.equal(init.json.result.instructions.includes("75%"), false);
  } finally {
    await app.close();
  }
});

test("storePicture keeps the hash and drops expired rows on write", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  const { openDb } = await import("../server/db.js");
  const db = openDb(path.join(dir, "t.sqlite"));
  const first = storePicture(db, { bytes: PNG, mime: "image/png" }, new Date("2026-10-08T00:00:00.000Z"));
  const second = storePicture(db, { bytes: PNG, mime: "image/png" }, new Date("2026-10-08T01:00:00.000Z"));
  assert.equal(second.id, first.id);
  assert.equal(second.deduped, true);
  db.close();
});

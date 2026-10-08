import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { insertCoin, LOCAL_MINT, openDb, seedLocalCoin } from "../server/db.js";
import { DRAFT_CARD_URI } from "../server/draft-card.js";
import { createServer } from "../server/index.js";
import { launchCoin } from "../server/launch.js";
import { LIVE_CARD_URI } from "../server/live-card.js";
import { treasuryCanPay } from "../server/treasury.js";

const BANNED = [
  "balanceSol",
  "launchesItCanPay",
  "keyMatchesWallet",
  "SOCKET_LAUNCH_KEY",
  "SOCKET_LAUNCH_BALANCE_SOL",
  "treasuryKey",
  "secretKey",
  "privateKey",
];

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

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
      await new Promise((resolve) => server.close(resolve));
      server.db.close();
    },
  };
}

function rpc(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

async function postMcp(base, body) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

test("treasuryCanPay is false without a key or a full launch balance", () => {
  assert.equal(treasuryCanPay({}), false);
  assert.equal(treasuryCanPay({ SOCKET_LAUNCH_KEY: "   " }), false);
  assert.equal(treasuryCanPay({ SOCKET_LAUNCH_BALANCE_SOL: "10" }), false);
  assert.equal(treasuryCanPay({ SOCKET_LAUNCH_KEY: "present", SOCKET_LAUNCH_BALANCE_SOL: "0.001" }), false);
  assert.equal(treasuryCanPay({ SOCKET_LAUNCH_KEY: "present", SOCKET_LAUNCH_BALANCE_SOL: "0.012" }), true);
});

test("launch_coin pauses, stays idempotent, and does not broadcast", async () => {
  const app = await start();
  try {
    const args = {
      name: "Chamber Lamp",
      ticker: "LAMP",
      wallet: WALLET,
      idempotency_key: "paused-launch-test",
    };
    const first = await postMcp(app.base, rpc(1, "tools/call", { name: "launch_coin", arguments: args }));
    const second = await postMcp(app.base, rpc(2, "tools/call", { name: "launch_coin", arguments: args }));
    for (const call of [first, second]) {
      assert.equal(call.json.result.isError, true);
      assert.equal(call.json.result.content[0].text, "Launches are paused.");
      assert.equal(call.json.result._meta.ui.resourceUri, DRAFT_CARD_URI);
      assert.deepEqual(call.json.result.structuredContent.states, ["received", "quoted", "failed"]);
      assert.equal(call.json.result.structuredContent.status, "failed");
      assert.equal(call.json.result.structuredContent.error, "paused");
      assert.equal(call.json.result.structuredContent.paused, true);
      assert.equal(call.json.result.structuredContent.mint, null);
      assert.equal(call.json.result.structuredContent.userPercent, 50);
      assert.equal(call.json.result.structuredContent.recipientPercent, 50);
      for (const word of BANNED) {
        assert.equal(JSON.stringify(call.json.result).includes(word), false, word);
      }
    }
    assert.equal(first.json.result.structuredContent.idempotencyKey, second.json.result.structuredContent.idempotencyKey);
    const jobs = app.db.prepare(`SELECT * FROM launches`).all();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "failed");
    assert.equal(jobs[0].error, "paused");
    assert.equal(jobs[0].states, "received,quoted,failed");
    assert.equal(jobs[0].user_bps, 5000);
    assert.equal(jobs[0].recipient_bps, 5000);
    assert.equal(jobs[0].mint, null);
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM coins`).get().n, 0);

    const status = await fetch(`${app.base}/api/status`);
    const body = await status.json();
    assert.equal(body.launchesOn, false);
    assert.equal(body.coins, 0);
    const blob = JSON.stringify(body);
    for (const word of BANNED) assert.equal(blob.includes(word), false, word);

    const held = launchCoin(app.db, {
      name: "Held",
      ticker: "HELD",
      idempotency_key: "held-launch-test",
    }, {
      env: { SOCKET_LAUNCH_KEY: "present", SOCKET_LAUNCH_BALANCE_SOL: "1" },
    });
    assert.equal(held.isError, true);
    assert.equal(held.structuredContent.status, "quoted");
    assert.equal(held.structuredContent.states.includes("submitted"), false);
    assert.equal(held.structuredContent.states.includes("confirmed"), false);
    assert.match(held.content[0].text, /No mainnet transaction/);
    assert.equal(JSON.stringify(held).includes("present"), false);

    const short = launchCoin(app.db, {
      name: "Short",
      ticker: "SHORT",
      idempotency_key: "short-launch-test",
    }, {
      env: { SOCKET_LAUNCH_KEY: "present", SOCKET_LAUNCH_BALANCE_SOL: "0.001" },
    });
    assert.equal(short.content[0].text, "Launches are paused.");
    assert.equal(short.structuredContent.error, "paused");
  } finally {
    await app.close();
  }
});

test("the live card shows the local confirmed coin", async () => {
  const app = await start();
  try {
    assert.equal(seedLocalCoin(app.db), true);
    assert.equal(seedLocalCoin(app.db), false);
    const preview = await fetch(`${app.base}/preview/live`);
    const previewHtml = await preview.text();
    assert.equal(preview.status, 200);
    assert.ok(previewHtml.includes('src="/card/live"'));
    assert.ok(previewHtml.includes('type="module" src="/assets/live-preview.js"'));
    const previewJs = readFileSync(new URL("../public/live-preview.js", import.meta.url), "utf8");
    assert.ok(previewJs.includes("scrollHeight"));
    assert.ok(previewHtml.includes("Live <em>card</em>"));
    assert.equal(previewHtml.includes(">Launch<"), false);

    const card = await fetch(`${app.base}/card/live`);
    const html = await card.text();
    assert.equal(card.status, 200);
    assert.match(card.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.equal(card.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.ok(html.includes("Chamber Lamp"));
    assert.ok(html.includes(LOCAL_MINT));
    assert.ok(html.includes(`https://pump.fun/coin/${LOCAL_MINT}`));
    assert.ok(html.includes("paid to your wallet"));
    assert.ok(html.includes("0.0123 SOL"));
    assert.ok(html.includes("0.0012 SOL detected, not yet pushed"));
    assert.ok(html.includes("0.003 SOL"));
    assert.ok(html.includes(">Copy<"));
    assert.equal(html.includes(">Launch<"), false);
    assert.equal(html.includes(">Allow<"), false);
    assert.equal(html.includes(">Confirm<"), false);
    assert.equal(html.includes("75%"), false);
    assert.ok(html.includes("You 50%"));
    assert.ok(html.includes("Recipient 50%"));
    assert.ok(html.includes("/assets/seed-face.png"));

    const home = await fetch(`${app.base}/`);
    const homeHtml = await home.text();
    assert.equal(homeHtml.includes("/preview/live"), false);
    assert.equal(homeHtml.includes("launch_coin"), false);

    const read = await postMcp(app.base, rpc(3, "resources/read", { uri: LIVE_CARD_URI }));
    assert.equal(read.json.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.ok(read.json.result.contents[0].text.includes("Chamber Lamp"));
    assert.ok(read.json.result.contents[0].text.includes("paid to your wallet"));

    const listed = await postMcp(app.base, rpc(4, "resources/list"));
    assert.equal(listed.json.result.resources[0].uri, DRAFT_CARD_URI);
    assert.equal(listed.json.result.resources[1].uri, LIVE_CARD_URI);

    const status = await fetch(`${app.base}/api/status`);
    const body = await status.json();
    for (const word of BANNED) assert.equal(JSON.stringify(body).includes(word), false, word);
    assert.equal(body.launchesOn, false);
    assert.equal("pendingFeeSol" in body, false);
  } finally {
    await app.close();
  }
});

test("openDb can add the pending fee column on an older file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  const dbPath = path.join(dir, "old.sqlite");
  const first = new DatabaseSync(dbPath);
  first.exec(`
    CREATE TABLE coins (
      mint TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ticker TEXT NOT NULL,
      image TEXT,
      description TEXT,
      website TEXT,
      x_url TEXT,
      wallet TEXT,
      recipient TEXT,
      user_bps INTEGER NOT NULL DEFAULT 5000,
      recipient_bps INTEGER NOT NULL DEFAULT 5000,
      status TEXT NOT NULL DEFAULT 'confirmed',
      error TEXT,
      created_at TEXT NOT NULL,
      market_cap_usd REAL,
      market_cap_sol REAL,
      since_launch_pct REAL,
      change_24h_pct REAL,
      volume_24h_usd REAL,
      paid_to_creator_sol REAL NOT NULL DEFAULT 0,
      graduated INTEGER NOT NULL DEFAULT 0,
      launch_sig TEXT,
      live INTEGER NOT NULL DEFAULT 0
    )
  `);
  first.close();
  const second = openDb(dbPath);
  const cols = second.prepare("PRAGMA table_info(coins)").all().map((col) => col.name);
  assert.equal(cols.includes("pending_fee_sol"), true);
  insertCoin(second, {
    mint: LOCAL_MINT,
    name: "Chamber Lamp",
    ticker: "LAMP",
    createdAt: "2026-10-08T12:00:00.000Z",
    pendingFeeSol: 0.0012,
    live: true,
  });
  const row = second.prepare(`SELECT pending_fee_sol AS n FROM coins WHERE mint = ?`).get(LOCAL_MINT);
  assert.equal(row.n, 0.0012);
  second.close();
});

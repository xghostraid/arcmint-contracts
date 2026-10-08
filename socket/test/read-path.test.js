import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { searchCoins, showVolume, sortCoins } from "../public/board.js";
import { formatCap, formatSol, formatTokens } from "../public/format.js";
import { CHATGPT_PATH, RESERVE_RULE, SPLIT_LINE, TOAST_TEXT } from "../shared/copy.js";
import { insertBurn, insertCoin, openDb } from "../server/db.js";
import { createServer } from "../server/index.js";
import { STATUS_KEYS, publicStatus } from "../server/status.js";

const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "Mint11111111111111111111111111111111111111";
const SIG = "1".repeat(88);
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

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  return openDb(path.join(dir, "t.sqlite"));
}

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

async function get(base, pathname) {
  const res = await fetch(base + pathname);
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  return { res, text, json };
}

async function postMcp(base, body, accept = "application/json, text/event-stream") {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((item) => item.startsWith("data: "));
    json = JSON.parse(line.slice(6));
  } else if (text) {
    json = JSON.parse(text);
  }
  return { res, text, json };
}

test("formatters use M, k, and raw token units", () => {
  assert.equal(formatTokens("0"), "0");
  assert.equal(formatTokens("1000000"), "1");
  assert.equal(formatTokens("1500000000"), "1.5k");
  assert.equal(formatTokens("999000000"), "999");
  assert.equal(formatTokens("5298952760519"), "5.3M");
  assert.equal(formatSol(0), "0");
  assert.equal(formatSol(0.012309341), "0.0123");
  assert.equal(formatCap({ marketCapUsd: null, marketCapSol: 28.51 }), "28.51 SOL");
  assert.equal(formatCap({ marketCapUsd: null, marketCapSol: null }), "\u2013");
});

test("search and sort stay on name, ticker, and mint", () => {
  const coins = [
    { name: "Amber", ticker: "AMB", mint: "aaa", createdAt: "2026-10-08T01:00:00.000Z", marketCapSol: 10, marketCapUsd: null, paidToCreatorSol: 1, volume24hUsd: null },
    { name: "Brass", ticker: "BRS", mint: "bbb", createdAt: "2026-10-08T03:00:00.000Z", marketCapSol: null, marketCapUsd: 50, paidToCreatorSol: 4, volume24hUsd: null },
    { name: "Clay", ticker: "CLY", mint: "ccc", createdAt: "2026-10-08T02:00:00.000Z", marketCapSol: 30, marketCapUsd: null, paidToCreatorSol: 2, volume24hUsd: 9 },
  ];
  assert.deepEqual(searchCoins(coins, "brs").map((coin) => coin.ticker), ["BRS"]);
  assert.deepEqual(searchCoins(coins, "CCC").map((coin) => coin.name), ["Clay"]);
  assert.deepEqual(sortCoins(coins, "new").map((coin) => coin.ticker), ["BRS", "CLY", "AMB"]);
  assert.deepEqual(sortCoins(coins, "paid").map((coin) => coin.ticker), ["BRS", "CLY", "AMB"]);
  assert.deepEqual(sortCoins(coins, "top").map((coin) => coin.ticker), ["CLY", "AMB", "BRS"]);
  assert.equal(showVolume(coins), true);
  assert.equal(showVolume(coins.slice(0, 2)), false);
});

test("schema is coins, burns, and pictures, split locked at 50/50", () => {
  const db = tempDb();
  const names = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'
  `).all().map((row) => row.name).sort();
  assert.deepEqual(names, ["burns", "coins", "fee_ledger", "launches", "nonces", "pictures", "sessions"]);
  const cols = db.prepare("PRAGMA table_info(coins)").all().map((col) => col.name);
  for (const banned of ["private_key", "secret", "signer", "treasury_key"]) {
    assert.equal(cols.includes(banned), false);
  }
  assert.throws(() => insertCoin(db, {
    mint: MINT,
    name: "Boost",
    ticker: "BOOST",
    createdAt: "2026-10-08T00:00:00.000Z",
    userBps: 7500,
    recipientBps: 2500,
  }));
  db.close();
});

test("public status counts the daily budget and hides signer fields", () => {
  const db = tempDb();
  const now = new Date("2026-10-08T12:00:00.000Z");
  insertCoin(db, {
    mint: MINT,
    name: "Amber",
    ticker: "AMB",
    createdAt: "2026-10-08T11:00:00.000Z",
    status: "confirmed",
    live: true,
    paidToCreatorSol: 0.5,
    wallet: "Wallet1111111111111111111111111111111111",
  });
  insertCoin(db, {
    mint: OTHER,
    name: "Old",
    ticker: "OLD",
    createdAt: "2026-10-07T11:00:00.000Z",
    status: "confirmed",
    live: true,
  });
  insertCoin(db, {
    mint: "Fail111111111111111111111111111111111111",
    name: "Fail",
    ticker: "FAIL",
    createdAt: "2026-10-08T11:30:00.000Z",
    status: "failed",
    live: false,
    error: "paused",
  });
  insertCoin(db, {
    mint: "Subm111111111111111111111111111111111111",
    name: "Sub",
    ticker: "SUB",
    createdAt: "2026-10-08T11:45:00.000Z",
    status: "submitted",
    live: false,
  });
  insertBurn(db, { sol: 0.05, tokens: "1500000000", at: "2026-10-08T10:00:00.000Z", burnSig: SIG });
  const body = publicStatus(db, now);
  assert.deepEqual(Object.keys(body), [...STATUS_KEYS]);
  assert.equal(body.launchesOn, false);
  assert.equal(body.launchesLeftToday, 198);
  assert.equal(body.launchesLeftThisHour, 28);
  assert.equal(body.coins, 2);
  assert.equal(body.live, 2);
  assert.equal(body.paidToCreatorsSol, 0.5);
  assert.equal(body.tokensBurned, "1500000000");
  assert.equal(body.display.burned, "1.5k");
  assert.equal(body.split.userPercent, 50);
  assert.equal(body.split.recipient, null);
  const blob = JSON.stringify(body);
  for (const word of BANNED) assert.equal(blob.includes(word), false, word);
  db.close();
});

test("http read path, empty screens, and mcp tools", async () => {
  const app = await start();
  try {
    const status = await get(app.base, "/api/status");
    assert.equal(status.res.status, 200);
    assert.equal(status.json.launchesOn, false);
    assert.equal(status.json.launchesLeftToday, 200);
    assert.equal(status.json.coins, 0);
    for (const word of BANNED) assert.equal(JSON.stringify(status.json).includes(word), false);

    const coins = await get(app.base, "/api/coins");
    assert.deepEqual(coins.json, { live: true, total: 0, coins: [] });
    const burns = await get(app.base, "/api/burns");
    assert.deepEqual(burns.json.burns, []);
    assert.equal(burns.json.tokensBurned, "0");

    const home = await get(app.base, "/");
    assert.equal(home.res.status, 200);
    assert.match(home.text, /From the chat/);
    assert.match(home.text, /to the curve/);
    assert.equal(/plugged/i.test(home.text), false);
    assert.ok(home.text.includes(TOAST_TEXT));
    assert.ok(home.text.includes(CHATGPT_PATH));
    assert.ok(home.text.includes(SPLIT_LINE));
    assert.ok(home.text.includes("See the floor"));
    assert.ok(home.text.includes("/mcp"));
    assert.equal(home.text.includes("Diamond Paws"), false);
    assert.equal(home.text.includes("75%"), false);
    assert.equal(home.text.includes("launch_coin"), false);
    assert.equal(home.text.includes("/preview/live"), false);
    assert.equal(home.text.includes("balanceSol"), false);
    assert.equal(/d97757|4ade80|86efac|0c0f0d|gradient|marquee|Geist|Source Serif|Doto/i.test(home.text), false);
    assert.ok(home.text.includes("status-line"));
    assert.ok(home.text.includes("#07080c"));
    assert.ok(home.text.includes("site.css"));
    assert.equal(/bodoni|b68b4c|e6eef2/i.test(home.text), false);

    const floor = await get(app.base, "/floor");
    assert.ok(floor.text.includes("The floor is clear."));
    assert.ok(floor.text.includes("data-vol hidden"));
    assert.ok(floor.text.includes("Most paid"));

    const coin = await get(app.base, `/coin/${MINT}`);
    assert.equal(coin.res.status, 404);
    assert.ok(coin.text.includes("Not in the <em>book</em>."));
    assert.equal(coin.text.includes("fee-you"), false);

    const tape = await get(app.base, "/burns");
    assert.ok(tape.text.includes("No burns yet."));
    assert.ok(tape.text.includes(RESERVE_RULE));

    const picture = await fetch(`${app.base}/api/picture`, { method: "POST" });
    assert.equal(picture.status, 400);
    assert.deepEqual(await picture.json(), { ok: false, stored: false, error: "format" });
    const pictureGet = await fetch(`${app.base}/api/picture`);
    assert.equal(pictureGet.status, 405);
    assert.equal((await get(app.base, "/")).text.includes("/preview/draft"), false);

    const init = await postMcp(app.base, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    assert.equal(init.res.status, 200);
    assert.match(init.res.headers.get("content-type"), /text\/event-stream/);
    assert.match(init.text, /^event: message/);
    assert.equal(init.json.result.serverInfo.name, "Socket");
    assert.equal(init.json.result.protocolVersion, "2025-03-26");

    const tools = await postMcp(app.base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, "application/json");
    assert.equal(tools.res.headers.get("content-type").includes("application/json"), true);
    assert.deepEqual(tools.json.result.tools.map((tool) => tool.name), ["ping", "quote_launch", "open_picture_panel", "launch_coin", "coin_status", "list_wallet_coins"]);

    const ping = await postMcp(app.base, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    });
    assert.match(ping.json.result.content[0].text, /50%/);
    assert.match(ping.json.result.content[0].text, /paused/);
    assert.equal(ping.json.result.content[0].text.includes("75%"), false);

    const missing = await postMcp(app.base, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "coin_status", arguments: { address: MINT } },
    });
    assert.match(missing.json.result.content[0].text, /not in Socket's book/);
    assert.equal(missing.json.result.isError, undefined);

    const noted = await postMcp(app.base, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(noted.res.status, 202);
    assert.equal(noted.text, "");

    const got = await fetch(`${app.base}/mcp`);
    assert.equal(got.status, 405);
  } finally {
    await app.close();
  }
});

test("live coins render, failures stay off the floor, markup is escaped", async () => {
  const app = await start();
  try {
    insertCoin(app.db, {
      mint: MINT,
      name: "</h1><script>alert(1)</script>",
      ticker: "AMB",
      createdAt: "2026-10-08T08:00:00.000Z",
      live: true,
      wallet: "Wallet1111111111111111111111111111111111",
      paidToCreatorSol: 0.012309341,
      marketCapSol: 28.51,
      sinceLaunchPct: 1.99,
      image: "javascript:alert(1)",
      launchSig: SIG,
      description: "kept off the public page",
    });
    insertCoin(app.db, {
      mint: OTHER,
      name: "Hidden fail",
      ticker: "FAIL",
      createdAt: "2026-10-08T09:00:00.000Z",
      status: "failed",
      live: false,
      error: "signer missing",
    });
    insertBurn(app.db, {
      sol: 0.2,
      tokens: "5298952760519",
      at: "2026-10-08T09:30:00.000Z",
      burnSig: SIG,
      swapSig: "2".repeat(88),
      mint: MINT,
    });

    const list = await get(app.base, "/api/coins");
    assert.equal(list.json.total, 1);
    assert.deepEqual(Object.keys(list.json.coins[0]), [
      "mint", "name", "ticker", "image", "createdAt", "marketCapUsd", "marketCapSol",
      "sinceLaunchPct", "change24hPct", "volume24hUsd", "paidToCreatorSol", "graduated",
      "wallet", "recipient", "userPercent", "recipientPercent", "launchSig",
    ]);
    assert.equal(list.json.coins[0].image, null);
    assert.equal(list.json.coins[0].userPercent, 50);
    assert.equal("error" in list.json.coins[0], false);

    const floor = await get(app.base, "/floor");
    assert.equal(floor.text.includes("FAIL"), false);
    assert.equal(floor.text.includes("<script>alert"), false);
    assert.ok(floor.text.includes("&lt;script&gt;"));
    assert.ok(floor.text.includes("28.51 SOL"));
    assert.ok(floor.text.includes("data-vol hidden"));

    const page = await get(app.base, `/coin/${MINT}`);
    assert.equal(page.res.status, 200);
    assert.ok(page.text.includes("fee-you"));
    assert.ok(page.text.includes("You 50%"));
    assert.ok(page.text.includes("0.0123"));
    assert.ok(page.text.includes("On the curve"));
    assert.ok(page.text.includes(`https://pump.fun/coin/${MINT}`));
    assert.ok(page.text.includes(`https://solscan.io/tx/${SIG}`));
    assert.equal(page.text.includes("javascript:"), false);
    assert.equal(page.text.includes("signer missing"), false);

    const detail = await get(app.base, `/api/coins/${MINT}`);
    assert.equal(detail.json.burnsAttributed, true);
    assert.equal(detail.json.events[1].kind, "burn");

    const hidden = await get(app.base, `/coin/${OTHER}`);
    assert.equal(hidden.res.status, 404);

    const called = await postMcp(app.base, {
      jsonrpc: "2.0",
      id: "c",
      method: "tools/call",
      params: { name: "coin_status", arguments: { address: MINT } },
    }, "application/json");
    const text = called.json.result.content[0].text;
    assert.match(text, new RegExp(`https://pump.fun/coin/${MINT}`));
    assert.match(text, /50\/50/);
    assert.match(text, /0\.0123 SOL/);
    assert.equal(text.includes("balanceSol"), false);

    const bad = await postMcp(app.base, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "coin_status", arguments: { address: "nope" } },
    }, "application/json");
    assert.equal(bad.json.result.isError, true);

    const tape = await get(app.base, "/burns");
    assert.ok(tape.text.includes("5.3M"));
    assert.equal(tape.text.includes("No burns yet."), false);

    const withVolume = await get(app.base, "/api/coins");
    assert.equal(withVolume.json.coins[0].volume24hUsd, null);
  } finally {
    await app.close();
  }
});

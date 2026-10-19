import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { buildTerminal } from "../src/app.js";
import { openDb } from "../src/db.js";
import { FAST_KDF, PASS, fakeConnection, testConfig } from "./helpers.js";

async function setup() {
  const connection = fakeConnection({
    getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => ({ lamports: 2_000_000_000, data: Buffer.alloc(0), owner: Keypair.generate().publicKey, executable: false })),
  });
  return buildTerminal({ config: testConfig({ webDir: "/nonexistent" }), db: openDb(":memory:"), connection, kdf: FAST_KDF });
}

test("api: vault lifecycle, auth, wallets, export gate", async () => {
  const t = await setup();
  const { app } = t;
  try {
    let r = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(r.json().vault.initialized, false);
    assert.equal(r.json().network, "local");

    r = await app.inject({ method: "GET", url: "/api/wallets" });
    assert.equal(r.statusCode, 401);

    r = await app.inject({ method: "POST", url: "/api/vault/init", payload: { passphrase: PASS } });
    assert.equal(r.statusCode, 200);
    const auth = { authorization: `Bearer ${r.json().token}` };

    r = await app.inject({ method: "POST", url: "/api/groups", headers: auth, payload: { name: "bundle" } });
    const groupId = r.json().id;
    r = await app.inject({ method: "POST", url: "/api/wallets/generate", headers: auth, payload: { count: 4, groupId, labelPrefix: "Bundle" } });
    assert.equal(r.json().length, 4);
    const kp = Keypair.generate();
    r = await app.inject({ method: "POST", url: "/api/wallets/import", headers: auth, payload: { text: bs58.encode(kp.secretKey) } });
    assert.equal(r.json().created[0].address, kp.publicKey.toBase58());
    const importedId = r.json().created[0].id;

    r = await app.inject({ method: "GET", url: "/api/wallets", headers: auth });
    assert.equal(r.json().length, 5);
    assert.equal(JSON.stringify(r.json()).includes("encrypted"), false, "no ciphertext in listings");

    r = await app.inject({ method: "POST", url: "/api/balances", headers: auth, payload: {} });
    assert.equal(Object.keys(r.json().native).length, 5);

    r = await app.inject({ method: "POST", url: "/api/wallets/export", headers: auth, payload: { ids: [importedId], passphrase: "wrong passphrase" } });
    assert.equal(r.statusCode, 401);
    r = await app.inject({ method: "POST", url: "/api/wallets/export", headers: auth, payload: { ids: [importedId], passphrase: PASS } });
    assert.equal(r.json()[0].secretKey, bs58.encode(kp.secretKey));

    r = await app.inject({ method: "GET", url: "/api/activity", headers: auth });
    assert.ok(r.json().some((e: { kind: string }) => e.kind === "export"), "export is audited");

    r = await app.inject({ method: "POST", url: "/api/trade/buy", headers: auth, payload: { mint: "x", walletIds: [1], solPerWallet: "abc" } });
    assert.equal(r.statusCode, 400);

    r = await app.inject({ method: "POST", url: "/api/treasury/distribute", headers: auth, payload: { fromWalletId: 1, toWalletIds: [2, 3], solEach: "10" } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /TERMINAL_MAX_SOL_PER_ACTION/);

    await app.inject({ method: "POST", url: "/api/vault/lock", headers: auth });
    r = await app.inject({ method: "GET", url: "/api/wallets", headers: auth });
    assert.equal(r.statusCode, 401, "lock revokes sessions");
    r = await app.inject({ method: "POST", url: "/api/vault/unlock", payload: { passphrase: PASS } });
    assert.ok(r.json().token);
  } finally {
    await t.close();
  }
});

test("api: bots, kill switch, alerts, tokens", async () => {
  const sent: string[] = [];
  const connection = fakeConnection({ getAccountInfo: async () => null, getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => null) });
  const t = await buildTerminal({
    config: testConfig({ webDir: "/nonexistent", telegramBotToken: "1:x", telegramChatId: "42" }),
    db: openDb(":memory:"),
    connection,
    kdf: FAST_KDF,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body).text);
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
    },
  });
  const { app } = t;
  try {
    let r = await app.inject({ method: "POST", url: "/api/vault/init", payload: { passphrase: PASS } });
    const auth = { authorization: `Bearer ${r.json().token}` };
    r = await app.inject({ method: "POST", url: "/api/wallets/generate", headers: auth, payload: { count: 2 } });
    const walletIds = r.json().map((w: { id: number }) => w.id);
    const mint = Keypair.generate().publicKey.toBase58();

    r = await app.inject({ method: "GET", url: "/api/tokens", headers: auth });
    assert.deepEqual(r.json(), []);

    const dca = { side: "buy", walletIds, solPerWallet: 0.01, intervalSec: 60, runs: 3 };
    r = await app.inject({ method: "POST", url: "/api/strategies", headers: auth, payload: { kind: "dca", mint, budgetSol: 0, config: dca } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /budget/);
    r = await app.inject({ method: "POST", url: "/api/strategies", headers: auth, payload: { kind: "dca", mint, budgetSol: 0.1, config: { ...dca, intervalSec: 1 } } });
    assert.equal(r.statusCode, 400, "config is validated");
    r = await app.inject({ method: "POST", url: "/api/strategies", headers: auth, payload: { kind: "snipe", mint, budgetSol: 1, config: { walletIds, targetSupplyPct: 10, maxMarketCapSol: 100, solPerBuy: 0.1 } } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /own launches|does not exist/);

    r = await app.inject({ method: "POST", url: "/api/strategies", headers: auth, payload: { kind: "dca", name: "test dca", mint, budgetSol: 0.1, config: dca } });
    assert.equal(r.statusCode, 200);
    const sid = r.json().id;
    assert.equal(r.json().status, "paused");
    assert.equal(r.json().budgetLamports, "100000000");

    r = await app.inject({ method: "POST", url: `/api/strategies/${sid}/start`, headers: auth });
    assert.equal(r.json().status, "running");
    r = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(r.json().botsRunning, 1);
    assert.equal(r.json().alerts, true);

    r = await app.inject({ method: "DELETE", url: `/api/strategies/${sid}`, headers: auth });
    assert.equal(r.statusCode, 400, "running bots cannot be deleted");

    r = await app.inject({ method: "POST", url: "/api/strategies/kill-switch", headers: auth, payload: { on: true } });
    assert.deepEqual(r.json(), { killSwitch: true, paused: 1 });
    r = await app.inject({ method: "GET", url: "/api/strategies", headers: auth });
    assert.equal(r.json().killSwitch, true);
    assert.equal(r.json().strategies[0].status, "paused");
    r = await app.inject({ method: "POST", url: `/api/strategies/${sid}/start`, headers: auth });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /kill switch/i);
    await app.inject({ method: "POST", url: "/api/strategies/kill-switch", headers: auth, payload: { on: false } });

    r = await app.inject({ method: "GET", url: `/api/strategies/${sid}`, headers: auth });
    assert.equal(r.json().strategy.name, "test dca");
    assert.deepEqual(r.json().intents, []);
    r = await app.inject({ method: "POST", url: `/api/strategies/${sid}/stop`, headers: auth });
    assert.equal(r.json().status, "stopped");
    r = await app.inject({ method: "DELETE", url: `/api/strategies/${sid}`, headers: auth });
    assert.equal(r.statusCode, 200);

    r = await app.inject({ method: "GET", url: "/api/alerts", headers: auth });
    assert.equal(r.json().enabled, true);
    assert.equal(r.json().chatId, "…42");
    r = await app.inject({ method: "PATCH", url: "/api/alerts", headers: auth, payload: { fills: false } });
    assert.equal(r.json().fills, false);
    r = await app.inject({ method: "POST", url: "/api/alerts/test", headers: auth });
    assert.deepEqual(r.json(), { ok: true });
    await t.notifier.flush();
    assert.ok(sent.some((s) => s.includes("Kill switch ON")), "kill switch alert sent");
    assert.ok(sent.some((s) => s.includes("Test alert")));

    r = await app.inject({ method: "GET", url: "/api/strategies", headers: { authorization: "Bearer nope" } });
    assert.equal(r.statusCode, 401);
  } finally {
    await t.close();
  }
});

test("config: mainnet requires explicit opt-in", async () => {
  const { loadConfig } = await import("../src/config.js");
  assert.throws(() => loadConfig({ TERMINAL_NETWORK: "mainnet" }), /TERMINAL_ALLOW_MAINNET/);
  assert.equal(loadConfig({ TERMINAL_NETWORK: "mainnet", TERMINAL_ALLOW_MAINNET: "1" }).network, "mainnet");
  assert.equal(loadConfig({}).network, "devnet");
});

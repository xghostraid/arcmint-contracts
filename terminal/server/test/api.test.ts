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

test("config: mainnet requires explicit opt-in", async () => {
  const { loadConfig } = await import("../src/config.js");
  assert.throws(() => loadConfig({ TERMINAL_NETWORK: "mainnet" }), /TERMINAL_ALLOW_MAINNET/);
  assert.equal(loadConfig({ TERMINAL_NETWORK: "mainnet", TERMINAL_ALLOW_MAINNET: "1" }).network, "mainnet");
  assert.equal(loadConfig({}).network, "devnet");
});

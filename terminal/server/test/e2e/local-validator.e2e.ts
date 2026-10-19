// End-to-end run against a local validator with pump.fun cloned from devnet (`npm run validator`).
// Free local SOL only; no real keys or funds are involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection } from "@solana/web3.js";
import { buildTerminal } from "../../src/app.js";
import { openDb } from "../../src/db.js";
import { FAST_KDF, PASS, testConfig } from "../helpers.js";

const RPC = process.env.TERMINAL_E2E_RPC ?? "http://127.0.0.1:8899";

async function reachable(): Promise<boolean> {
  try {
    await new Connection(RPC).getVersion();
    return true;
  } catch {
    return false;
  }
}

test("e2e: fund → bundled launch → multi-wallet buy/sell → sweep", { timeout: 300_000, skip: !(await reachable()) && `no validator at ${RPC}` }, async () => {
  const t = await buildTerminal({
    config: testConfig({ rpcUrl: RPC, maxSolPerAction: 50, defaultPriorityMicroLamports: 1_000, webDir: "/nonexistent" }),
    db: openDb(":memory:"),
    kdf: FAST_KDF,
  });
  const { app } = t;
  const call = async (method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: auth });
    if (r.statusCode !== 200) throw new Error(`${method} ${url} → ${r.statusCode}: ${r.body}`);
    return r.json();
  };
  let auth: Record<string, string> = {};
  try {
    auth = { authorization: `Bearer ${(await call("POST", "/api/vault/init", { passphrase: PASS })).token}` };
    const mk = async (name: string, count: number) => {
      const g = await call("POST", "/api/groups", { name });
      return (await call("POST", "/api/wallets/generate", { count, groupId: g.id, labelPrefix: name })) as { id: number; address: string; label: string }[];
    };
    const [treasury] = await mk("treasury", 1);
    const [dev] = await mk("dev", 1);
    const bundle = await mk("bundle", 4);
    const traders = await mk("traders", 2);
    const others = [dev!, ...bundle, ...traders];

    await call("POST", "/api/dev/airdrop", { walletIds: [treasury!.id], sol: 40 });

    const dry = await call("POST", "/api/treasury/distribute", { fromWalletId: treasury!.id, toWalletIds: others.map((w) => w.id), solEach: "3", dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.txs.every((x: { status: string }) => x.status === "simulated"));
    const fund = await call("POST", "/api/treasury/distribute", { fromWalletId: treasury!.id, toWalletIds: others.map((w) => w.id), solEach: "3" });
    assert.ok(fund.txs.every((x: { status: string }) => x.status === "confirmed"), JSON.stringify(fund.txs));
    let bal = (await call("POST", "/api/balances", { walletIds: others.map((w) => w.id) })).native;
    for (const w of others) assert.equal(bal[w.address], "3000000000");

    const launchReq = {
      name: "Terminal Test",
      symbol: "TTEST",
      uri: "https://example.com/terminal-test.json",
      devWalletId: dev!.id,
      // The devnet pump.fun config seeds curves with 0.3 virtual SOL (mainnet: 30), so amounts are scaled down.
      devBuySol: "0.05",
      buyers: bundle.map((w, i) => ({ walletId: w.id, sol: (0.02 + i * 0.01).toFixed(2) })),
      slippageBps: 500,
      mode: "bundle",
    };
    const plan = await call("POST", "/api/launch", { ...launchReq, dryRun: true });
    assert.equal(plan.plan.allocations.length, 5);
    assert.equal(plan.txs[0].status, "simulated", JSON.stringify(plan.txs[0]));
    assert.ok(plan.plan.totalSupplyPct > 0 && plan.plan.totalSupplyPct < 80);

    const launched = await call("POST", "/api/launch", launchReq);
    assert.equal(launched.mode, "sequential", "no Jito on local; falls back to sequential");
    assert.ok(launched.txs.every((x: { status: string }) => x.status === "confirmed"), JSON.stringify(launched.txs, null, 1));
    const mint: string = launched.plan.mint;
    console.log(`  launched ${mint} in ${launched.txs.length} txs; own supply ${launched.plan.totalSupplyPct.toFixed(2)}%`);

    const holdings = (await call("POST", "/api/balances", { walletIds: [dev!.id, ...bundle.map((w) => w.id)], mint })).token;
    for (const a of launched.plan.allocations as { address: string; tokens: string; label: string }[]) {
      // Each wallet receives exactly the token amount the chained quote predicted.
      assert.equal(holdings[a.address], a.tokens, `${a.label} holds what the plan said`);
    }

    const info = await call("GET", `/api/tokens/${mint}`);
    assert.equal(info.venue, "pumpfun");
    assert.equal(info.symbol, "TTEST");
    assert.equal(info.creatorIsOwn, true);

    const buy = await call("POST", "/api/trade/buy", { mint, walletIds: traders.map((w) => w.id), solPerWallet: "0.03", slippageBps: 300, mode: "parallel" });
    assert.ok(buy.txs.every((x: { status: string }) => x.status === "confirmed"), JSON.stringify(buy.txs));

    const sellHalf = await call("POST", "/api/trade/sell", { mint, walletIds: bundle.map((w) => w.id), percent: 50, slippageBps: 500, mode: "bundle" });
    assert.ok(sellHalf.txs.every((x: { status: string }) => x.status === "confirmed"), JSON.stringify(sellHalf.txs));
    const after = (await call("POST", "/api/balances", { walletIds: bundle.map((w) => w.id), mint })).token;
    for (const w of bundle) assert.ok(BigInt(after[w.address]) > 0n && BigInt(after[w.address]) < BigInt(holdings[w.address]));

    const sellAll = await call("POST", "/api/trade/sell", { mint, walletIds: traders.map((w) => w.id), percent: 100, mode: "parallel" });
    assert.ok(sellAll.txs.every((x: { status: string }) => x.status === "confirmed"));
    const traderTokens = (await call("POST", "/api/balances", { walletIds: traders.map((w) => w.id), mint })).token;
    for (const w of traders) assert.equal(traderTokens[w.address], "0");

    const sweep = await call("POST", "/api/treasury/sweep", { fromWalletIds: others.map((w) => w.id), toWalletId: treasury!.id });
    assert.ok(sweep.txs.every((x: { status: string }) => x.status === "confirmed"), JSON.stringify(sweep.txs));
    bal = (await call("POST", "/api/balances", { walletIds: others.map((w) => w.id) })).native;
    for (const w of others) assert.equal(bal[w.address], "0", `${w.label} swept to zero`);

    const launches = await call("GET", "/api/launches");
    assert.equal(launches[0].status, "confirmed");
    assert.equal(JSON.stringify(launches).includes("sealedMintSecret"), false);
    const activity = await call("GET", "/api/activity");
    for (const kind of ["distribute", "launch", "buy", "sell", "sweep"]) assert.ok(activity.some((e: { kind: string }) => e.kind === kind), kind);
  } finally {
    await t.close();
  }
});

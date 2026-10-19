// Phase 2 end-to-end run on the local validator (`npm run validator`): lookup-table launch, trade ingestion,
// dashboard data, the bot engine and PumpSwap. Free local SOL only; no real keys or funds are involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { NATIVE_MINT, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";
import { buildTerminal, type Terminal } from "../../src/app.js";
import { openDb } from "../../src/db.js";
import { pumpSwapSdk } from "../../src/chains/solana/pumpswap.js";
import { FAST_KDF, PASS, testConfig } from "../helpers.js";

const RPC = process.env.TERMINAL_E2E_RPC ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");

async function reachable(): Promise<boolean> {
  try {
    await conn.getVersion();
    return true;
  } catch {
    return false;
  }
}
const skip = !(await reachable()) && `no validator at ${RPC}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type W = { id: number; address: string; label: string; groupId: number | null };
type Tx = { status: string; label: string; error?: string };
const allConfirmed = (txs: Tx[]) => assert.ok(txs.length > 0 && txs.every((x) => x.status === "confirmed"), JSON.stringify(txs, null, 1));

/** A terminal on the local validator, driven through its HTTP API. */
async function terminal() {
  const t: Terminal = await buildTerminal({
    config: testConfig({ rpcUrl: RPC, maxSolPerAction: 50, defaultPriorityMicroLamports: 1_000, webDir: "/nonexistent", ingestWebsocket: false }),
    db: openDb(":memory:"),
    kdf: FAST_KDF,
  });
  let auth: Record<string, string> = {};
  const call = async (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => {
    const r = await t.app.inject({ method, url, payload: payload as object, headers: auth });
    if (r.statusCode !== 200) throw new Error(`${method} ${url} → ${r.statusCode}: ${r.body}`);
    return r.json();
  };
  auth = { authorization: `Bearer ${(await call("POST", "/api/vault/init", { passphrase: PASS })).token}` };
  const wallets = async (name: string, count: number): Promise<W[]> => {
    const g = await call("POST", "/api/groups", { name });
    return call("POST", "/api/wallets/generate", { count, groupId: g.id, labelPrefix: name });
  };
  return { t, call, wallets };
}

async function airdrop(kp: Keypair, sol: number) {
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
}

test("e2e phase 2: 18-wallet lookup-table launch → ingestion, holders, PnL → counter, DCA, limit, snipe bots → table reclaim", { timeout: 600_000, skip }, async () => {
  const me = await terminal();
  const outside = await terminal();
  const { t, call } = me;
  try {
    const [treasury] = await me.wallets("treasury", 1);
    const [dev] = await me.wallets("dev", 1);
    const bundle = await me.wallets("bundle", 18);
    const traders = await me.wallets("traders", 2);
    const funded = [dev!, ...bundle, ...traders];
    await call("POST", "/api/dev/airdrop", { walletIds: [treasury!.id], sol: 40 });
    allConfirmed((await call("POST", "/api/treasury/distribute", { fromWalletId: treasury!.id, toWalletIds: funded.map((w) => w.id), solEach: "1" })).txs);

    const launchReq = {
      name: "Phase Two",
      symbol: "PTWO",
      uri: "https://example.com/phase-two.json",
      devWalletId: dev!.id,
      devBuySol: "0.02",
      buyers: bundle.map((w) => ({ walletId: w.id, sol: "0.004" })),
      slippageBps: 500,
      mode: "bundle",
    };
    const dry = await call("POST", "/api/launch", { ...launchReq, dryRun: true });
    assert.equal(dry.plan.lookupTable.used, true, "auto mode picks a table for 18 bundle wallets");
    assert.ok(dry.plan.txCount <= 5, `fits in a 5-tx bundle with a table (got ${dry.plan.txCount})`);
    assert.ok(dry.plan.lookupTable.txCountWithout > 5, `needs more than 5 without (got ${dry.plan.lookupTable.txCountWithout})`);
    assert.equal(dry.txs[0].status, "simulated", JSON.stringify(dry.txs));

    const launched = await call("POST", "/api/launch", launchReq);
    allConfirmed(launched.txs);
    const mint: string = launched.plan.mint;
    assert.ok(launched.plan.lookupTable.address, "table created");
    assert.ok(launched.txs.length <= 5, `${launched.txs.length} launch txs`);
    console.log(`  launched ${mint}: ${launched.txs.length} txs with a ${launched.plan.lookupTable.addresses}-address table (${launched.plan.lookupTable.txCountWithout} without); own supply ${launched.plan.totalSupplyPct.toFixed(2)}%`);
    const holdings = (await call("POST", "/api/balances", { walletIds: [dev!.id, ...bundle.map((w) => w.id)], mint })).token;
    for (const a of launched.plan.allocations as { address: string; tokens: string; label: string }[]) assert.equal(holdings[a.address], a.tokens, `${a.label} holds what the plan said`);
    const [launchRow] = await call("GET", "/api/launches");
    assert.equal(launchRow.lookupTableStatus, "deactivated", "table deactivated right after the launch");

    // Ingestion: the launch was auto-tracked; a sync pulls the create + 19 buys.
    assert.ok((await call("GET", "/api/tokens")).some((x: { mint: string }) => x.mint === mint), "auto-tracked");
    const synced = await call("POST", `/api/dashboard/${mint}/sync`);
    assert.equal(synced.added, 19, "dev buy + 18 bundle buys");
    let trades = await call("GET", `/api/dashboard/${mint}/trades`);
    assert.ok(trades.every((x: { own: unknown; venue: string; side: string }) => x.own && x.venue === "pumpfun" && x.side === "buy"));
    assert.ok(trades.some((x: { own: { label: string } }) => x.own.label === dev!.label));

    const holders = await call("GET", `/api/dashboard/${mint}/holders`);
    assert.equal(holders.own.wallets, 19);
    assert.ok(Math.abs(holders.own.pct - launched.plan.totalSupplyPct) < 0.01, `own ${holders.own.pct}% vs plan ${launched.plan.totalSupplyPct}%`);
    assert.ok(holders.holders.some((h: { kind: string }) => h.kind === "bonding_curve"));

    let pnl = await call("GET", `/api/dashboard/${mint}/pnl`);
    const planned = (launched.plan.allocations as { tokens: string; lamports: string }[]).reduce((n, a) => n + BigInt(a.tokens), 0n);
    assert.equal(pnl.total.holdingTokens, planned.toString());
    assert.ok(pnl.wallets.every((w: { untrackedTokens: string }) => w.untrackedTokens === "0"), "every held token is explained by an ingested fill");
    const spent = Number(launched.plan.totalLamports);
    assert.ok(Math.abs(Number(pnl.total.costBasisLamports) - spent) / spent < 0.05, `cost basis ${pnl.total.costBasisLamports} ≈ ${spent}`);
    assert.ok(pnl.groups.some((g: { name: string }) => g.name === "bundle"));
    const candles = await call("GET", `/api/dashboard/${mint}/candles?interval=60`);
    assert.ok(candles.length >= 1 && candles.at(-1).close > candles[0].open, "price rises through the launch buys");

    // Bots. Ticks are driven by hand; the feed comes from manual syncs.
    t.engine.start(3_600_000);
    const strategy = async (body: unknown) => call("POST", "/api/strategies", body);
    const get = async (id: number) => call("GET", `/api/strategies/${id}`);

    const counter = await strategy({ kind: "counter", name: "counter", mint, budgetSol: 0, start: true, config: { walletIds: bundle.slice(0, 4).map((w) => w.id), reactTo: "buys", minTradeSol: 0.02, sharePct: 50, maxPerReactionSol: 0.015, cooldownSec: 1 } });
    const [outsider] = await outside.wallets("outsider", 1);
    await outside.call("POST", "/api/dev/airdrop", { walletIds: [outsider!.id], sol: 5 });
    allConfirmed((await outside.call("POST", "/api/trade/buy", { mint, walletIds: [outsider!.id], solPerWallet: "0.04", slippageBps: 500 })).txs);
    assert.equal((await call("POST", `/api/dashboard/${mint}/sync`)).added, 1);
    trades = await call("GET", `/api/dashboard/${mint}/trades?limit=1`);
    assert.equal(trades[0].own, null, "outside buy is unlabeled");
    assert.equal(trades[0].trader, outsider!.address);
    await t.engine.tick();
    let c = await get(counter.id);
    assert.equal(c.intents.length, 1, JSON.stringify(c));
    assert.equal(c.intents[0].side, "sell");
    assert.equal(c.intents[0].status, "ok", JSON.stringify(c.intents[0]));
    assert.ok(Number(c.strategy.receivedLamports) > 0 && Number(c.strategy.receivedLamports) <= 0.016 * LAMPORTS_PER_SOL, c.strategy.receivedLamports);
    await call("POST", `/api/dashboard/${mint}/sync`);
    await t.engine.tick();
    assert.equal((await get(counter.id)).intents.length, 1, "own sells are not answered");

    const dca = await strategy({ kind: "dca", name: "dca", mint, budgetSol: 0.01, start: true, config: { side: "buy", walletIds: traders.map((w) => w.id), solPerWallet: 0.002, intervalSec: 10, runs: 1 } });
    await t.engine.tick();
    let d = (await get(dca.id)).strategy;
    assert.equal(d.status, "completed", d.note);
    assert.equal(d.spentLamports, String(0.004 * LAMPORTS_PER_SOL));
    await call("POST", `/api/dashboard/${mint}/sync`);
    await t.engine.tick();
    assert.equal((await get(counter.id)).intents.length, 1, "own buys are not answered");

    let info = await call("GET", `/api/tokens/${mint}`);
    const mcSol = Number(info.market.marketCapLamports) / LAMPORTS_PER_SOL;
    const before = BigInt((await call("POST", "/api/balances", { walletIds: [bundle[5]!.id], mint })).token[bundle[5]!.address]);
    const limitSell = await strategy({ kind: "limit", name: "limit sell", mint, budgetSol: 0, start: true, config: { side: "sell", walletIds: [bundle[5]!.id], percent: 25, trigger: { metric: "marketCapSol", op: "gte", value: mcSol / 2 } } });
    const limitBuy = await strategy({ kind: "limit", name: "limit buy", mint, budgetSol: 0.01, start: true, config: { side: "buy", walletIds: [traders[0]!.id], solPerWallet: 0.005, trigger: { metric: "marketCapSol", op: "lte", value: mcSol / 100 } } });
    await t.engine.tick();
    const ls = (await get(limitSell.id)).strategy;
    assert.equal(ls.status, "completed", ls.note);
    assert.match(ls.note, /Filled when market cap/);
    const after = BigInt((await call("POST", "/api/balances", { walletIds: [bundle[5]!.id], mint })).token[bundle[5]!.address]);
    assert.equal(after, before - (before * 2_500n) / 10_000n);
    const lb = (await get(limitBuy.id)).strategy;
    assert.equal(lb.status, "running");
    assert.match(lb.note, /Watching: market cap/);
    await call("POST", `/api/strategies/${limitBuy.id}/stop`);

    // Snipe: buy round-robin until own wallets hold about two more buys' worth of supply.
    info = await call("GET", `/api/tokens/${mint}`);
    const share = (await call("GET", `/api/dashboard/${mint}/holders`)).own.pct as number;
    const perBuyPct = (0.005 * LAMPORTS_PER_SOL) / info.market.priceLamportsPerToken / Number(info.supply) * 100;
    const target = share + perBuyPct * 1.5;
    const snipe = await strategy({ kind: "snipe", name: "snipe", mint, budgetSol: 0.05, start: true, config: { walletIds: traders.map((w) => w.id), targetSupplyPct: target, maxMarketCapSol: mcSol * 100, solPerBuy: 0.005, intervalSec: 2 } });
    let s = (await get(snipe.id)).strategy;
    for (let i = 0; i < 12 && s.status === "running"; i++) {
      await t.engine.tick();
      s = (await get(snipe.id)).strategy;
      if (s.status === "running") await sleep(2_100);
    }
    assert.equal(s.status, "completed", s.note);
    assert.match(s.note, /Target reached/);
    assert.ok(s.runs >= 2 && s.runs <= 3, `${s.runs} snipe buys`);
    assert.equal(s.spentLamports, String(s.runs * 0.005 * LAMPORTS_PER_SOL));
    const snipeIntents = (await get(snipe.id)).intents as { detail: { walletId: number } }[];
    assert.ok(new Set(snipeIntents.map((x) => x.detail.walletId)).size === 2, "round-robin across both wallets");

    await call("POST", `/api/dashboard/${mint}/sync`);
    pnl = await call("GET", `/api/dashboard/${mint}/pnl`);
    const trader0 = pnl.wallets.find((w: { walletId: number }) => w.walletId === traders[0]!.id);
    assert.ok(BigInt(trader0.tokensBought) > 0n && trader0.untrackedTokens === "0");
    const b0 = pnl.wallets.find((w: { walletId: number }) => w.walletId === bundle[5]!.id);
    assert.ok(BigInt(b0.tokensSold) > 0n, "limit sell is in the PnL");

    // Kill switch pauses whatever still runs (the counter bot).
    const ks = await call("POST", "/api/strategies/kill-switch", { on: true });
    assert.equal(ks.paused, 1);
    await call("POST", "/api/strategies/kill-switch", { on: false });

    const activity = await call("GET", "/api/activity?limit=500");
    assert.ok(activity.some((e: { kind: string; status: string }) => e.kind === "bot" && e.status === "ok"), "bot fills are in the activity log");
    assert.ok(activity.some((e: { summary: string }) => e.summary.includes("lookup table")), "table creation is logged");

    // The table can be closed once its deactivation slot leaves the slot-hash window (~512 slots).
    let reclaim = await call("POST", `/api/launches/${launchRow.id}/reclaim-table`);
    const deadline = Date.now() + 300_000;
    while (reclaim.status === "cooling_down" && Date.now() < deadline) {
      await sleep(15_000);
      reclaim = await call("POST", `/api/launches/${launchRow.id}/reclaim-table`);
    }
    assert.equal(reclaim.status, "closed", JSON.stringify(reclaim));
    assert.equal(await conn.getAccountInfo(new PublicKey(launched.plan.lookupTable.address)), null, "table account is gone");
  } finally {
    await me.t.close();
    await outside.t.close();
  }
});

test("e2e phase 2: PumpSwap pool → track by pool address → buy/sell through the terminal → AMM trade ingestion", { timeout: 300_000, skip }, async () => {
  const me = await terminal();
  const { call } = me;
  try {
    // An outside creator lists a plain SPL token on PumpSwap (permissionless pool creation).
    const creator = Keypair.generate();
    await airdrop(creator, 20);
    const mint = await createMint(conn, creator, creator.publicKey, null, 6);
    const ata = await getOrCreateAssociatedTokenAccount(conn, creator, mint, creator.publicKey);
    await mintTo(conn, creator, mint, ata.address, creator, 1_000_000_000n * 10n ** 6n);
    const sdk = pumpSwapSdk();
    const cps = await new sdk.OnlinePumpAmmSdk(conn).createPoolSolanaState(0, creator.publicKey, mint, NATIVE_MINT);
    const ixs = await sdk.PUMP_AMM_SDK.createPoolInstructions(cps, new BN("800000000000000"), new BN(String(5 * LAMPORTS_PER_SOL)));
    await sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs), [creator]);
    const pool = cps.poolKey.toBase58();

    const profile = await call("POST", "/api/tokens/track", { address: pool });
    assert.equal(profile.mint, mint.toBase58(), "a pool address resolves to its base mint");
    const info = await call("GET", `/api/tokens/${mint.toBase58()}`);
    assert.equal(info.venue, "pumpswap");
    assert.equal(info.pool.address, pool);
    assert.equal(info.pool.canonical, false);
    assert.ok(Math.abs(info.market.priceLamportsPerToken - 5e9 / 8e14) / (5e9 / 8e14) < 0.01);

    const traders = await me.wallets("traders", 3);
    await call("POST", "/api/dev/airdrop", { walletIds: traders.map((w) => w.id), sol: 2 });
    const dry = await call("POST", "/api/trade/buy", { mint: mint.toBase58(), walletIds: traders.map((w) => w.id), solPerWallet: "0.1", slippageBps: 300, dryRun: true });
    assert.ok(dry.txs.every((x: Tx) => x.status === "simulated"), JSON.stringify(dry.txs));
    const buy = await call("POST", "/api/trade/buy", { mint: mint.toBase58(), walletIds: traders.map((w) => w.id), solPerWallet: "0.1", slippageBps: 300, mode: "bundle" });
    assert.equal(buy.venue, "pumpswap");
    allConfirmed(buy.txs);
    const held = (await call("POST", "/api/balances", { walletIds: traders.map((w) => w.id), mint: mint.toBase58() })).token;
    for (const leg of buy.legs as { address: string; tokens: string }[]) assert.equal(held[leg.address], leg.tokens, "chained pool quotes are exact");

    const sell = await call("POST", "/api/trade/sell", { mint: mint.toBase58(), walletIds: traders.map((w) => w.id), percent: 100, slippageBps: 300 });
    assert.equal(sell.venue, "pumpswap");
    allConfirmed(sell.txs);

    assert.equal((await call("POST", `/api/dashboard/${mint.toBase58()}/sync`)).added, 6);
    const trades = await call("GET", `/api/dashboard/${mint.toBase58()}/trades`);
    assert.ok(trades.every((x: { venue: string; own: unknown }) => x.venue === "pumpswap" && x.own));
    const pnl = await call("GET", `/api/dashboard/${mint.toBase58()}/pnl`);
    assert.equal(pnl.total.holdingTokens, "0");
    assert.equal(pnl.wallets.length, 3);
    // Individual wallets can gain (the first buyer sells into later buys); the batch as a whole only pays fees.
    const realized = BigInt(pnl.total.realizedLamports);
    assert.ok(realized < 0n && realized > -BigInt(0.02 * LAMPORTS_PER_SOL), `round trip costs only fees (${realized})`);
    for (const w of pnl.wallets as { boughtLamports: string; soldLamports: string; realizedLamports: string }[]) {
      assert.equal(BigInt(w.soldLamports) - BigInt(w.boughtLamports), BigInt(w.realizedLamports), "fully closed: realized = sold − bought");
    }
    const holders = await call("GET", `/api/dashboard/${mint.toBase58()}/holders`);
    assert.ok(holders.holders.some((h: { kind: string }) => h.kind === "pool"));
    assert.equal(holders.own.amount, "0");
  } finally {
    await me.t.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Keypair } from "@solana/web3.js";
import { ActivityLog } from "../src/activity.js";
import { StrategyEngine, type StrategyEvent } from "../src/strategies/engine.js";
import type { TokenInfo } from "../src/chains/solana/adapter.js";
import type { BuyLeg, SellLeg, TradeResult } from "../src/services/trade.js";
import type { TradeRow } from "../src/market/trades.js";
import { testConfig, unlockedStore } from "./helpers.js";

const MINT = Keypair.generate().publicKey.toBase58();
const SOL = 1_000_000_000n;

async function rig(opts: { maxPerMinute?: number; own?: boolean; failTrades?: boolean } = {}) {
  const { db, vault, wallets } = await unlockedStore();
  const ws = wallets.generate({ count: 3, labelPrefix: "Bot" });
  const activity = new ActivityLog(db, "local");
  const feed = new EventEmitter();
  let time = 1_000_000;
  const market = { mcLamports: 30n * SOL, price: 3e-5, tokenBalances: {} as Record<string, string>, sol: {} as Record<string, string> };
  const calls: { side: "buy" | "sell"; legs: (BuyLeg | SellLeg)[]; percent?: number }[] = [];
  const result = (side: "buy" | "sell", legs: { walletId: number; amount: bigint }[]): TradeResult => {
    const rows = legs.map((l) => {
      const w = wallets.get(l.walletId);
      return { walletId: w.id, address: w.address, label: w.label, lamports: side === "buy" ? l.amount.toString() : "1000", tokens: side === "sell" ? l.amount.toString() : "5000" };
    });
    return { mode: "parallel", dryRun: false, explorer: {}, venue: "pumpfun", legs: rows, txs: rows.map((r) => ({ label: `${side} ${r.label}`, signature: `sig-${side}-${r.walletId}-${calls.length}`, status: opts.failTrades ? "failed" : "confirmed", error: opts.failTrades ? "boom" : undefined })) };
  };
  const trade = {
    buyLegs: async (req: { legs: BuyLeg[] }) => {
      calls.push({ side: "buy", legs: req.legs });
      return result("buy", req.legs.map((l) => ({ walletId: l.walletId, amount: l.lamports })));
    },
    sellLegs: async (req: { legs: SellLeg[] }) => {
      calls.push({ side: "sell", legs: req.legs });
      return result("sell", req.legs.map((l) => ({ walletId: l.walletId, amount: l.tokens })));
    },
    sell: async (req: { walletIds: number[]; percent: number }) => {
      calls.push({ side: "sell", legs: req.walletIds.map((walletId) => ({ walletId, tokens: 1n })), percent: req.percent });
      return result("sell", req.walletIds.map((walletId) => ({ walletId, amount: 1n })));
    },
  };
  const info = (): TokenInfo =>
    ({ mint: MINT, name: "T", symbol: "T", decimals: 6, supply: "1000000000000000", tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", venue: "pumpfun", venueNote: "", curve: { complete: false, creator: ws[0]!.address, progressPct: 1, marketCapLamports: market.mcLamports.toString(), priceLamportsPerToken: market.price }, pool: null, market: { priceLamportsPerToken: market.price, marketCapLamports: market.mcLamports.toString(), liquidityLamports: "0" } }) as TokenInfo;
  const engine = new StrategyEngine({
    db,
    config: testConfig({ botMaxActionsPerMinute: opts.maxPerMinute ?? 30, lowBalanceSol: 0.05 }),
    network: "local",
    wallets,
    vault,
    activity,
    trade: trade as never,
    market: {
      tokenInfo: async () => info(),
      tokenBalances: async (_m, owners) => Object.fromEntries(owners.map((o) => [o, market.tokenBalances[o] ?? "0"])),
      nativeBalances: async (addrs) => Object.fromEntries(addrs.map((a) => [a, market.sol[a] ?? String(SOL)])),
    },
    feed,
    watch: async () => undefined,
    ownLaunches: () => (opts.own === false ? new Set() : new Set([MINT])),
    clock: () => time,
  });
  const events: StrategyEvent[] = [];
  engine.on("event", (e: StrategyEvent) => events.push(e));
  return { db, vault, wallets, ws, engine, calls, market, feed, events, advance: (ms: number) => (time += ms), now: () => time };
}

const exec = { slippageBps: 500, mode: "parallel" as const };

test("dca: buys every interval, N runs, then completes; each run has its own intent", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "dca", name: "dca", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id, r.ws[1]!.id], solPerWallet: 0.01, intervalSec: 60, runs: 3, ...exec } });
  await r.engine.tick();
  assert.equal(r.calls.length, 1);
  await r.engine.tick();
  assert.equal(r.calls.length, 1, "not due yet");
  r.advance(60_000);
  await r.engine.tick();
  r.advance(60_000);
  await r.engine.tick();
  const done = r.engine.get(s.id);
  assert.equal(r.calls.length, 3);
  assert.equal(done.status, "completed");
  assert.equal(done.spentLamports, String(3n * 2n * 10_000_000n));
  assert.deepEqual(r.engine.intents(s.id).map((i) => i.key).sort(), [`dca:${s.id}:1`, `dca:${s.id}:2`, `dca:${s.id}:3`]);
});

test("dca: stops when the budget would be exceeded", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "dca", name: "b", mint: MINT, budgetSol: 0.025, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 10, ...exec } });
  for (let i = 0; i < 5; i++) {
    await r.engine.tick();
    r.advance(10_000);
  }
  assert.equal(r.calls.length, 2);
  assert.equal(r.engine.get(s.id).status, "completed");
  assert.match(r.engine.get(s.id).note!, /Budget used up/);
});

test("intents: a crash mid-order never repeats it; the bot pauses and resumes past it", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "dca", name: "c", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 2, ...exec } });
  r.db.prepare("INSERT INTO strategy_intents (strategy_id, intent_key, side, status, created_at, updated_at) VALUES (?, ?, 'buy', 'pending', 'x', 'x')").run(s.id, `dca:${s.id}:1`);
  r.engine.start(60_000);
  r.engine.stop();
  assert.equal(r.engine.get(s.id).status, "paused");
  assert.match(r.engine.get(s.id).note!, /Interrupted/);
  await r.engine.resume(s.id);
  await r.engine.tick();
  assert.equal(r.calls.length, 0, "run 1 is treated as possibly sent");
  assert.equal(r.engine.get(s.id).runs, 1);
  r.advance(10_000);
  await r.engine.tick();
  assert.equal(r.calls.length, 1);
  assert.equal(r.engine.get(s.id).status, "completed");
});

test("limit: fires once when market cap crosses the trigger, then completes", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "limit", name: "tp", mint: MINT, budgetSol: 0, start: true, config: { side: "sell", walletIds: [r.ws[0]!.id], percent: 50, trigger: { metric: "marketCapSol", op: "gte", value: 60 }, checkSec: 5, ...exec } });
  await r.engine.tick();
  assert.equal(r.calls.length, 0);
  assert.match(r.engine.get(s.id).note!, /Watching: market cap 30/);
  r.market.mcLamports = 61n * SOL;
  await r.engine.tick();
  assert.equal(r.calls.length, 0, "next check not due");
  r.advance(5_000);
  await r.engine.tick();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.percent, 50);
  assert.equal(r.engine.get(s.id).status, "completed");
  r.advance(5_000);
  await r.engine.tick();
  assert.equal(r.calls.length, 1);
});

test("limit: expires", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "limit", name: "x", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.1, trigger: { metric: "priceSol", op: "lte", value: 0.000001 }, expiresAt: r.now() + 1_000, ...exec } });
  r.advance(2_000);
  await r.engine.tick();
  assert.equal(r.engine.get(s.id).status, "completed");
  assert.match(r.engine.get(s.id).note!, /Expired/);
});

const outside = (side: "buy" | "sell", sol: bigint, n: number, trader = Keypair.generate().publicKey.toBase58()): TradeRow => ({ id: n, mint: MINT, signature: `out${n}`, seq: 0, slot: n, blockTime: n, venue: "pumpfun", side, trader, solLamports: sol.toString(), tokens: "1000000", price: 3e-5 });

test("counter-trade: answers outside buys with sells and outside sells with buys; ignores own and small trades; cooldown", async () => {
  const r = await rig();
  const [a, b] = r.ws;
  r.market.tokenBalances[a!.address] = "10000000000000";
  r.market.tokenBalances[b!.address] = "20000000000000";
  r.market.sol[a!.address] = String(2n * SOL);
  const s = await r.engine.create({ kind: "counter", name: "ct", mint: MINT, budgetSol: 0.3, start: true, config: { walletIds: [a!.id, b!.id], reactTo: "both", minTradeSol: 0.1, sharePct: 50, maxPerReactionSol: 0.2, cooldownSec: 30, minTokensPerWallet: 1000, ...exec } });
  r.engine.start(60_000);
  try {
    r.feed.emit("trade", outside("buy", SOL / 2n, 1));
    r.feed.emit("trade", outside("buy", SOL, 2, a!.address));
    r.feed.emit("trade", outside("buy", SOL / 100n, 3));
    await r.engine.tick();
    assert.equal(r.calls.length, 1, "own and small trades are ignored");
    const sell = r.calls[0]!;
    assert.equal(sell.side, "sell");
    assert.equal((sell.legs[0] as SellLeg).walletId, b!.id, "wallet with the most free inventory");
    assert.equal((sell.legs[0] as SellLeg).tokens, BigInt(Math.floor(200_000_000 / 3e-5)), "50% of 0.5 SOL, capped at maxPerReactionSol");

    r.feed.emit("trade", outside("sell", SOL, 4));
    await r.engine.tick();
    assert.equal(r.calls.length, 1, "cooldown");
    assert.match(r.engine.get(s.id).note!, /Cooldown/);

    r.advance(30_000);
    r.feed.emit("trade", outside("sell", SOL, 5));
    await r.engine.tick();
    const buy = r.calls[1]!;
    assert.equal(buy.side, "buy");
    assert.equal((buy.legs[0] as BuyLeg).lamports, 200_000_000n, "capped at maxPerReactionSol");
    assert.equal((buy.legs[0] as BuyLeg).walletId, a!.id, "wallet with the most SOL");

    r.advance(30_000);
    r.feed.emit("trade", outside("sell", SOL, 6));
    await r.engine.tick();
    assert.equal((r.calls[2]!.legs[0] as BuyLeg).lamports, 100_000_000n, "capped by the remaining budget");
    r.advance(30_000);
    r.feed.emit("trade", outside("sell", SOL, 7));
    await r.engine.tick();
    assert.equal(r.calls.length, 3);
    assert.equal(r.engine.get(s.id).status, "completed");
  } finally {
    r.engine.stop();
  }
});

test("snipe: only on own launches; buys round-robin until the supply target", async () => {
  const notOwn = await rig({ own: false });
  notOwn.db.prepare("UPDATE wallets SET address = ? WHERE id = ?").run(Keypair.generate().publicKey.toBase58(), notOwn.ws[0]!.id);
  await assert.rejects(
    notOwn.engine.create({ kind: "snipe", name: "s", mint: MINT, budgetSol: 1, config: { walletIds: [notOwn.ws[1]!.id], targetSupplyPct: 10, maxMarketCapSol: 100, solPerBuy: 0.05, ...exec } }),
    /own launches/,
  );
  const r = await rig();
  const s = await r.engine.create({ kind: "snipe", name: "s", mint: MINT, budgetSol: 1, start: true, config: { walletIds: [r.ws[1]!.id, r.ws[2]!.id], targetSupplyPct: 10, maxMarketCapSol: 100, solPerBuy: 0.05, intervalSec: 2, ...exec } });
  await r.engine.tick();
  r.advance(2_000);
  await r.engine.tick();
  assert.deepEqual(r.calls.map((c) => (c.legs[0] as BuyLeg).walletId), [r.ws[1]!.id, r.ws[2]!.id]);
  r.market.tokenBalances[r.ws[0]!.address] = String(100_000_000n * 1_000_000n);
  r.advance(2_000);
  await r.engine.tick();
  assert.equal(r.calls.length, 2);
  assert.equal(r.engine.get(s.id).status, "completed");
  assert.match(r.engine.get(s.id).note!, /Target reached: own wallets hold 10.00%/);
});

test("kill switch: pauses every bot and blocks starting until turned off", async () => {
  const r = await rig();
  const a = await r.engine.create({ kind: "dca", name: "a", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 5, ...exec } });
  const b = await r.engine.create({ kind: "limit", name: "b", mint: MINT, budgetSol: 0, start: true, config: { side: "sell", walletIds: [r.ws[0]!.id], percent: 10, trigger: { metric: "marketCapSol", op: "gte", value: 1 }, ...exec } });
  assert.deepEqual(r.engine.setKillSwitch(true), { killSwitch: true, paused: 2 });
  await r.engine.tick();
  assert.equal(r.calls.length, 0);
  assert.equal(r.engine.get(a.id).status, "paused");
  assert.equal(r.engine.get(b.id).note, "Kill switch");
  await assert.rejects(r.engine.resume(a.id), /kill switch/);
  r.engine.setKillSwitch(false);
  await r.engine.resume(a.id);
  await r.engine.tick();
  assert.equal(r.calls.length, 1);
  assert.ok(r.events.some((e) => e.type === "kill_switch"));
});

test("rate cap: at most N bot orders per rolling minute across all bots", async () => {
  const r = await rig({ maxPerMinute: 2 });
  for (let i = 0; i < 3; i++) await r.engine.create({ kind: "dca", name: `r${i}`, mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[i]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 1, ...exec } });
  await r.engine.tick();
  assert.equal(r.calls.length, 2);
  assert.ok(r.engine.list().some((s) => s.note?.includes("orders/minute")));
  r.advance(61_000);
  await r.engine.tick();
  assert.equal(r.calls.length, 3);
});

test("locked vault: bots wait without trading; repeated failures mark a bot failed", async () => {
  const r = await rig();
  const s = await r.engine.create({ kind: "dca", name: "l", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 5, ...exec } });
  r.vault.lock();
  await r.engine.tick();
  assert.equal(r.calls.length, 0);
  assert.match(r.engine.get(s.id).note!, /vault is locked/);

  const f = await rig({ failTrades: true });
  const g = await f.engine.create({ kind: "dca", name: "f", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [f.ws[0]!.id], solPerWallet: 0.01, intervalSec: 10, runs: 5, ...exec } });
  for (let i = 0; i < 4; i++) {
    await f.engine.tick();
    f.advance(30_000);
  }
  assert.equal(f.calls.length, 3, "the same run is retried after a failure, up to the limit");
  assert.equal(f.engine.get(g.id).status, "failed");
  assert.equal(f.engine.get(g.id).runs, 0);
});

test("low balance: alert after a bot buy leaves a wallet under the floor", async () => {
  const r = await rig();
  r.market.sol[r.ws[0]!.address] = String(SOL / 100n);
  await r.engine.create({ kind: "dca", name: "lb", mint: MINT, budgetSol: 1, start: true, config: { side: "buy", walletIds: [r.ws[0]!.id], solPerWallet: 0.001, intervalSec: 10, runs: 2, ...exec } });
  await r.engine.tick();
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(r.events.some((e) => e.type === "low_balance" && e.text.includes("Bot 1")));
});

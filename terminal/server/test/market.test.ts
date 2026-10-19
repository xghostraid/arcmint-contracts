import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { parseTrades, logEvents } from "../src/chains/solana/events.js";
import { applySwap, poolPrice } from "../src/chains/solana/pumpswap.js";
import { buildCandles, computePnl } from "../src/services/dashboard.js";
import { openDb } from "../src/db.js";
import { TradeStore, type TradeRow } from "../src/market/trades.js";
import { TokenRegistry } from "../src/market/tokens.js";
import { Ingestor } from "../src/market/ingest.js";
import type { SolanaAdapter, TokenInfo } from "../src/chains/solana/adapter.js";
import { AMM_ID, PUMP_ID, encodeEvent, fakeConnection, fakeTx } from "./helpers.js";

const mint = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const PUMP = new PublicKey(PUMP_ID);
const AMM = new PublicKey(AMM_ID);
const invoke = (id: string, depth = 1) => `Program ${id} invoke [${depth}]`;
const ok = (id: string) => `Program ${id} success`;
const data = (b: Buffer) => `Program data: ${b.toString("base64")}`;

function pumpTrade(isBuy: boolean, sol: number, tokens: number) {
  return encodeEvent("pump", "TradeEvent", {
    mint,
    user,
    is_buy: isBuy,
    sol_amount: new BN(sol),
    token_amount: new BN(tokens),
    fee: new BN(950),
    creator_fee: new BN(50),
    virtual_sol_reserves: new BN(31_000_000_000),
    virtual_token_reserves: new BN("1000000000000000"),
    timestamp: new BN(1_700_000_123),
  });
}

test("events: Pump.fun TradeEvent from logs, user-side SOL includes fees", () => {
  const tx = fakeTx({ keys: [user, PUMP], logs: [invoke(PUMP_ID), "Program log: Instruction: Buy", data(pumpTrade(true, 100_000, 5_000)), ok(PUMP_ID)] });
  const [t] = parseTrades(tx);
  assert.ok(t);
  assert.equal(t.venue, "pumpfun");
  assert.equal(t.side, "buy");
  assert.equal(t.mint, mint.toBase58());
  assert.equal(t.trader, user.toBase58());
  assert.equal(t.solLamports, 101_000n);
  assert.equal(t.tokens, 5_000n);
  assert.equal(t.price, 31_000_000_000 / 1e15);
  const [s] = parseTrades(fakeTx({ keys: [user, PUMP], logs: [invoke(PUMP_ID), data(pumpTrade(false, 100_000, 5_000)), ok(PUMP_ID)] }));
  assert.equal(s!.side, "sell");
  assert.equal(s!.solLamports, 99_000n, "sell proceeds are net of fees");
});

test("events: emit_cpi inner instructions are preferred over logs (no double counting)", () => {
  const tag = Buffer.from("e445a52e51cb9a1d", "hex");
  const ev = pumpTrade(true, 100_000, 5_000);
  const tx = fakeTx({ keys: [user, PUMP], logs: [invoke(PUMP_ID), data(ev), ok(PUMP_ID)], inner: [{ programIdIndex: 1, data: Buffer.concat([tag, ev]) }] });
  assert.equal(parseTrades(tx).length, 1);
  assert.equal(parseTrades(fakeTx({ keys: [user, PUMP], inner: [{ programIdIndex: 1, data: Buffer.concat([tag, ev]) }] })).length, 1);
});

test("events: PumpSwap buy/sell are attributed by pool; same discriminators are not confused across programs", () => {
  const buy = encodeEvent("amm", "BuyEvent", {
    pool,
    user,
    base_amount_out: new BN(1_000_000),
    user_quote_amount_in: new BN(2_100_000),
    quote_amount_in_with_lp_fee: new BN(2_005_000),
    pool_base_token_reserves: new BN(100_000_000),
    pool_quote_token_reserves: new BN(200_000_000),
    timestamp: new BN(1),
  });
  const sell = encodeEvent("amm", "SellEvent", { pool, user, base_amount_in: new BN(1_000_000), user_quote_amount_out: new BN(1_900_000), quote_amount_out_without_lp_fee: new BN(1_995_000), pool_base_token_reserves: new BN(99_000_000), pool_quote_token_reserves: new BN(202_005_000) });
  const extend = encodeEvent("amm", "ExtendAccountEvent", { account: pool, user });
  const logs = [invoke(AMM_ID), data(extend), data(buy), ok(AMM_ID), invoke(AMM_ID), data(sell), ok(AMM_ID)];
  assert.deepEqual(logEvents(logs).map((e) => `${e.program === AMM_ID ? "amm" : "pump"}:${e.name}`), ["amm:ExtendAccountEvent", "amm:BuyEvent", "amm:SellEvent"]);
  const pools = new Map([[pool.toBase58(), mint.toBase58()]]);
  const trades = parseTrades(fakeTx({ keys: [user, AMM], logs }), pools);
  assert.equal(trades.length, 2);
  assert.equal(trades[0]!.side, "buy");
  assert.equal(trades[0]!.solLamports, 2_100_000n);
  assert.equal(trades[0]!.price, 202_005_000 / 99_000_000, "post-trade reserves");
  assert.equal(trades[1]!.side, "sell");
  assert.equal(trades[1]!.solLamports, 1_900_000n);
  assert.equal(parseTrades(fakeTx({ keys: [user, AMM], logs })).length, 0, "unknown pool ignored");
  assert.equal(parseTrades(fakeTx({ keys: [user, AMM], logs, err: { InstructionError: [0, "Custom"] } }), pools).length, 0, "failed tx ignored");
});

test("pumpswap: reserve chaining and spot price", () => {
  const r = applySwap({ base: 1_000n, quote: 500n }, "buy", 100n, 60n);
  assert.deepEqual(r, { base: 900n, quote: 560n });
  assert.deepEqual(applySwap(r, "sell", 100n, 60n), { base: 1_000n, quote: 500n });
  assert.throws(() => applySwap(r, "buy", 900n, 1n), /pool's token reserve/);
  assert.equal(poolPrice({ baseReserve: 1_000n, quoteReserve: 500n, virtualQuoteReserve: 500n }), 1);
});

const row = (side: "buy" | "sell", sol: number, tokens: number, time: number, price = 1): TradeRow => ({ id: time, mint: "m", signature: `s${time}`, seq: 0, slot: time, blockTime: time, venue: "pumpfun", side, trader: "w", solLamports: String(sol), tokens: String(tokens), price });

test("pnl: average cost, realized on sells, unrealized at spot, untracked tokens flagged", () => {
  const trades = [row("buy", 100, 1_000, 1), row("buy", 300, 1_000, 2), row("sell", 250, 1_000, 3)];
  const r = computePnl(trades, 1_000n, 0.5);
  assert.equal(r.boughtLamports, "400");
  assert.equal(r.soldLamports, "250");
  assert.equal(r.realizedLamports, "50", "sold half the position (basis 200) for 250");
  assert.equal(r.costBasisLamports, "200");
  assert.equal(r.valueLamports, "500");
  assert.equal(r.unrealizedLamports, "300");
  assert.equal(r.untrackedTokens, "0");
  const extra = computePnl(trades, 1_500n, 0.5);
  assert.equal(extra.untrackedTokens, "500", "tokens received outside own fills have no cost basis");
  assert.equal(computePnl([], 0n, 1).realizedLamports, "0");
});

test("candles: bucketed OHLC with continuous opens and SOL volume", () => {
  const c = buildCandles([row("buy", 10, 1, 0, 1), row("buy", 10, 1, 30, 3), row("sell", 5, 1, 59, 2), row("buy", 7, 1, 61, 4)], 60);
  assert.equal(c.length, 2);
  assert.deepEqual({ ...c[0] }, { time: 0, open: 1, high: 3, low: 1, close: 2, volumeLamports: "25" });
  assert.deepEqual({ ...c[1] }, { time: 60, open: 2, high: 4, low: 2, close: 4, volumeLamports: "7" });
});

test("ingest: backfill, then incremental sync from the newest signature; duplicates ignored", async () => {
  const db = openDb(":memory:");
  const info = { mint: mint.toBase58(), symbol: "TST", name: "Test", decimals: 6, supply: "1000000000000000", tokenProgram: "", venue: "pumpfun", venueNote: "", curve: null, pool: null, market: null } as unknown as TokenInfo;
  const sigs = ["s3", "s2", "s1"];
  const untilSeen: (string | undefined)[] = [];
  const txFor = (sig: string) => fakeTx({ keys: [user, PUMP], logs: [invoke(PUMP_ID), data(pumpTrade(true, Number(sig.slice(1)) * 1000, 10)), ok(PUMP_ID)], slot: Number(sig.slice(1)) });
  const conn = fakeConnection({
    getSignaturesForAddress: async (_a: unknown, o: { until?: string }) => {
      untilSeen.push(o.until);
      const list = o.until ? sigs.slice(0, sigs.indexOf(o.until)) : sigs;
      return list.map((signature) => ({ signature, err: null, slot: 1, blockTime: 1, memo: null }));
    },
    getTransactions: async (list: string[]) => list.map(txFor),
  });
  const sol = { conn, tokenInfo: async () => info } as unknown as SolanaAdapter;
  const tokens = new TokenRegistry(db, "local", sol);
  await tokens.track(mint.toBase58()).catch(() => undefined);
  db.prepare("INSERT OR IGNORE INTO tokens (network, mint, decimals, supply, tracked, added_at) VALUES ('local', ?, 6, '0', 1, 'now')").run(mint.toBase58());
  const store = new TradeStore(db, "local");
  const ing = new Ingestor(conn, tokens, store, { pollMs: 1_000, backfill: 100, websocket: false });
  const seen: TradeRow[] = [];
  ing.on("trade", (t: TradeRow) => seen.push(t));
  assert.equal(await ing.sync(mint.toBase58()), 3);
  assert.deepEqual(seen.map((t) => t.signature), ["s1", "s2", "s3"], "oldest first");
  assert.equal(tokens.get(mint.toBase58())!.newestSignature, "s3");
  sigs.unshift("s4");
  assert.equal(await ing.sync(mint.toBase58()), 1);
  assert.equal(untilSeen.at(-1), "s3");
  assert.equal(store.count(mint.toBase58()), 4);
  db.prepare("UPDATE tokens SET newest_signature = NULL").run();
  assert.equal(await ing.sync(mint.toBase58()), 0, "re-reading the same signatures adds nothing");
});

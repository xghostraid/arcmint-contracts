import { createRequire } from "node:module";
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import type { BorshCoder } from "@coral-xyz/anchor";
import { pumpSdk } from "./pumpfun.js";
import { pumpSwapSdk } from "./pumpswap.js";

export type TradeVenue = "pumpfun" | "pumpswap";

/** One swap, normalized. SOL is user-side: what a buyer paid including fees, what a seller received after fees. */
export interface ParsedTrade {
  seq: number;
  venue: TradeVenue;
  side: "buy" | "sell";
  mint: string;
  trader: string;
  solLamports: bigint;
  tokens: bigint;
  /** Spot price after the trade, lamports per base unit. */
  price: number;
  pool: string | null;
  timestamp: number;
}

/** sha256("anchor:event")[0..8]: the instruction tag of Anchor's emit_cpi! self-invocation. */
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

let coders: { pump: BorshCoder; amm: BorshCoder; pumpId: string; ammId: string } | null = null;
function getCoders() {
  if (!coders) {
    const { BorshCoder: Coder } = createRequire(import.meta.url)("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
    coders = {
      pump: new Coder(pumpSdk().pumpIdl as never),
      amm: new Coder(pumpSwapSdk().pumpAmmJson as never),
      pumpId: pumpSdk().PUMP_PROGRAM_ID.toBase58(),
      ammId: pumpSwapSdk().PUMP_AMM_PROGRAM_ID.toBase58(),
    };
  }
  return coders;
}

interface RawEvent {
  program: string;
  name: string;
  data: Record<string, unknown>;
}

const big = (v: unknown): bigint => BigInt(String(v ?? 0));
const key = (v: unknown): string => (v instanceof PublicKey ? v.toBase58() : String(v));

function decode(program: string, payload: Buffer): RawEvent | null {
  const c = getCoders();
  const coder = program === c.pumpId ? c.pump : program === c.ammId ? c.amm : null;
  if (!coder) return null;
  try {
    const e = coder.events.decode(payload.toString("base64"));
    return e ? { program, name: e.name, data: e.data as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/** Events from emit_cpi! inner instructions; exact and immune to log truncation. */
function cpiEvents(tx: VersionedTransactionResponse): RawEvent[] {
  const keys = [
    ...tx.transaction.message.staticAccountKeys.map((k) => k.toBase58()),
    ...(tx.meta?.loadedAddresses?.writable ?? []).map((k) => k.toBase58()),
    ...(tx.meta?.loadedAddresses?.readonly ?? []).map((k) => k.toBase58()),
  ];
  const out: RawEvent[] = [];
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const program = keys[ix.programIdIndex];
      if (!program) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const e = decode(program, data.subarray(8));
      if (e) out.push(e);
    }
  }
  return out;
}

/** Events from `Program data:` lines, attributed to the program on top of the invoke stack. */
export function logEvents(logs: string[]): RawEvent[] {
  const stack: string[] = [];
  const out: RawEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack.length) {
      const e = decode(stack.at(-1)!, Buffer.from(line.slice(14), "base64"));
      if (e) out.push(e);
    }
  }
  return out;
}

const TRADE_EVENTS = new Set(["TradeEvent", "BuyEvent", "SellEvent"]);

function normalize(e: RawEvent, seq: number, pools: Map<string, string>): ParsedTrade | null {
  const d = e.data;
  if (e.name === "TradeEvent") {
    const isBuy = Boolean(d.is_buy);
    const curveSol = big(d.sol_amount);
    const fees = big(d.fee) + big(d.creator_fee) + big(d.buyback_fee);
    const vT = big(d.virtual_token_reserves);
    return {
      seq,
      venue: "pumpfun",
      side: isBuy ? "buy" : "sell",
      mint: key(d.mint),
      trader: key(d.user),
      solLamports: isBuy ? curveSol + fees : curveSol > fees ? curveSol - fees : 0n,
      tokens: big(d.token_amount),
      price: vT > 0n ? Number(big(d.virtual_sol_reserves)) / Number(vT) : 0,
      pool: null,
      timestamp: Number(d.timestamp ?? 0),
    };
  }
  const pool = key(d.pool);
  const mint = pools.get(pool);
  if (!mint) return null;
  const baseBefore = big(d.pool_base_token_reserves);
  const quoteBefore = big(d.pool_quote_token_reserves);
  const virtualQuote = big(d.virtual_quote_reserves);
  if (e.name === "BuyEvent") {
    const tokens = big(d.base_amount_out);
    const base = baseBefore - tokens;
    const quote = quoteBefore + big(d.quote_amount_in_with_lp_fee);
    return { seq, venue: "pumpswap", side: "buy", mint, trader: key(d.user), solLamports: big(d.user_quote_amount_in), tokens, price: base > 0n ? Number(quote + virtualQuote) / Number(base) : 0, pool, timestamp: Number(d.timestamp ?? 0) };
  }
  const tokens = big(d.base_amount_in);
  const base = baseBefore + tokens;
  const out = big(d.quote_amount_out_without_lp_fee);
  const quote = quoteBefore > out ? quoteBefore - out : 0n;
  return { seq, venue: "pumpswap", side: "sell", mint, trader: key(d.user), solLamports: big(d.user_quote_amount_out), tokens, price: base > 0n ? Number(quote + virtualQuote) / Number(base) : 0, pool, timestamp: Number(d.timestamp ?? 0) };
}

/**
 * Every Pump.fun curve trade and PumpSwap swap in a confirmed transaction. `pools` maps known PumpSwap pool
 * addresses to their base mint (AMM events carry the pool, not the mint).
 */
export function parseTrades(tx: VersionedTransactionResponse, pools: Map<string, string> = new Map()): ParsedTrade[] {
  if (!tx.meta || tx.meta.err) return [];
  let events = cpiEvents(tx).filter((e) => TRADE_EVENTS.has(e.name));
  if (!events.length) events = logEvents(tx.meta.logMessages ?? []).filter((e) => TRADE_EVENTS.has(e.name));
  const out: ParsedTrade[] = [];
  events.forEach((e, i) => {
    const t = normalize(e, i, pools);
    if (t) out.push(t);
  });
  return out;
}

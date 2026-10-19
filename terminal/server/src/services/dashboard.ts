import { PublicKey } from "@solana/web3.js";
import type { SolanaAdapter, TokenInfo } from "../chains/solana/adapter.js";
import { parsePubkey } from "../chains/solana/adapter.js";
import { pumpSdk } from "../chains/solana/pumpfun.js";
import { holderSnapshot } from "../market/holders.js";
import type { TokenRegistry } from "../market/tokens.js";
import type { TradeRow, TradeStore } from "../market/trades.js";
import type { Wallet, WalletStore } from "../wallets.js";

export interface OwnLabel {
  walletId: number;
  label: string;
  groupId: number | null;
}

export interface LabeledTrade extends TradeRow {
  own: OwnLabel | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeLamports: string;
}

export interface WalletPnl {
  walletId: number;
  address: string;
  label: string;
  groupId: number | null;
  boughtLamports: string;
  soldLamports: string;
  tokensBought: string;
  tokensSold: string;
  holdingTokens: string;
  costBasisLamports: string;
  realizedLamports: string;
  valueLamports: string;
  unrealizedLamports: string;
  /** Tokens held beyond what the user's own fills explain (transfers, launch allocations not yet ingested). */
  untrackedTokens: string;
}

export interface PnlReport {
  mint: string;
  priceLamportsPerToken: number;
  wallets: WalletPnl[];
  groups: { groupId: number | null; name: string; realizedLamports: string; unrealizedLamports: string; valueLamports: string; costBasisLamports: string }[];
  total: { realizedLamports: string; unrealizedLamports: string; valueLamports: string; costBasisLamports: string; holdingTokens: string; supplyPct: number };
}

/** Average-cost PnL from the user's own fills, valued at the current spot price. */
export function computePnl(trades: TradeRow[], holdings: bigint, price: number): Omit<WalletPnl, "walletId" | "address" | "label" | "groupId"> {
  let bought = 0n;
  let sold = 0n;
  let tokensBought = 0n;
  let tokensSold = 0n;
  let qty = 0n;
  let basis = 0n;
  let realized = 0n;
  for (const t of trades) {
    const solAmt = BigInt(t.solLamports);
    const tokens = BigInt(t.tokens);
    if (t.side === "buy") {
      bought += solAmt;
      tokensBought += tokens;
      qty += tokens;
      basis += solAmt;
      continue;
    }
    sold += solAmt;
    tokensSold += tokens;
    const matched = tokens < qty ? tokens : qty;
    const basisOut = qty > 0n ? (basis * matched) / qty : 0n;
    realized += solAmt - basisOut;
    basis -= basisOut;
    qty -= matched;
  }
  const tracked = holdings < qty ? holdings : qty;
  // Tokens sent out of the wallet leave their share of cost basis behind as unrecoverable.
  const basisHeld = qty > 0n ? (basis * tracked) / qty : 0n;
  const value = BigInt(Math.floor(Number(holdings) * price));
  const trackedValue = BigInt(Math.floor(Number(tracked) * price));
  return {
    boughtLamports: bought.toString(),
    soldLamports: sold.toString(),
    tokensBought: tokensBought.toString(),
    tokensSold: tokensSold.toString(),
    holdingTokens: holdings.toString(),
    costBasisLamports: basisHeld.toString(),
    realizedLamports: realized.toString(),
    valueLamports: value.toString(),
    unrealizedLamports: (trackedValue - basisHeld).toString(),
    untrackedTokens: (holdings - tracked).toString(),
  };
}

export function buildCandles(trades: TradeRow[], intervalSec: number): Candle[] {
  const out: Candle[] = [];
  for (const t of trades) {
    const time = Math.floor(t.blockTime / intervalSec) * intervalSec;
    const last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, t.price);
      last.low = Math.min(last.low, t.price);
      last.close = t.price;
      last.volumeLamports = (BigInt(last.volumeLamports) + BigInt(t.solLamports)).toString();
    } else {
      const open = last ? last.close : t.price;
      out.push({ time, open, high: Math.max(open, t.price), low: Math.min(open, t.price), close: t.price, volumeLamports: t.solLamports });
    }
  }
  return out;
}

export class DashboardService {
  constructor(
    private readonly sol: SolanaAdapter,
    private readonly wallets: WalletStore,
    private readonly tokens: TokenRegistry,
    private readonly store: TradeStore,
  ) {}

  private ownMap(): Map<string, Wallet> {
    return new Map(this.wallets.list({ includeArchived: true, family: "solana" }).map((w) => [w.address, w]));
  }

  private label(own: Map<string, Wallet>, address: string): OwnLabel | null {
    const w = own.get(address);
    return w ? { walletId: w.id, label: w.label, groupId: w.groupId } : null;
  }

  labelTrade(t: TradeRow, own = this.ownMap()): LabeledTrade {
    return { ...t, own: this.label(own, t.trader) };
  }

  trades(mint: string, limit = 100, beforeId?: number): LabeledTrade[] {
    const own = this.ownMap();
    return this.store.recent(mint, limit, beforeId).map((t) => this.labelTrade(t, own));
  }

  candles(mint: string, intervalSec: number, fromTime = 0): Candle[] {
    return buildCandles(this.store.since(mint, fromTime), intervalSec);
  }

  async overview(mint: string): Promise<{ info: TokenInfo; tracked: boolean; tradeCount: number; stats24h: { trades: number; buys: number; sells: number; volumeLamports: string; ownVolumeLamports: string } }> {
    const info = await this.tokens.refresh(mint).catch(() => this.sol.tokenInfo(mint));
    const since = Math.floor(Date.now() / 1000) - 86_400;
    const day = this.store.since(mint, since);
    const own = this.ownMap();
    let vol = 0n;
    let ownVol = 0n;
    for (const t of day) {
      vol += BigInt(t.solLamports);
      if (own.has(t.trader)) ownVol += BigInt(t.solLamports);
    }
    return {
      info,
      tracked: this.tokens.get(mint)?.tracked ?? false,
      tradeCount: this.store.count(mint),
      stats24h: { trades: day.length, buys: day.filter((t) => t.side === "buy").length, sells: day.filter((t) => t.side === "sell").length, volumeLamports: vol.toString(), ownVolumeLamports: ownVol.toString() },
    };
  }

  async holders(mintAddress: string, limit = 100) {
    const mint = parsePubkey(mintAddress, "mint");
    const info = await this.sol.tokenInfo(mint.toBase58());
    const snap = await holderSnapshot(this.sol.conn, mint, new PublicKey(info.tokenProgram));
    const supply = BigInt(info.supply);
    const own = this.ownMap();
    const curve = pumpSdk().bondingCurvePda(mint).toBase58();
    const pct = (n: bigint) => (supply > 0n ? Number((n * 1_000_000n) / supply) / 10_000 : 0);
    const kindOf = (owner: string) => (owner === curve ? "bonding_curve" : owner === info.pool?.address ? "pool" : own.has(owner) ? "own" : "external");
    const rows = snap.holders.map((h) => ({ owner: h.owner, amount: h.amount.toString(), pct: pct(h.amount), kind: kindOf(h.owner), own: this.label(own, h.owner) }));
    const ownTotal = snap.holders.filter((h) => own.has(h.owner)).reduce((n, h) => n + h.amount, 0n);
    return {
      mint: info.mint,
      supply: info.supply,
      decimals: info.decimals,
      complete: snap.complete,
      holderCount: snap.complete ? rows.length : null,
      own: { wallets: rows.filter((r) => r.kind === "own").length, amount: ownTotal.toString(), pct: pct(ownTotal) },
      holders: rows.slice(0, limit),
    };
  }

  async pnl(mintAddress: string): Promise<PnlReport> {
    const mint = parsePubkey(mintAddress, "mint");
    const info = await this.sol.tokenInfo(mint.toBase58());
    const price = info.market?.priceLamportsPerToken ?? 0;
    const ws = this.wallets.list({ includeArchived: true, family: "solana" });
    const trades = this.store.byTraders(mint.toBase58(), ws.map((w) => w.address));
    const balances = await this.sol.tokenBalances(mint, ws.map((w) => w.address), new PublicKey(info.tokenProgram));
    const byTrader = new Map<string, TradeRow[]>();
    for (const t of trades) byTrader.set(t.trader, [...(byTrader.get(t.trader) ?? []), t]);
    const rows: WalletPnl[] = ws
      .filter((w) => byTrader.has(w.address) || BigInt(balances[w.address] ?? "0") > 0n)
      .map((w) => ({ walletId: w.id, address: w.address, label: w.label, groupId: w.groupId, ...computePnl(byTrader.get(w.address) ?? [], BigInt(balances[w.address] ?? "0"), price) }));
    const groupNames = new Map(this.wallets.listGroups().map((g) => [g.id, g.name]));
    const sum = (list: WalletPnl[], k: keyof WalletPnl) => list.reduce((n, r) => n + BigInt(r[k] as string), 0n).toString();
    const groupIds = [...new Set(rows.map((r) => r.groupId))];
    const supply = BigInt(info.supply);
    const holding = BigInt(sum(rows, "holdingTokens"));
    return {
      mint: info.mint,
      priceLamportsPerToken: price,
      wallets: rows,
      groups: groupIds.map((g) => {
        const list = rows.filter((r) => r.groupId === g);
        return { groupId: g, name: g === null ? "Ungrouped" : (groupNames.get(g) ?? `Group ${g}`), realizedLamports: sum(list, "realizedLamports"), unrealizedLamports: sum(list, "unrealizedLamports"), valueLamports: sum(list, "valueLamports"), costBasisLamports: sum(list, "costBasisLamports") };
      }),
      total: {
        realizedLamports: sum(rows, "realizedLamports"),
        unrealizedLamports: sum(rows, "unrealizedLamports"),
        valueLamports: sum(rows, "valueLamports"),
        costBasisLamports: sum(rows, "costBasisLamports"),
        holdingTokens: holding.toString(),
        supplyPct: supply > 0n ? Number((holding * 1_000_000n) / supply) / 10_000 : 0,
      },
    };
  }
}

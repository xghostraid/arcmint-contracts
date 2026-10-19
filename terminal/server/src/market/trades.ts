import type { Db } from "../db.js";
import type { ParsedTrade } from "../chains/solana/events.js";

export interface TradeRow {
  id: number;
  mint: string;
  signature: string;
  seq: number;
  slot: number;
  blockTime: number;
  venue: string;
  side: "buy" | "sell";
  trader: string;
  solLamports: string;
  tokens: string;
  price: number;
}

interface Row {
  id: number;
  mint: string;
  signature: string;
  seq: number;
  slot: number;
  block_time: number;
  venue: string;
  side: "buy" | "sell";
  trader: string;
  sol_lamports: string;
  tokens: string;
  price: number;
}

const toTrade = (r: Row): TradeRow => ({
  id: r.id,
  mint: r.mint,
  signature: r.signature,
  seq: r.seq,
  slot: r.slot,
  blockTime: r.block_time,
  venue: r.venue,
  side: r.side,
  trader: r.trader,
  solLamports: r.sol_lamports,
  tokens: r.tokens,
  price: r.price,
});

export class TradeStore {
  constructor(
    private readonly db: Db,
    private readonly network: string,
  ) {}

  /** Inserts one decoded trade; returns null when it was already stored. */
  insert(meta: { signature: string; slot: number; blockTime: number }, t: ParsedTrade): TradeRow | null {
    const r = this.db
      .prepare(
        `INSERT INTO trades (network, mint, signature, seq, slot, block_time, venue, side, trader, sol_lamports, tokens, price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (network, signature, seq) DO NOTHING`,
      )
      .run(this.network, t.mint, meta.signature, t.seq, meta.slot, meta.blockTime, t.venue, t.side, t.trader, t.solLamports.toString(), t.tokens.toString(), t.price);
    if (!r.changes) return null;
    return { id: Number(r.lastInsertRowid), mint: t.mint, signature: meta.signature, seq: t.seq, slot: meta.slot, blockTime: meta.blockTime, venue: t.venue, side: t.side, trader: t.trader, solLamports: t.solLamports.toString(), tokens: t.tokens.toString(), price: t.price };
  }

  /** Newest first. */
  recent(mint: string, limit = 100, beforeId?: number): TradeRow[] {
    const rows = (beforeId
      ? this.db.prepare("SELECT * FROM trades WHERE network = ? AND mint = ? AND id < ? ORDER BY block_time DESC, id DESC LIMIT ?").all(this.network, mint, beforeId, limit)
      : this.db.prepare("SELECT * FROM trades WHERE network = ? AND mint = ? ORDER BY block_time DESC, id DESC LIMIT ?").all(this.network, mint, limit)) as unknown as Row[];
    return rows.map(toTrade);
  }

  /** Oldest first, optionally from a unix time. */
  since(mint: string, fromTime = 0): TradeRow[] {
    const rows = this.db.prepare("SELECT * FROM trades WHERE network = ? AND mint = ? AND block_time >= ? ORDER BY block_time, slot, id").all(this.network, mint, fromTime) as unknown as Row[];
    return rows.map(toTrade);
  }

  byTraders(mint: string, traders: string[]): TradeRow[] {
    if (!traders.length) return [];
    const out: TradeRow[] = [];
    for (let i = 0; i < traders.length; i += 500) {
      const chunk = traders.slice(i, i + 500);
      const rows = this.db
        .prepare(`SELECT * FROM trades WHERE network = ? AND mint = ? AND trader IN (${chunk.map(() => "?").join(",")}) ORDER BY block_time, slot, id`)
        .all(this.network, mint, ...chunk) as unknown as Row[];
      out.push(...rows.map(toTrade));
    }
    return out.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot || a.id - b.id);
  }

  count(mint: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM trades WHERE network = ? AND mint = ?").get(this.network, mint) as { n: number }).n;
  }
}

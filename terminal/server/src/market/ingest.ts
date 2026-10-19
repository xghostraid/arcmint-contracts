import { EventEmitter } from "node:events";
import { PublicKey, type ConfirmedSignatureInfo, type Connection } from "@solana/web3.js";
import { parseTrades } from "../chains/solana/events.js";
import type { TokenRegistry } from "./tokens.js";
import type { TradeRow, TradeStore } from "./trades.js";

export interface IngestOptions {
  /** Poll interval; the WebSocket subscription only nudges an earlier poll. */
  pollMs: number;
  /** Signatures fetched when a token is first tracked. */
  backfill: number;
  websocket: boolean;
}

const PAGE = 100;
const TX_BATCH = 20;

/**
 * Keeps the trades table current for every tracked token: signatures for the mint since the newest one seen,
 * decoded into Pump.fun / PumpSwap trades. Emits "trade" for each new row.
 */
export class Ingestor extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>();
  private subs = new Map<string, number>();
  private chains = new Map<string, Promise<number>>();
  private nudges = new Map<string, NodeJS.Timeout>();
  private running = false;
  readonly errors = new Map<string, string>();

  constructor(
    private readonly conn: Connection,
    private readonly tokens: TokenRegistry,
    private readonly store: TradeStore,
    private readonly opts: IngestOptions,
  ) {
    super();
    this.setMaxListeners(100);
  }

  start(): void {
    this.running = true;
    for (const t of this.tokens.list()) this.watch(t.mint);
  }

  stop(): void {
    this.running = false;
    for (const mint of [...this.timers.keys()]) this.unwatch(mint);
  }

  watch(mint: string): void {
    if (!this.running || this.timers.has(mint)) return;
    const loop = () => {
      void this.sync(mint).finally(() => {
        if (this.timers.has(mint)) this.timers.set(mint, setTimeout(loop, this.opts.pollMs));
      });
    };
    this.timers.set(mint, setTimeout(loop, 0));
    if (this.opts.websocket) {
      try {
        this.subs.set(mint, this.conn.onLogs(new PublicKey(mint), () => this.nudge(mint), "confirmed"));
      } catch {
        // Polling still covers the token.
      }
    }
  }

  unwatch(mint: string): void {
    clearTimeout(this.timers.get(mint));
    this.timers.delete(mint);
    clearTimeout(this.nudges.get(mint));
    this.nudges.delete(mint);
    const sub = this.subs.get(mint);
    if (sub !== undefined) void this.conn.removeOnLogsListener(sub).catch(() => undefined);
    this.subs.delete(mint);
  }

  private nudge(mint: string): void {
    if (this.nudges.has(mint)) return;
    this.nudges.set(
      mint,
      setTimeout(() => {
        this.nudges.delete(mint);
        void this.sync(mint);
      }, 300),
    );
  }

  /** Fetches and stores new trades for one mint; calls for the same mint run one after another. */
  sync(mint: string): Promise<number> {
    const prev = this.chains.get(mint) ?? Promise.resolve(0);
    const next = prev.catch(() => 0).then(() => this.syncOnce(mint));
    this.chains.set(mint, next);
    return next;
  }

  private async syncOnce(mint: string): Promise<number> {
    const profile = this.tokens.get(mint);
    if (!profile) return 0;
    try {
      const sigs = await this.newSignatures(new PublicKey(mint), profile.newestSignature);
      if (!sigs.length) return 0;
      const pools = this.tokens.poolMap();
      let added = 0;
      const ordered = sigs.filter((s) => !s.err).reverse();
      for (let i = 0; i < ordered.length; i += TX_BATCH) {
        const batch = ordered.slice(i, i + TX_BATCH);
        const txs = await this.conn.getTransactions(
          batch.map((s) => s.signature),
          { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        );
        txs.forEach((tx, j) => {
          if (!tx) return;
          const sig = batch[j]!;
          for (const t of parseTrades(tx, pools)) {
            if (t.mint !== mint) continue;
            const row = this.store.insert({ signature: sig.signature, slot: tx.slot, blockTime: tx.blockTime ?? t.timestamp }, t);
            if (row) {
              added++;
              this.emit("trade", row satisfies TradeRow);
            }
          }
        });
      }
      this.tokens.setNewestSignature(mint, sigs[0]!.signature);
      this.errors.delete(mint);
      return added;
    } catch (err) {
      this.errors.set(mint, (err as Error).message);
      return 0;
    }
  }

  /** Newest first, stopping at `until` (exclusive) or the backfill limit. */
  private async newSignatures(address: PublicKey, until: string | null): Promise<ConfirmedSignatureInfo[]> {
    const out: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    const limit = until ? Number.POSITIVE_INFINITY : this.opts.backfill;
    while (out.length < limit) {
      const page = await this.conn.getSignaturesForAddress(address, { before, until: until ?? undefined, limit: PAGE }, "confirmed");
      out.push(...page);
      if (page.length < PAGE) break;
      before = page.at(-1)!.signature;
    }
    return Number.isFinite(limit) ? out.slice(0, limit) : out;
  }
}

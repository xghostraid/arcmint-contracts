import { EventEmitter } from "node:events";
import type { Db } from "../db.js";
import { now as isoNow } from "../db.js";
import type { ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import { InputError, parsePubkey, type TokenInfo } from "../chains/solana/adapter.js";
import type { TradeRow } from "../market/trades.js";
import type { BuyLeg, ExecParams, SellLeg, TradeOrigin, TradeResult } from "../services/trade.js";
import type { WalletStore } from "../wallets.js";
import { sol, toLamports } from "../util/amount.js";
import {
  spendsSol,
  strategyInput,
  type CounterConfig,
  type DcaConfig,
  type LimitConfig,
  type SnipeConfig,
  type Strategy,
  type StrategyIntent,
  type StrategyKind,
  type StrategyStatus,
} from "./types.js";

/** What the engine needs from the rest of the app; tests pass fakes. */
export interface EngineDeps {
  db: Db;
  config: Config;
  network: string;
  wallets: WalletStore;
  vault: { readonly unlocked: boolean };
  activity: ActivityLog;
  trade: {
    buyLegs(req: { mint: string; legs: BuyLeg[]; info?: TokenInfo } & ExecParams, origin?: TradeOrigin): Promise<TradeResult>;
    sellLegs(req: { mint: string; legs: SellLeg[]; info?: TokenInfo } & ExecParams, origin?: TradeOrigin): Promise<TradeResult>;
    sell(req: { mint: string; walletIds: number[]; percent: number } & ExecParams, origin?: TradeOrigin): Promise<TradeResult>;
  };
  market: {
    tokenInfo(mint: string): Promise<TokenInfo>;
    tokenBalances(mint: import("@solana/web3.js").PublicKey, owners: string[], tokenProgram?: import("@solana/web3.js").PublicKey): Promise<Record<string, string>>;
    nativeBalances(addresses: string[]): Promise<Record<string, string>>;
  };
  /** Live trades from ingestion. */
  feed: EventEmitter;
  /** Makes sure ingestion covers the mint (counter-trade needs the live feed). */
  watch(mint: string): Promise<void>;
  ownLaunches(): Set<string>;
  clock?: () => number;
}

export interface StrategyEvent {
  strategy: Strategy;
  type: "status" | "fill" | "error" | "low_balance" | "kill_switch" | "waiting";
  text: string;
}

interface Row {
  id: number;
  kind: StrategyKind;
  name: string;
  mint: string;
  config: string;
  status: StrategyStatus;
  budget_lamports: string;
  spent_lamports: string;
  received_lamports: string;
  runs: number;
  next_run_at: number | null;
  last_run_at: number | null;
  state: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const toStrategy = (r: Row): Strategy => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  mint: r.mint,
  config: JSON.parse(r.config),
  status: r.status,
  budgetLamports: r.budget_lamports,
  spentLamports: r.spent_lamports,
  receivedLamports: r.received_lamports,
  runs: r.runs,
  nextRunAt: r.next_run_at,
  lastRunAt: r.last_run_at,
  state: JSON.parse(r.state),
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const KILL_KEY = "kill_switch";
const MAX_FAILURES = 3;
const MIN_REACTION_LAMPORTS = 1_000_000n;
const LOW_BALANCE_REPEAT_MS = 3_600_000;

/**
 * In-process scheduler for the user's bots. Every order goes through an intent row with a unique key, so a
 * restart never repeats an order that may already have been sent. Budgets, a global per-minute action cap and
 * a kill switch bound what the bots can do; all orders run through TradeService (spend cap, simulation).
 */
export class StrategyEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private reactions: { strategyId: number; trade: TradeRow }[] = [];
  private actionTimes: number[] = [];
  private lockedNoticeSent = false;
  private lowBalanceAt = new Map<string, number>();
  private readonly clock: () => number;
  private readonly onTrade = (t: TradeRow) => this.queueReactions(t);

  constructor(private readonly deps: EngineDeps) {
    super();
    this.setMaxListeners(100);
    this.clock = deps.clock ?? Date.now;
  }

  get killSwitch(): boolean {
    return (this.deps.db.prepare("SELECT value FROM settings WHERE key = ?").get(KILL_KEY) as { value: string } | undefined)?.value === "1";
  }

  /** Recovers from a crash, then ticks every `tickMs`. */
  start(tickMs = 1_000): void {
    const interrupted = this.deps.db.prepare("SELECT DISTINCT strategy_id AS id FROM strategy_intents WHERE status = 'pending'").all() as { id: number }[];
    this.deps.db.prepare("UPDATE strategy_intents SET status = 'unknown', updated_at = ? WHERE status = 'pending'").run(isoNow());
    for (const { id } of interrupted) {
      const s = this.find(id);
      if (s?.status === "running") this.setStatus(s, "paused", "Interrupted while an order was in flight; check the activity log before resuming");
    }
    this.deps.feed.on("trade", this.onTrade);
    for (const s of this.list()) if (s.status === "running") void this.deps.watch(s.mint).catch(() => undefined);
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.feed.off("trade", this.onTrade);
  }

  list(): Strategy[] {
    return (this.deps.db.prepare("SELECT * FROM strategies WHERE network = ? ORDER BY id DESC").all(this.deps.network) as unknown as Row[]).map(toStrategy);
  }

  find(id: number): Strategy | null {
    const r = this.deps.db.prepare("SELECT * FROM strategies WHERE id = ? AND network = ?").get(id, this.deps.network) as Row | undefined;
    return r ? toStrategy(r) : null;
  }

  get(id: number): Strategy {
    const s = this.find(id);
    if (!s) throw new InputError(`Strategy ${id} not found`);
    return s;
  }

  intents(id: number, limit = 100): StrategyIntent[] {
    const rows = this.deps.db.prepare("SELECT * FROM strategy_intents WHERE strategy_id = ? ORDER BY id DESC LIMIT ?").all(id, limit) as unknown as {
      id: number;
      strategy_id: number;
      intent_key: string;
      side: "buy" | "sell";
      status: StrategyIntent["status"];
      detail: string | null;
      result: string | null;
      created_at: string;
      updated_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, strategyId: r.strategy_id, key: r.intent_key, side: r.side, status: r.status, detail: r.detail ? JSON.parse(r.detail) : null, result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async create(input: { name: string; mint: string; budgetSol: number; start?: boolean; kind: StrategyKind; config: unknown }): Promise<Strategy> {
    const { kind, config } = strategyInput.parse({ kind: input.kind, config: input.config });
    const mint = parsePubkey(input.mint, "mint").toBase58();
    const name = input.name.trim() || `${kind.toUpperCase()} ${mint.slice(0, 4)}`;
    for (const w of this.deps.wallets.getMany(config.walletIds)) {
      if (w.family !== "solana" || w.status !== "active") throw new InputError(`${w.label} is not an active Solana wallet`);
    }
    const budget = toLamports(String(input.budgetSol));
    if (spendsSol(kind, config) && budget <= 0n) throw new InputError("This strategy buys, so it needs a SOL budget above 0");
    if (kind === "snipe") {
      const info = await this.deps.market.tokenInfo(mint);
      const own = this.deps.wallets.ownAddresses();
      if (!this.deps.ownLaunches().has(mint) && !(info.curve && own.has(info.curve.creator))) {
        throw new InputError("Supply snipe only runs on your own launches (a launch from this terminal, or a coin one of your wallets created)");
      }
    }
    const t = isoNow();
    const r = this.deps.db
      .prepare("INSERT INTO strategies (network, kind, name, mint, config, status, budget_lamports, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'paused', ?, ?, ?)")
      .run(this.deps.network, kind, name, mint, JSON.stringify(config), budget.toString(), t, t);
    const s = this.get(Number(r.lastInsertRowid));
    this.deps.activity.record({ kind: "bot", status: "info", summary: `Bot "${s.name}" (${kind}) created with a ${sol(budget)} SOL budget`, token: mint });
    return input.start ? this.resume(s.id) : s;
  }

  async resume(id: number): Promise<Strategy> {
    const s = this.get(id);
    if (this.killSwitch) throw new InputError("The kill switch is on; turn it off before starting bots");
    if (s.status === "completed" || s.status === "stopped") throw new InputError(`Bot is ${s.status}; create a new one`);
    await this.deps.watch(s.mint).catch(() => undefined);
    this.deps.db.prepare("UPDATE strategies SET status = 'running', note = NULL, next_run_at = COALESCE(next_run_at, ?), state = ?, updated_at = ? WHERE id = ?").run(this.clock(), JSON.stringify({ ...s.state, failures: 0 }), isoNow(), id);
    const fresh = this.get(id);
    this.announce(fresh, "status", `Bot "${fresh.name}" started`);
    return fresh;
  }

  pause(id: number, note = "Paused by user"): Strategy {
    const s = this.get(id);
    if (s.status !== "running") return s;
    return this.setStatus(s, "paused", note);
  }

  stopStrategy(id: number): Strategy {
    const s = this.get(id);
    if (s.status === "completed" || s.status === "stopped") return s;
    return this.setStatus(s, "stopped", "Stopped by user");
  }

  remove(id: number): void {
    const s = this.get(id);
    if (s.status === "running") throw new InputError("Pause or stop the bot before deleting it");
    this.deps.db.prepare("DELETE FROM strategies WHERE id = ?").run(id);
  }

  /** On: every running bot pauses and none can start. Off: bots stay paused until started again. */
  setKillSwitch(on: boolean): { killSwitch: boolean; paused: number } {
    this.deps.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(KILL_KEY, on ? "1" : "0");
    let paused = 0;
    if (on) {
      for (const s of this.list()) {
        if (s.status !== "running") continue;
        this.setStatus(s, "paused", "Kill switch");
        paused++;
      }
      this.reactions = [];
    }
    this.deps.activity.record({ kind: "bot", status: "info", summary: on ? `Kill switch ON: ${paused} bot(s) paused` : "Kill switch off" });
    this.emit("event", { strategy: null, type: "kill_switch", text: on ? `Kill switch ON: ${paused} bot(s) paused` : "Kill switch off" });
    return { killSwitch: on, paused };
  }

  private setStatus(s: Strategy, status: StrategyStatus, note: string | null): Strategy {
    this.deps.db.prepare("UPDATE strategies SET status = ?, note = ?, updated_at = ? WHERE id = ?").run(status, note, isoNow(), s.id);
    const fresh = this.get(s.id);
    this.announce(fresh, "status", `Bot "${s.name}" ${status}${note ? `: ${note}` : ""}`);
    return fresh;
  }

  private setNote(s: Strategy, note: string): void {
    if (s.note === note) return;
    this.deps.db.prepare("UPDATE strategies SET note = ?, updated_at = ? WHERE id = ?").run(note, isoNow(), s.id);
    this.emit("event", { strategy: { ...s, note }, type: "waiting", text: note } satisfies StrategyEvent);
  }

  private patch(id: number, fields: Partial<{ runs: number; next_run_at: number | null; last_run_at: number; spent_lamports: string; received_lamports: string; state: string; note: string | null }>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.deps.db.prepare(`UPDATE strategies SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...(Object.values(fields) as (string | number | null)[]), isoNow(), id);
  }

  private announce(s: Strategy, type: StrategyEvent["type"], text: string): void {
    this.deps.activity.record({ kind: "bot", status: type === "error" ? "failed" : "info", summary: text, token: s.mint });
    this.emit("event", { strategy: s, type, text } satisfies StrategyEvent);
  }

  private exec(c: { slippageBps: number; priorityMicroLamports?: number; mode: "parallel" | "sequential" | "bundle" }): ExecParams {
    return { slippageBps: c.slippageBps, microLamports: c.priorityMicroLamports ?? this.deps.config.defaultPriorityMicroLamports, mode: c.mode, jitoTipLamports: this.deps.config.defaultJitoTipLamports, dryRun: false };
  }

  private rateLimited(): boolean {
    const cutoff = this.clock() - 60_000;
    this.actionTimes = this.actionTimes.filter((t) => t > cutoff);
    return this.actionTimes.length >= this.deps.config.botMaxActionsPerMinute;
  }

  /** Claims an intent key; false when an order with that key already ran (or may have). Failed intents can retry. */
  private claim(s: Strategy, key: string, side: "buy" | "sell", detail: unknown): boolean {
    const t = isoNow();
    const r = this.deps.db
      .prepare("INSERT INTO strategy_intents (strategy_id, intent_key, side, status, detail, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT (intent_key) DO NOTHING")
      .run(s.id, key, side, JSON.stringify(detail), t, t);
    if (r.changes) return true;
    const retry = this.deps.db.prepare("UPDATE strategy_intents SET status = 'pending', detail = ?, updated_at = ? WHERE intent_key = ? AND status = 'failed'").run(JSON.stringify(detail), t, key);
    return retry.changes > 0;
  }

  private intentStatus(key: string): { status: string; result: string | null } | undefined {
    return this.deps.db.prepare("SELECT status, result FROM strategy_intents WHERE intent_key = ?").get(key) as { status: string; result: string | null } | undefined;
  }

  private settle(key: string, status: "ok" | "failed", result: unknown): void {
    this.deps.db.prepare("UPDATE strategy_intents SET status = ?, result = ?, updated_at = ? WHERE intent_key = ?").run(status, JSON.stringify(result), isoNow(), key);
  }

  /**
   * Runs one order under an intent key. Returns the trade result, or null when the order was skipped
   * (rate cap, already done) or failed before anything was sent.
   */
  private async order(s: Strategy, key: string, side: "buy" | "sell", detail: unknown, run: (origin: TradeOrigin) => Promise<TradeResult>): Promise<TradeResult | null> {
    if (this.rateLimited()) {
      this.setNote(s, `Waiting: global bot cap of ${this.deps.config.botMaxActionsPerMinute} orders/minute reached`);
      return null;
    }
    if (!this.claim(s, key, side, detail)) return null;
    this.actionTimes.push(this.clock());
    const failures = s.state.failures ?? 0;
    try {
      const result = await run({ kind: "bot", prefix: `[${s.name}] ` });
      const confirmed = result.legs.filter((l) => result.txs.some((t) => t.status === "confirmed" && t.label.split(" + ").includes(`${side} ${l.label}`)));
      const lamports = confirmed.reduce((n, l) => n + BigInt(l.lamports), 0n);
      const fresh = this.get(s.id);
      const ok = confirmed.length > 0;
      this.settle(key, ok ? "ok" : "failed", { signatures: result.txs.map((t) => ({ label: t.label, signature: t.signature, status: t.status, error: t.error })), legs: result.legs, venue: result.venue });
      this.patch(s.id, {
        last_run_at: this.clock(),
        ...(side === "buy" ? { spent_lamports: (BigInt(fresh.spentLamports) + lamports).toString() } : { received_lamports: (BigInt(fresh.receivedLamports) + lamports).toString() }),
        state: JSON.stringify({ ...fresh.state, failures: ok ? 0 : failures + 1 }),
        note: null,
      });
      if (ok) {
        this.emit("event", { strategy: this.get(s.id), type: "fill", text: `[${s.name}] ${side} ${confirmed.length} wallet(s), ${sol(lamports)} SOL` } satisfies StrategyEvent);
        if (side === "buy") void this.checkLowBalances(s, confirmed.map((l) => l.address));
      } else {
        this.failed(this.get(s.id), result.txs.find((t) => t.error)?.error ?? "No transaction confirmed");
      }
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.settle(key, "failed", { error: message });
      const fresh = this.get(s.id);
      this.patch(s.id, { state: JSON.stringify({ ...fresh.state, failures: failures + 1 }) });
      this.failed(this.get(s.id), message);
      return null;
    }
  }

  private failed(s: Strategy, message: string): void {
    const failures = s.state.failures ?? 0;
    this.emit("event", { strategy: s, type: "error", text: `[${s.name}] order failed: ${message}` } satisfies StrategyEvent);
    if (failures >= MAX_FAILURES) this.setStatus(s, "failed", `${failures} failures in a row; last: ${message}`);
  }

  private async checkLowBalances(s: Strategy, addresses: string[]): Promise<void> {
    const floor = toLamports(String(this.deps.config.lowBalanceSol));
    const balances = await this.deps.market.nativeBalances(addresses).catch(() => ({}) as Record<string, string>);
    const low = addresses.filter((a) => balances[a] !== undefined && BigInt(balances[a]!) < floor && (!this.lowBalanceAt.has(a) || this.clock() - this.lowBalanceAt.get(a)! > LOW_BALANCE_REPEAT_MS));
    if (!low.length) return;
    for (const a of low) this.lowBalanceAt.set(a, this.clock());
    const labels = low.map((a) => this.deps.wallets.findByAddress(a)?.label ?? a.slice(0, 6));
    this.emit("event", { strategy: s, type: "low_balance", text: `[${s.name}] low SOL (< ${this.deps.config.lowBalanceSol}) in ${labels.join(", ")}` } satisfies StrategyEvent);
  }

  private remainingBudget(s: Strategy): bigint {
    return BigInt(s.budgetLamports) - BigInt(s.spentLamports);
  }

  /** One scheduler pass; exported for tests. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.killSwitch) return;
      const running = this.list().filter((s) => s.status === "running");
      if (!running.length) {
        this.reactions = [];
        return;
      }
      if (!this.deps.vault.unlocked) {
        for (const s of running) this.setNote(s, "Waiting: the vault is locked (enable keep-unlocked for 24/7 bots)");
        if (!this.lockedNoticeSent) {
          this.lockedNoticeSent = true;
          this.emit("event", { strategy: running[0]!, type: "waiting", text: `${running.length} bot(s) waiting: the vault is locked` } satisfies StrategyEvent);
        }
        return;
      }
      this.lockedNoticeSent = false;
      while (this.reactions.length) {
        const r = this.reactions.shift()!;
        const s = this.find(r.strategyId);
        if (s?.status === "running") await this.react(s, r.trade);
      }
      for (const s of running) {
        const fresh = this.find(s.id);
        if (fresh?.status !== "running") continue;
        if (fresh.nextRunAt !== null && this.clock() < fresh.nextRunAt) continue;
        if (fresh.kind === "dca") await this.stepDca(fresh, fresh.config as DcaConfig);
        else if (fresh.kind === "limit") await this.stepLimit(fresh, fresh.config as LimitConfig);
        else if (fresh.kind === "snipe") await this.stepSnipe(fresh, fresh.config as SnipeConfig);
      }
    } catch (err) {
      this.emit("error", err);
    } finally {
      this.busy = false;
    }
  }

  private async stepDca(s: Strategy, c: DcaConfig): Promise<void> {
    if (s.runs >= c.runs) {
      this.setStatus(s, "completed", `All ${c.runs} runs done`);
      return;
    }
    const n = s.runs + 1;
    const key = `dca:${s.id}:${n}`;
    let result: TradeResult | null;
    if (c.side === "buy") {
      const lamports = toLamports(String(c.solPerWallet));
      const total = lamports * BigInt(c.walletIds.length);
      if (total > this.remainingBudget(s)) {
        this.setStatus(s, "completed", `Budget used up (${sol(BigInt(s.spentLamports))} of ${sol(BigInt(s.budgetLamports))} SOL)`);
        return;
      }
      result = await this.order(s, key, "buy", { run: n, lamports: lamports.toString() }, (origin) => this.deps.trade.buyLegs({ mint: s.mint, legs: c.walletIds.map((walletId) => ({ walletId, lamports })), ...this.exec(c) }, origin));
    } else {
      result = await this.order(s, key, "sell", { run: n, percent: c.percentPerRun }, (origin) => this.deps.trade.sell({ mint: s.mint, walletIds: c.walletIds, percent: c.percentPerRun!, ...this.exec(c) }, origin));
      if (!result && this.intentStatus(key)?.result?.includes("None of the selected wallets hold")) {
        this.setStatus(this.get(s.id), "completed", "Nothing left to sell");
        return;
      }
    }
    const fresh = this.get(s.id);
    const settled = this.intentStatus(key)?.status;
    // "unknown" means a restart interrupted this run after it may have been sent: count it rather than risk a repeat.
    if (settled === "ok" || settled === "unknown") {
      this.patch(s.id, { runs: n, next_run_at: this.clock() + c.intervalSec * 1_000 });
      if (n >= c.runs) this.setStatus(this.get(s.id), "completed", `All ${c.runs} runs done`);
    } else if (fresh.status === "running" && !result) {
      this.patch(s.id, { next_run_at: this.clock() + Math.min(c.intervalSec, 30) * 1_000 });
    }
  }

  private metricOf(info: TokenInfo, metric: "marketCapSol" | "priceSol"): number | null {
    if (!info.market) return null;
    if (metric === "marketCapSol") return Number(info.market.marketCapLamports) / 1e9;
    return (info.market.priceLamportsPerToken * 10 ** info.decimals) / 1e9;
  }

  private async stepLimit(s: Strategy, c: LimitConfig): Promise<void> {
    if (c.expiresAt && this.clock() > c.expiresAt) {
      this.setStatus(s, "completed", "Expired without triggering");
      return;
    }
    this.patch(s.id, { next_run_at: this.clock() + c.checkSec * 1_000 });
    const info = await this.deps.market.tokenInfo(s.mint);
    const value = this.metricOf(info, c.trigger.metric);
    if (value === null) {
      this.setNote(s, `Waiting: ${info.venueNote}`);
      return;
    }
    const hit = c.trigger.op === "gte" ? value >= c.trigger.value : value <= c.trigger.value;
    if (!hit) {
      this.setNote(s, `Watching: ${c.trigger.metric === "marketCapSol" ? "market cap" : "price"} ${value.toPrecision(6)} SOL, trigger ${c.trigger.op === "gte" ? "≥" : "≤"} ${c.trigger.value}`);
      return;
    }
    const key = `limit:${s.id}`;
    if (c.side === "buy") {
      const lamports = toLamports(String(c.solPerWallet));
      const total = lamports * BigInt(c.walletIds.length);
      if (total > this.remainingBudget(s)) {
        this.setStatus(s, "failed", `Triggered, but the order (${sol(total)} SOL) exceeds the remaining budget`);
        return;
      }
      await this.order(s, key, "buy", { trigger: value }, (origin) => this.deps.trade.buyLegs({ mint: s.mint, legs: c.walletIds.map((walletId) => ({ walletId, lamports })), info, ...this.exec(c) }, origin));
    } else {
      await this.order(s, key, "sell", { trigger: value }, (origin) => this.deps.trade.sell({ mint: s.mint, walletIds: c.walletIds, percent: c.percent!, ...this.exec(c) }, origin));
    }
    if (this.intentStatus(key)?.status === "unknown") {
      this.setStatus(this.get(s.id), "completed", "An order may have been sent before a restart; check the activity log");
      return;
    }
    if (this.intentStatus(key)?.status === "ok") {
      this.patch(s.id, { runs: 1 });
      this.setStatus(this.get(s.id), "completed", `Filled when ${c.trigger.metric === "marketCapSol" ? "market cap" : "price"} was ${value.toPrecision(6)} SOL`);
    }
  }

  private async stepSnipe(s: Strategy, c: SnipeConfig): Promise<void> {
    this.patch(s.id, { next_run_at: this.clock() + c.intervalSec * 1_000 });
    const info = await this.deps.market.tokenInfo(s.mint);
    if (!info.market) {
      this.setNote(s, `Waiting: ${info.venueNote}`);
      return;
    }
    const own = [...this.deps.wallets.ownAddresses()];
    const balances = await this.deps.market.tokenBalances(parsePubkey(s.mint), own, parsePubkey(info.tokenProgram));
    const held = Object.values(balances).reduce((n, v) => n + BigInt(v), 0n);
    const supply = BigInt(info.supply);
    const sharePct = supply > 0n ? Number((held * 1_000_000n) / supply) / 10_000 : 0;
    const mcSol = Number(info.market.marketCapLamports) / 1e9;
    if (sharePct >= c.targetSupplyPct) {
      this.setStatus(s, "completed", `Target reached: own wallets hold ${sharePct.toFixed(2)}% of supply`);
      return;
    }
    if (mcSol >= c.maxMarketCapSol) {
      this.setStatus(s, "completed", `Max market cap reached (${mcSol.toFixed(2)} SOL) at ${sharePct.toFixed(2)}% own supply`);
      return;
    }
    const lamports = toLamports(String(c.solPerBuy));
    if (lamports > this.remainingBudget(s)) {
      this.setStatus(s, "completed", `Budget used up at ${sharePct.toFixed(2)}% own supply`);
      return;
    }
    const round = (s.state.round ?? 0) + 1;
    const cursor = s.state.cursor ?? 0;
    const walletId = c.walletIds[cursor % c.walletIds.length]!;
    const key = `snipe:${s.id}:${round}`;
    const result = await this.order(s, key, "buy", { round, walletId, sharePct, mcSol }, (origin) => this.deps.trade.buyLegs({ mint: s.mint, legs: [{ walletId, lamports }], info, ...this.exec(c) }, origin));
    const fresh = this.get(s.id);
    if (result || this.intentStatus(key)?.status === "unknown") this.patch(s.id, { runs: fresh.runs + 1, state: JSON.stringify({ ...fresh.state, round, cursor: cursor + 1 }) });
    else this.patch(s.id, { state: JSON.stringify({ ...fresh.state, cursor: cursor + 1 }) });
  }

  private queueReactions(t: TradeRow): void {
    if (this.killSwitch) return;
    const own = this.deps.wallets.ownAddresses();
    if (own.has(t.trader)) return;
    for (const s of this.list()) {
      if (s.kind !== "counter" || s.status !== "running" || s.mint !== t.mint) continue;
      const c = s.config as CounterConfig;
      const wants = c.reactTo === "both" || (c.reactTo === "buys" && t.side === "buy") || (c.reactTo === "sells" && t.side === "sell");
      if (wants && BigInt(t.solLamports) >= toLamports(String(c.minTradeSol))) this.reactions.push({ strategyId: s.id, trade: t });
    }
  }

  /** Answers one outside trade: outside buys with a sell of the same SOL share, outside sells with a buy. */
  private async react(s: Strategy, t: TradeRow): Promise<void> {
    const c = s.config as CounterConfig;
    if (s.lastRunAt && this.clock() - s.lastRunAt < c.cooldownSec * 1_000) {
      this.setNote(s, `Cooldown: skipped a ${sol(BigInt(t.solLamports))} SOL outside ${t.side}`);
      return;
    }
    const key = `counter:${s.id}:${t.signature}:${t.seq}`;
    const cap = toLamports(String(c.maxPerReactionSol));
    let lamports = (BigInt(t.solLamports) * BigInt(Math.round(c.sharePct * 100))) / 10_000n;
    if (lamports > cap) lamports = cap;
    const wallets = this.deps.wallets.getMany(c.walletIds);
    const origin = { trigger: t.signature, outsideSide: t.side, outsideLamports: t.solLamports };
    if (t.side === "sell") {
      const left = this.remainingBudget(s);
      if (lamports > left) lamports = left;
      if (lamports < MIN_REACTION_LAMPORTS) {
        if (left < MIN_REACTION_LAMPORTS) this.setStatus(s, "completed", "Budget used up");
        return;
      }
      const balances = await this.deps.market.nativeBalances(wallets.map((w) => w.address));
      const richest = [...wallets].sort((a, b) => (BigInt(balances[b.address]!) > BigInt(balances[a.address]!) ? 1 : -1))[0]!;
      await this.order(s, key, "buy", { ...origin, walletId: richest.id, lamports: lamports.toString() }, (o) => this.deps.trade.buyLegs({ mint: s.mint, legs: [{ walletId: richest.id, lamports }], ...this.exec(c) }, o));
      return;
    }
    if (!(t.price > 0)) return;
    const info = await this.deps.market.tokenInfo(s.mint);
    const floor = BigInt(Math.floor(c.minTokensPerWallet * 10 ** info.decimals));
    const balances = await this.deps.market.tokenBalances(parsePubkey(s.mint), wallets.map((w) => w.address), parsePubkey(info.tokenProgram));
    const avail = wallets.map((w) => ({ w, free: BigInt(balances[w.address] ?? "0") - floor })).filter((x) => x.free > 0n).sort((a, b) => (b.free > a.free ? 1 : -1));
    if (!avail.length) {
      this.setNote(s, "Waiting: no wallet holds tokens above the inventory floor");
      return;
    }
    const wanted = BigInt(Math.floor(Number(lamports) / t.price));
    const pick = avail[0]!;
    const tokens = wanted < pick.free ? wanted : pick.free;
    if (tokens <= 0n) return;
    await this.order(s, key, "sell", { ...origin, walletId: pick.w.id, tokens: tokens.toString() }, (o) => this.deps.trade.sellLegs({ mint: s.mint, legs: [{ walletId: pick.w.id, tokens }], info, ...this.exec(c) }, o));
  }
}

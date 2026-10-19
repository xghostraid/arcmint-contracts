import type { ActivityEntry, ActivityLog } from "../activity.js";
import type { Db } from "../db.js";
import type { StrategyEngine, StrategyEvent } from "../strategies/engine.js";
import type { FetchLike } from "../chains/solana/jito.js";

export type AlertCategory = "fills" | "failures" | "lowBalance" | "botStatus" | "launches";
export type AlertPrefs = Record<AlertCategory, boolean>;

const DEFAULT_PREFS: AlertPrefs = { fills: true, failures: true, lowBalance: true, botStatus: true, launches: true };
const PREFS_KEY = "alerts";
const MAX_QUEUE = 50;

/** Outbound-only Telegram Bot API alerts. Messages are queued and sent about one per second. */
export class TelegramNotifier {
  private queue: string[] = [];
  private sending = false;
  private dropped = 0;
  lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly opts: { botToken?: string; chatId?: string; network: string; explorerTx: (sig: string) => string; intervalMs?: number },
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {}

  get enabled(): boolean {
    return Boolean(this.opts.botToken && this.opts.chatId);
  }

  get prefs(): AlertPrefs {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(PREFS_KEY) as { value: string } | undefined;
    return { ...DEFAULT_PREFS, ...(row ? (JSON.parse(row.value) as Partial<AlertPrefs>) : {}) };
  }

  setPrefs(patch: Partial<AlertPrefs>): AlertPrefs {
    const next = { ...this.prefs, ...patch };
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(PREFS_KEY, JSON.stringify(next));
    return next;
  }

  status() {
    return { enabled: this.enabled, chatId: this.opts.chatId ? `…${this.opts.chatId.slice(-4)}` : null, prefs: this.prefs, queued: this.queue.length, dropped: this.dropped, lastError: this.lastError };
  }

  /** Hooks into the activity log and the bot engine. */
  attach(activity: ActivityLog, engine: StrategyEngine): void {
    activity.on("entry", (e: ActivityEntry) => this.onActivity(e));
    engine.on("event", (e: StrategyEvent) => this.onStrategy(e));
  }

  private onActivity(e: ActivityEntry): void {
    const p = this.prefs;
    if (e.kind === "launch" && e.status === "ok" && p.launches) this.send(`Launch: ${e.summary}${e.signature ? `\n${this.opts.explorerTx(e.signature)}` : ""}`);
    else if (e.kind === "bot" && e.status === "ok" && e.signature && p.fills) this.send(`Fill: ${e.summary}\n${this.opts.explorerTx(e.signature)}`);
    else if (e.status === "failed" && ["buy", "sell", "launch", "bot", "distribute", "sweep"].includes(e.kind) && p.failures) {
      const detail = (e.detail as { error?: string } | null)?.error;
      this.send(`Failed: ${e.summary}${detail ? `\n${detail.slice(0, 300)}` : ""}`);
    }
  }

  private onStrategy(e: StrategyEvent): void {
    const p = this.prefs;
    if ((e.type === "status" || e.type === "kill_switch" || e.type === "waiting") && p.botStatus) {
      if (e.type === "waiting" && !e.text.includes("vault is locked")) return;
      this.send(e.text);
    } else if (e.type === "low_balance" && p.lowBalance) this.send(e.text);
  }

  send(text: string): void {
    if (!this.enabled) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      return;
    }
    this.queue.push(`[${this.opts.network}] ${text}`);
    void this.drain();
  }

  /** Sends one message right away and reports the Bot API's answer. */
  async test(): Promise<{ ok: boolean; error?: string }> {
    if (!this.enabled) return { ok: false, error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable alerts" };
    return this.post(`[${this.opts.network}] Test alert from your trading terminal`);
  }

  private async post(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.fetchFn(`https://api.telegram.org/bot${this.opts.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.opts.chatId, text, disable_web_page_preview: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!res.ok || !body.ok) {
        this.lastError = body.description ?? `HTTP ${res.status}`;
        return { ok: false, error: this.lastError };
      }
      this.lastError = null;
      return { ok: true };
    } catch (err) {
      this.lastError = (err as Error).message;
      return { ok: false, error: this.lastError };
    }
  }

  private async drain(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        await this.post(this.queue.shift()!);
        if (this.queue.length) await new Promise((r) => setTimeout(r, this.opts.intervalMs ?? 1_100));
      }
    } finally {
      this.sending = false;
    }
  }

  /** Resolves once the queue is empty (tests). */
  async flush(): Promise<void> {
    while (this.queue.length || this.sending) await new Promise((r) => setTimeout(r, 5));
  }
}

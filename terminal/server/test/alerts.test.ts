import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openDb } from "../src/db.js";
import { ActivityLog } from "../src/activity.js";
import { TelegramNotifier } from "../src/notify/telegram.js";
import type { StrategyEngine } from "../src/strategies/engine.js";
import type { FetchLike } from "../src/chains/solana/jito.js";

function rig(opts: { botToken?: string; chatId?: string; reply?: (n: number) => { status: number; body: unknown } } = {}) {
  const db = openDb(":memory:");
  const activity = new ActivityLog(db, "solana");
  const engine = new EventEmitter() as unknown as StrategyEngine;
  const sent: { url: string; body: { chat_id: string; text: string } }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = opts.reply?.(sent.length) ?? { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(r.body), { status: r.status }) as unknown as Awaited<ReturnType<FetchLike>>;
  };
  const notifier = new TelegramNotifier(
    db,
    { botToken: "botToken" in opts ? opts.botToken : "123:abc", chatId: "chatId" in opts ? opts.chatId : "987654", network: "local", explorerTx: (s) => `https://explorer/tx/${s}`, intervalMs: 1 },
    fetchFn,
  );
  notifier.attach(activity, engine);
  return { db, activity, engine, notifier, sent };
}

test("alerts: disabled without token/chat, sends nothing", async () => {
  const { activity, notifier, sent } = rig({ botToken: undefined });
  assert.equal(notifier.enabled, false);
  activity.record({ kind: "launch", status: "ok", summary: "Launched X", signature: "sig1" });
  await notifier.flush();
  assert.equal(sent.length, 0);
  assert.match((await notifier.test()).error ?? "", /TELEGRAM_BOT_TOKEN/);
});

test("alerts: routes activity and bot events by category and respects prefs", async () => {
  const { activity, engine, notifier, sent } = rig();
  activity.record({ kind: "launch", status: "ok", summary: "Launched DEMO", signature: "sigL" });
  activity.record({ kind: "bot", status: "ok", summary: "DCA buy 0.1 SOL", signature: "sigB" });
  activity.record({ kind: "buy", status: "failed", summary: "Buy failed", detail: { error: "slippage exceeded" } });
  activity.record({ kind: "wallet", status: "info", summary: "Generated 3 wallet(s)" });
  engine.emit("event", { strategy: null, type: "kill_switch", text: "Kill switch ON: 2 bot(s) paused" });
  engine.emit("event", { strategy: null, type: "waiting", text: "Waiting: next run in 30s" });
  engine.emit("event", { strategy: null, type: "waiting", text: "Bot is waiting: vault is locked" });
  engine.emit("event", { strategy: null, type: "low_balance", text: "Wallet 3 is low on SOL" });
  await notifier.flush();
  const texts = sent.map((s) => s.body.text);
  assert.deepEqual(texts, [
    "[local] Launch: Launched DEMO\nhttps://explorer/tx/sigL",
    "[local] Fill: DCA buy 0.1 SOL\nhttps://explorer/tx/sigB",
    "[local] Failed: Buy failed\nslippage exceeded",
    "[local] Kill switch ON: 2 bot(s) paused",
    "[local] Bot is waiting: vault is locked",
    "[local] Wallet 3 is low on SOL",
  ]);
  assert.ok(sent.every((s) => s.url === "https://api.telegram.org/bot123:abc/sendMessage" && s.body.chat_id === "987654"));

  sent.length = 0;
  notifier.setPrefs({ fills: false, lowBalance: false });
  assert.equal(notifier.prefs.fills, false);
  assert.equal(notifier.prefs.launches, true);
  activity.record({ kind: "bot", status: "ok", summary: "DCA buy", signature: "sigC" });
  engine.emit("event", { strategy: null, type: "low_balance", text: "low" });
  activity.record({ kind: "launch", status: "ok", summary: "Launched B" });
  await notifier.flush();
  assert.deepEqual(sent.map((s) => s.body.text), ["[local] Launch: Launched B"]);
});

test("alerts: Bot API errors are surfaced, chat id is masked in status", async () => {
  const { notifier } = rig({ reply: () => ({ status: 400, body: { ok: false, description: "Bad Request: chat not found" } }) });
  const r = await notifier.test();
  assert.equal(r.ok, false);
  assert.equal(r.error, "Bad Request: chat not found");
  const st = notifier.status();
  assert.equal(st.chatId, "…7654");
  assert.equal(st.lastError, "Bad Request: chat not found");
  assert.equal(JSON.stringify(st).includes("123:abc"), false, "token never in status");
});

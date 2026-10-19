import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { LAMPORTS_PER_SOL, type Connection } from "@solana/web3.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { openDb, type Db } from "./db.js";
import { Vault, VaultError } from "./vault.js";
import { WalletError, WalletStore } from "./wallets.js";
import { ImportError } from "./chains/families.js";
import { CHAINS } from "./chains/registry.js";
import { InputError, SolanaAdapter, parsePubkey } from "./chains/solana/adapter.js";
import { ActivityLog } from "./activity.js";
import { TradeService } from "./services/trade.js";
import { TreasuryService } from "./services/treasury.js";
import { LaunchService, MAX_BUNDLE_WALLETS } from "./services/launch.js";
import { DashboardService } from "./services/dashboard.js";
import { TokenRegistry } from "./market/tokens.js";
import { TradeStore, type TradeRow } from "./market/trades.js";
import { Ingestor } from "./market/ingest.js";
import { StrategyEngine, type StrategyEvent } from "./strategies/engine.js";
import { TelegramNotifier } from "./notify/telegram.js";
import { toLamports } from "./util/amount.js";
import type { KdfParams } from "./crypto/envelope.js";

export interface AppDeps {
  config: Config;
  db?: Db;
  connection?: Connection;
  /** Tests use cheap scrypt parameters. */
  kdf?: Omit<KdfParams, "salt">;
  fetch?: import("./chains/solana/jito.js").FetchLike;
}

export interface Terminal {
  app: FastifyInstance;
  vault: Vault;
  wallets: WalletStore;
  activity: ActivityLog;
  solana: SolanaAdapter;
  tokens: TokenRegistry;
  ingestor: Ingestor;
  engine: StrategyEngine;
  notifier: TelegramNotifier;
  /** Starts trade ingestion and the bot scheduler (not started by tests unless asked). */
  startBackground(opts?: { tickMs?: number }): void;
  close(): Promise<void>;
}

const solAmount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toLamports(v);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});
const id = z.number().int().positive();
const ids = z.array(id).min(1);
const execFields = {
  slippageBps: z.number().int().min(0).max(5_000).default(500),
  priorityMicroLamports: z.number().int().min(0).max(50_000_000).optional(),
  mode: z.enum(["parallel", "sequential", "bundle"]).default("parallel"),
  jitoTipSol: solAmount.optional(),
  dryRun: z.boolean().default(false),
};

const PUBLIC = new Set(["/api/status", "/api/vault/init", "/api/vault/unlock"]);

export async function buildTerminal(deps: AppDeps): Promise<Terminal> {
  const { config } = deps;
  const db = deps.db ?? openDb(path.join(config.dataDir, "terminal.sqlite"));
  const vault = new Vault(db, { autoLockMinutes: config.autoLockMinutes, kdf: deps.kdf });
  const wallets = new WalletStore(db, vault);
  const solana = new SolanaAdapter(config, deps.connection);
  const activity = new ActivityLog(db, solana.chain.id);
  const trade = new TradeService(config, solana, wallets, activity);
  const treasury = new TreasuryService(config, solana, wallets, activity);
  const launch = new LaunchService(config, db, solana, wallets, vault, activity);
  const tokens = new TokenRegistry(db, config.network, solana);
  const tradeStore = new TradeStore(db, config.network);
  const ingestor = new Ingestor(solana.conn, tokens, tradeStore, { pollMs: config.ingestPollSeconds * 1_000, backfill: config.ingestBackfill, websocket: config.ingestWebsocket });
  const dashboard = new DashboardService(solana, wallets, tokens, tradeStore);
  const watch = async (mint: string) => {
    if (!tokens.get(mint)?.tracked) await tokens.track(mint);
    ingestor.watch(mint);
  };
  const engine = new StrategyEngine({
    db,
    config,
    network: config.network,
    wallets,
    vault,
    activity,
    trade,
    market: solana,
    feed: ingestor,
    watch,
    ownLaunches: () => launch.ownMints(),
  });
  const notifier = new TelegramNotifier(db, { botToken: config.telegramBotToken, chatId: config.telegramChatId, network: config.network, explorerTx: (sig) => solana.chain.explorerTx(sig) }, deps.fetch);
  notifier.attach(activity, engine);
  engine.on("error", (err: Error) => app.log.error(err));

  const sessions = new Set<string>();
  vault.on("locked", () => sessions.clear());
  const newSession = () => {
    const token = randomBytes(32).toString("base64url");
    sessions.add(token);
    return token;
  };

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.body.passphrase"] }, bodyLimit: 8 * 1024 * 1024 });

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0]!;
    if (!url.startsWith("/api/") || PUBLIC.has(url)) return;
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : (req.query as { token?: string }).token;
    if (!token || !sessions.has(token)) {
      return reply.code(401).send({ error: vault.unlocked ? "Session expired; unlock again" : "Vault is locked", code: "unauthorized" });
    }
    vault.touch();
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), code: "invalid" });
    if (err instanceof VaultError) {
      const status = err.code === "bad_passphrase" ? 401 : err.code === "locked" ? 423 : 400;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    if (err instanceof InputError || err instanceof WalletError || err instanceof ImportError) return reply.code(400).send({ error: err.message, code: "invalid" });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: "invalid" });
    app.log.error(err);
    return reply.code(500).send({ error: err.message || "Internal error", code: "internal" });
  });

  const exec = (b: { slippageBps: number; priorityMicroLamports?: number; mode: "parallel" | "sequential" | "bundle"; jitoTipSol?: bigint; dryRun: boolean }) => ({
    slippageBps: b.slippageBps,
    microLamports: b.priorityMicroLamports ?? config.defaultPriorityMicroLamports,
    mode: b.mode,
    jitoTipLamports: Number(b.jitoTipSol ?? BigInt(config.defaultJitoTipLamports)),
    dryRun: b.dryRun,
  });

  app.get("/api/status", async () => ({
    network: config.network,
    chain: solana.chain.id,
    chainName: solana.chain.name,
    rpcUrl: config.rpcUrl.replace(/api[-_]?key=[^&]+/i, "api-key=***"),
    vault: { initialized: vault.initialized, unlocked: vault.unlocked, keepUnlocked: vault.keepUnlocked },
    bundles: solana.executor.bundlesAvailable,
    maxSolPerAction: config.maxSolPerAction,
    killSwitch: engine.killSwitch,
    botsRunning: engine.list().filter((s) => s.status === "running").length,
    alerts: notifier.enabled,
    defaults: { priorityMicroLamports: config.defaultPriorityMicroLamports, jitoTipLamports: config.defaultJitoTipLamports },
  }));

  app.post("/api/vault/init", async (req) => {
    const b = z.object({ passphrase: z.string(), mnemonic: z.string().optional() }).parse(req.body);
    await vault.init(b.passphrase, b.mnemonic);
    activity.record({ kind: "vault", status: "info", summary: b.mnemonic ? "Vault restored from recovery phrase" : "Vault created" });
    return { token: newSession() };
  });

  app.post("/api/vault/unlock", async (req) => {
    const b = z.object({ passphrase: z.string() }).parse(req.body);
    await vault.unlock(b.passphrase);
    return { token: newSession() };
  });

  app.post("/api/vault/lock", async () => {
    vault.lock();
    return { ok: true };
  });

  app.post("/api/vault/passphrase", async (req) => {
    const b = z.object({ current: z.string(), next: z.string() }).parse(req.body);
    await vault.changePassphrase(b.current, b.next);
    activity.record({ kind: "vault", status: "info", summary: "Passphrase changed" });
    return { ok: true };
  });

  app.post("/api/vault/mnemonic", async (req) => {
    const b = z.object({ passphrase: z.string() }).parse(req.body);
    await vault.verify(b.passphrase);
    activity.record({ kind: "export", status: "info", summary: "Recovery phrase revealed" });
    return { mnemonic: vault.mnemonic() };
  });

  app.post("/api/vault/keep-unlocked", async (req) => {
    vault.keepUnlocked = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
    return { keepUnlocked: vault.keepUnlocked };
  });

  app.get("/api/chains", async () => Object.values(CHAINS).map(({ id, family, name, nativeSymbol, status, bundles }) => ({ id, family, name, nativeSymbol, status, bundles })));

  app.get("/api/groups", async () => wallets.listGroups());
  app.post("/api/groups", async (req) => wallets.createGroup(z.object({ name: z.string() }).parse(req.body).name));
  app.patch("/api/groups/:id", async (req) => {
    wallets.renameGroup(Number((req.params as { id: string }).id), z.object({ name: z.string().min(1) }).parse(req.body).name);
    return { ok: true };
  });
  app.delete("/api/groups/:id", async (req) => {
    wallets.deleteGroup(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.get("/api/wallets", async (req) => wallets.list({ includeArchived: (req.query as { archived?: string }).archived === "1" }));

  app.post("/api/wallets/generate", async (req) => {
    const b = z.object({ count: z.number().int().min(1).max(500), groupId: id.nullable().optional(), labelPrefix: z.string().max(40).optional() }).parse(req.body);
    const created = wallets.generate(b);
    activity.record({ kind: "wallet", status: "info", summary: `Generated ${created.length} wallet(s)` });
    return created;
  });

  app.post("/api/wallets/import", async (req) => {
    const b = z.object({ text: z.string().min(1), groupId: id.nullable().optional(), labelPrefix: z.string().max(40).optional(), mnemonicAccounts: z.number().int().min(1).max(100).optional() }).parse(req.body);
    const r = wallets.import(b);
    activity.record({ kind: "wallet", status: "info", summary: `Imported ${r.created.length} wallet(s)${r.skipped.length ? `, ${r.skipped.length} already present` : ""}` });
    return r;
  });

  app.post("/api/wallets/update", async (req) => {
    const b = z.object({ ids, label: z.string().max(60).optional(), groupId: id.nullable().optional(), status: z.enum(["active", "archived"]).optional() }).parse(req.body);
    wallets.update(b.ids, b);
    return { ok: true };
  });

  app.post("/api/wallets/export", async (req) => {
    const b = z.object({ ids, passphrase: z.string() }).parse(req.body);
    await vault.verify(b.passphrase);
    const out = wallets.exportSecrets(b.ids);
    activity.record({ kind: "export", status: "info", summary: `Exported ${out.length} private key(s)`, detail: { addresses: out.map((o) => o.address) } });
    return out;
  });

  app.post("/api/balances", async (req) => {
    const b = z.object({ walletIds: z.array(id).optional(), mint: z.string().optional() }).parse(req.body);
    const ws = b.walletIds ? wallets.getMany(b.walletIds) : wallets.list({ family: "solana" });
    const addresses = ws.filter((w) => w.family === "solana").map((w) => w.address);
    const native = await solana.nativeBalances(addresses);
    if (!b.mint) return { native };
    const mint = parsePubkey(b.mint, "mint");
    return { native, token: await solana.tokenBalances(mint, addresses) };
  });

  app.get("/api/tokens/:mint", async (req) => {
    const info = await solana.tokenInfo((req.params as { mint: string }).mint);
    const own = wallets.ownAddresses();
    return { ...info, creatorIsOwn: info.curve ? own.has(info.curve.creator) : false };
  });

  app.post("/api/trade/buy", async (req) => {
    const b = z.object({ mint: z.string(), walletIds: ids, solPerWallet: solAmount, ...execFields }).parse(req.body);
    return trade.buy({ mint: b.mint, walletIds: b.walletIds, lamportsPerWallet: b.solPerWallet, ...exec(b) });
  });

  app.post("/api/trade/sell", async (req) => {
    const b = z.object({ mint: z.string(), walletIds: ids, percent: z.number().gt(0).max(100), ...execFields }).parse(req.body);
    return trade.sell({ mint: b.mint, walletIds: b.walletIds, percent: b.percent, ...exec(b) });
  });

  app.post("/api/treasury/distribute", async (req) => {
    const b = z.object({ fromWalletId: id, toWalletIds: ids, solEach: solAmount, priorityMicroLamports: z.number().int().min(0).optional(), dryRun: z.boolean().default(false) }).parse(req.body);
    return treasury.distribute({ fromWalletId: b.fromWalletId, toWalletIds: b.toWalletIds, lamportsEach: b.solEach, microLamports: b.priorityMicroLamports ?? config.defaultPriorityMicroLamports, dryRun: b.dryRun });
  });

  app.post("/api/treasury/sweep", async (req) => {
    const b = z
      .object({ fromWalletIds: ids, toWalletId: id.optional(), toAddress: z.string().optional(), reserveSol: solAmount.default(0n), solEach: solAmount.optional(), priorityMicroLamports: z.number().int().min(0).optional(), dryRun: z.boolean().default(false) })
      .parse(req.body);
    return treasury.sweep({ fromWalletIds: b.fromWalletIds, toWalletId: b.toWalletId, toAddress: b.toAddress, reserveLamports: b.reserveSol, lamportsEach: b.solEach, microLamports: b.priorityMicroLamports ?? config.defaultPriorityMicroLamports, dryRun: b.dryRun });
  });

  app.post("/api/launch/metadata", async (req) => {
    const b = z
      .object({ name: z.string().min(1).max(32), symbol: z.string().min(1).max(10), description: z.string().max(1000).default(""), image: z.object({ base64: z.string().min(1), type: z.string(), filename: z.string() }), twitter: z.string().optional(), telegram: z.string().optional(), website: z.string().optional() })
      .parse(req.body);
    return { uri: await launch.uploadMetadata(b) };
  });

  app.post("/api/launch", async (req) => {
    const b = z
      .object({
        name: z.string(),
        symbol: z.string(),
        uri: z.string(),
        devWalletId: id,
        devBuySol: solAmount.default(0n),
        buyers: z.array(z.object({ walletId: id, sol: solAmount })).max(MAX_BUNDLE_WALLETS).default([]),
        lookupTable: z.enum(["auto", "on", "off"]).default("auto"),
        ...execFields,
        mode: z.enum(["sequential", "bundle"]).default("bundle"),
      })
      .parse(req.body);
    const result = await launch.run({ name: b.name, symbol: b.symbol, uri: b.uri, devWalletId: b.devWalletId, devBuyLamports: b.devBuySol, buyers: b.buyers.map((x) => ({ walletId: x.walletId, lamports: x.sol })), lookupTable: b.lookupTable, ...exec(b) });
    if (!b.dryRun && result.txs[0]?.status === "confirmed") await watch(result.plan.mint).catch((err: Error) => app.log.warn(err));
    return result;
  });

  app.get("/api/launches", async () => launch.list());

  app.post("/api/launches/:id/reclaim-table", async (req) => launch.reclaimTable(Number((req.params as { id: string }).id), config.defaultPriorityMicroLamports));

  app.get("/api/tokens", async () => tokens.list().map((t) => ({ ...t, ingestError: ingestor.errors.get(t.mint) ?? null })));

  app.post("/api/tokens/track", async (req) => {
    const b = z.object({ address: z.string().min(32) }).parse(req.body);
    const { profile, info } = await tokens.track(b.address);
    ingestor.watch(profile.mint);
    activity.record({ kind: "token", status: "info", summary: `Tracking ${info.symbol ?? profile.mint.slice(0, 6)} (${info.venueNote})`, token: profile.mint });
    return profile;
  });

  app.delete("/api/tokens/:mint", async (req) => {
    const mint = (req.params as { mint: string }).mint;
    tokens.untrack(mint);
    ingestor.unwatch(mint);
    return { ok: true };
  });

  const mintParam = (req: FastifyRequest) => parsePubkey((req.params as { mint: string }).mint, "mint").toBase58();
  app.get("/api/dashboard/:mint", async (req) => dashboard.overview(mintParam(req)));
  app.get("/api/dashboard/:mint/trades", async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().positive().optional() }).parse(req.query);
    return dashboard.trades(mintParam(req), q.limit, q.before);
  });
  app.get("/api/dashboard/:mint/candles", async (req) => {
    const q = z.object({ interval: z.coerce.number().int().min(1).max(86_400).default(60), from: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return dashboard.candles(mintParam(req), q.interval, q.from);
  });
  app.get("/api/dashboard/:mint/holders", async (req) => dashboard.holders(mintParam(req)));
  app.get("/api/dashboard/:mint/pnl", async (req) => dashboard.pnl(mintParam(req)));
  app.post("/api/dashboard/:mint/sync", async (req) => {
    const mint = mintParam(req);
    if (!tokens.get(mint)) await tokens.track(mint);
    return { added: await ingestor.sync(mint) };
  });

  app.get("/api/strategies", async () => ({ killSwitch: engine.killSwitch, maxActionsPerMinute: config.botMaxActionsPerMinute, strategies: engine.list() }));
  app.post("/api/strategies", async (req) => {
    const b = z.object({ kind: z.enum(["dca", "limit", "counter", "snipe"]), name: z.string().max(60).default(""), mint: z.string(), budgetSol: z.number().min(0).max(10_000).default(0), start: z.boolean().default(false), config: z.unknown() }).parse(req.body);
    return engine.create(b);
  });
  app.get("/api/strategies/:id", async (req) => {
    const sid = Number((req.params as { id: string }).id);
    return { strategy: engine.get(sid), intents: engine.intents(sid) };
  });
  app.post("/api/strategies/:id/start", async (req) => engine.resume(Number((req.params as { id: string }).id)));
  app.post("/api/strategies/:id/pause", async (req) => engine.pause(Number((req.params as { id: string }).id)));
  app.post("/api/strategies/:id/stop", async (req) => engine.stopStrategy(Number((req.params as { id: string }).id)));
  app.delete("/api/strategies/:id", async (req) => {
    engine.remove(Number((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post("/api/strategies/kill-switch", async (req) => engine.setKillSwitch(z.object({ on: z.boolean() }).parse(req.body).on));

  app.get("/api/alerts", async () => notifier.status());
  app.patch("/api/alerts", async (req) => notifier.setPrefs(z.object({ fills: z.boolean(), failures: z.boolean(), lowBalance: z.boolean(), botStatus: z.boolean(), launches: z.boolean() }).partial().parse(req.body)));
  app.post("/api/alerts/test", async () => notifier.test());

  app.get("/api/activity", async (req) => {
    const q = req.query as { limit?: string; before?: string };
    return activity.list(Math.min(500, Number(q.limit ?? 200)), q.before ? Number(q.before) : undefined);
  });

  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    reply.raw.write(": connected\n\n");
    const send = (e: unknown) => reply.raw.write(`event: activity\ndata: ${JSON.stringify(e)}\n\n`);
    const sendTrade = (t: TradeRow) => reply.raw.write(`event: trade\ndata: ${JSON.stringify(dashboard.labelTrade(t))}\n\n`);
    const sendBot = (e: StrategyEvent) => reply.raw.write(`event: bot\ndata: ${JSON.stringify({ type: e.type, text: e.text, strategyId: e.strategy?.id ?? null, status: e.strategy?.status ?? null })}\n\n`);
    const onLock = () => {
      reply.raw.write("event: locked\ndata: {}\n\n");
      reply.raw.end();
    };
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    activity.on("entry", send);
    ingestor.on("trade", sendTrade);
    engine.on("event", sendBot);
    vault.once("locked", onLock);
    req.raw.on("close", () => {
      clearInterval(ping);
      activity.off("entry", send);
      ingestor.off("trade", sendTrade);
      engine.off("event", sendBot);
      vault.off("locked", onLock);
    });
  });

  app.post("/api/dev/airdrop", async (req, reply) => {
    if (config.network === "mainnet") return reply.code(404).send({ error: "Not available on mainnet" });
    const b = z.object({ walletIds: ids, sol: z.number().positive().max(100) }).parse(req.body);
    const out: Record<string, string> = {};
    for (const w of wallets.getMany(b.walletIds)) {
      try {
        const sig = await solana.conn.requestAirdrop(parsePubkey(w.address), Math.round(b.sol * LAMPORTS_PER_SOL));
        await solana.conn.confirmTransaction(sig, "confirmed");
        out[w.address] = sig;
        activity.record({ kind: "airdrop", status: "ok", summary: `Airdropped ${b.sol} SOL to ${w.label}`, walletAddress: w.address, signature: sig });
      } catch (err) {
        out[w.address] = `error: ${(err as Error).message}`;
      }
    }
    return out;
  });

  const webDir = config.webDir ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../web/dist");
  if (fs.existsSync(path.join(webDir, "index.html"))) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
  }

  return {
    app,
    vault,
    wallets,
    activity,
    solana,
    tokens,
    ingestor,
    engine,
    notifier,
    startBackground(opts = {}) {
      ingestor.start();
      engine.start(opts.tickMs);
    },
    async close() {
      engine.stop();
      ingestor.stop();
      vault.close();
      await app.close();
      db.close();
    },
  };
}

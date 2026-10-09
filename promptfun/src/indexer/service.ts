import type http from "node:http";
import type { Config } from "../config.js";
import { findChain } from "../chains/registry.js";
import type { IntentStore } from "../intents/store.js";
import type { CoinDetail, CoinSummary, CoinsListResponse, StatsResponse } from "../api/types.js";
import { CHAIN_IMPORTS, importKnownCoin } from "./imports.js";
import { coinId, toDetail, toSummary, type CoinRecord } from "./record.js";
import { refreshLive } from "./live.js";
import { syncCoinsFromIntents } from "./sync.js";
import { CoinIndexStore } from "./store.js";

export type CoinSort = "new" | "top" | "paid";

export interface CoinQuery {
  sort: CoinSort;
  q: string | null;
  chain: string | null;
  network: "mainnet" | "testnet" | null;
  limit: number;
  offset: number;
}

export class CoinIndexService {
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private stopped = false;

  constructor(
    readonly config: Config,
    private intents: IntentStore,
    readonly store: CoinIndexStore,
  ) {}

  start(): void {
    void this.bootstrap();
    this.timer = setInterval(() => void this.refreshAll(), 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async bootstrap(): Promise<void> {
    if (this.stopped) return;
    for (const coin of syncCoinsFromIntents(this.config, this.intents)) {
      this.store.upsert(coin);
    }
    for (const spec of CHAIN_IMPORTS) {
      try {
        const imported = await importKnownCoin(this.config, spec);
        if (imported) this.store.upsert(imported);
      } catch {
        // No fake coins when RPC is down.
      }
    }
    await this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    if (this.stopped) return;
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      for (const record of this.store.all()) {
        const chain = findChain(this.config, record.chainKey);
        if (!chain) continue;
        try {
          record.live = await refreshLive(this.config, chain, record);
          this.store.upsert(record);
        } catch {
          // Keep last snapshot.
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  resolveQuery(params: URLSearchParams): { ok: true; query: CoinQuery } | { ok: false; error: string } {
    const sortRaw = params.get("sort") ?? "new";
    if (!["new", "top", "paid"].includes(sortRaw)) return { ok: false, error: 'sort must be "new", "top", or "paid".' };
    const limitRaw = params.get("limit");
    const offsetRaw = params.get("offset");
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    const offset = offsetRaw === null ? 0 : Number(offsetRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { ok: false, error: "limit must be an integer from 1 to 100." };
    if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: "offset must be a non-negative integer." };
    const network = params.get("network");
    if (network && network !== "mainnet" && network !== "testnet") {
      return { ok: false, error: 'network must be "mainnet" or "testnet".' };
    }
    return {
      ok: true,
      query: {
        sort: sortRaw as CoinSort,
        q: params.get("q"),
        chain: params.get("chain"),
        network: network as CoinQuery["network"],
        limit,
        offset,
      },
    };
  }

  list(query: CoinQuery): CoinsListResponse {
    const generatedAt = new Date().toISOString();
    let rows = this.store.all().map((r) => this.summaryFor(r)).filter((s): s is CoinSummary => !!s);
    if (query.chain) rows = rows.filter((c) => c.chain.key === query.chain);
    if (query.network === "mainnet") rows = rows.filter((c) => !c.chain.testnet);
    if (query.network === "testnet") rows = rows.filter((c) => c.chain.testnet);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter(
        (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.address.toLowerCase() === q,
      );
    }
    rows = this.sortCoins(rows, query.sort);
    const total = rows.length;
    const slice = rows.slice(query.offset, query.offset + query.limit);
    return { coins: slice, total, sort: query.sort, limit: query.limit, offset: query.offset, generatedAt };
  }

  stats(): StatsResponse {
    const generatedAt = new Date().toISOString();
    const summaries = this.store.all().map((r) => this.summaryFor(r)).filter((s): s is CoinSummary => !!s);
    const byChain: Record<string, number> = {};
    for (const c of summaries) byChain[c.chain.key] = (byChain[c.chain.key] ?? 0) + 1;
    const mainnetCoins = summaries.filter((c) => !c.chain.testnet).length;
    const paidBySymbol = new Map<string, { amount: bigint; coins: number; complete: boolean; decimals: number }>();
    for (const c of summaries) {
      const paid = c.creatorFees.paid;
      if (paid === null) continue;
      const parts = paid.split(".");
      const whole = parts[0] ?? "0";
      const frac = (parts[1] ?? "").padEnd(9, "0").slice(0, 9);
      const lamports = BigInt(whole) * 1_000_000_000n + BigInt(frac);
      const cur = paidBySymbol.get(c.creatorFees.symbol) ?? { amount: 0n, coins: 0, complete: true, decimals: 9 };
      cur.amount += lamports;
      cur.coins += 1;
      cur.complete = cur.complete && c.creatorFees.complete;
      paidBySymbol.set(c.creatorFees.symbol, cur);
    }
    const creatorFeesPaid = [...paidBySymbol.entries()].map(([symbol, v]) => ({
      symbol,
      amount: (v.amount / 1_000_000_000n).toString(),
      coins: v.coins,
      complete: v.complete,
    }));
    if (!creatorFeesPaid.length) creatorFeesPaid.push({ symbol: "SOL", amount: "0", coins: 0, complete: true });
    return { coins: summaries.length, byChain, mainnetCoins, creatorFeesPaid, generatedAt };
  }

  async detail(idOrAddress: string, chainHint?: string): Promise<
    | { ok: true; detail: CoinDetail }
    | { ok: false; status: number; body: Record<string, unknown> }
  > {
    let record: CoinRecord | null = null;
    if (idOrAddress.includes(":")) {
      record = this.store.get(decodeURIComponent(idOrAddress));
    } else {
      const matches = this.store.findByAddress(idOrAddress);
      if (chainHint) {
        record = matches.find((m) => m.chainKey === chainHint) ?? null;
      } else if (matches.length === 1) {
        record = matches[0]!;
      } else if (matches.length > 1) {
        return {
          ok: false,
          status: 409,
          body: { error: "That address matches more than one coin.", code: "ambiguous", candidates: matches.map((m) => m.id) },
        };
      }
    }
    if (!record) {
      return { ok: false, status: 404, body: { error: "No coin with that id.", code: "not_found" } };
    }
    const chain = findChain(this.config, record.chainKey);
    if (!chain) {
      return { ok: false, status: 404, body: { error: "No coin with that id.", code: "not_found" } };
    }
    const ageMs = Date.now() - Date.parse(record.live.market.readAt ?? record.launchedAt);
    if (ageMs > 30_000) {
      try {
        record.live = await refreshLive(this.config, chain, record);
        this.store.upsert(record);
      } catch {
        // serve stale
      }
    }
    return { ok: true, detail: toDetail(chain, record) };
  }

  findByIntentOrAddress(coin: string, chain?: string): CoinDetail | null {
    const byIntent = this.store.all().find((c) => c.intentId === coin);
    if (byIntent) {
      const chainDef = findChain(this.config, byIntent.chainKey);
      if (chainDef) return toDetail(chainDef, byIntent);
    }
    let record: CoinRecord | null = null;
    if (coin.includes(":")) {
      record = this.store.get(decodeURIComponent(coin));
    } else {
      const matches = this.store.findByAddress(coin);
      if (chain) record = matches.find((m) => m.chainKey === chain) ?? null;
      else if (matches.length === 1) record = matches[0]!;
    }
    if (!record) return null;
    const chainDef = findChain(this.config, record.chainKey);
    return chainDef ? toDetail(chainDef, record) : null;
  }

  upsertFromIntent(record: CoinRecord): void {
    this.store.upsert(record);
  }

  syncIntents(): void {
    for (const coin of syncCoinsFromIntents(this.config, this.intents)) {
      const existing = this.store.get(coin.id);
      this.store.upsert(existing ? { ...coin, live: existing.live } : coin);
    }
  }

  private summaryFor(record: CoinRecord): CoinSummary | null {
    const chain = findChain(this.config, record.chainKey);
    if (!chain) return null;
    return toSummary(chain, record);
  }

  private sortCoins(coins: CoinSummary[], sort: CoinSort): CoinSummary[] {
    const copy = [...coins];
    if (sort === "new") {
      copy.sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
      return copy;
    }
    if (sort === "top") {
      copy.sort((a, b) => {
        const au = a.market.marketCapUsd ?? a.market.marketCapNative;
        const bu = b.market.marketCapUsd ?? b.market.marketCapNative;
        if (au === null && bu === null) return 0;
        if (au === null) return 1;
        if (bu === null) return -1;
        return Number(bu) - Number(au);
      });
      return copy;
    }
    copy.sort((a, b) => {
      const ap = a.creatorFees.paid;
      const bp = b.creatorFees.paid;
      if (ap === null && bp === null) return 0;
      if (ap === null) return 1;
      if (bp === null) return -1;
      return Number(bp) - Number(ap);
    });
    return copy;
  }
}

export function applyCoinsCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function handleCoinsApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  indexer: CoinIndexService,
  sendJson: (status: number, body: unknown) => void,
): boolean {
  if (!pathname.startsWith("/api/coins") && pathname !== "/api/stats") return false;
  applyCoinsCors(res);
  res.setHeader("Cache-Control", "public, max-age=15");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(405, { error: "Method not allowed.", code: "method_not_allowed" });
    return true;
  }
  if (pathname === "/api/stats") {
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return true;
    }
    sendJson(200, indexer.stats());
    return true;
  }
  if (pathname === "/api/coins") {
    const parsed = indexer.resolveQuery(url.searchParams);
    if (!parsed.ok) {
      sendJson(400, { error: parsed.error, code: "bad_request" });
      return true;
    }
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return true;
    }
    sendJson(200, indexer.list(parsed.query));
    return true;
  }
  const detailMatch = /^\/api\/coins\/(.+)$/.exec(pathname);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]!);
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return true;
    }
    void indexer.detail(id, url.searchParams.get("chain") ?? undefined).then((result) => {
      if (!result.ok) sendJson(result.status, result.body);
      else sendJson(200, result.detail);
    });
    return true;
  }
  return false;
}

const TOKEN_KEY = "terminal.session";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 401 && data.code === "unauthorized") {
    setToken(null);
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.code);
  return data as T;
}

export interface Status {
  network: "local" | "devnet" | "mainnet";
  chain: string;
  chainName: string;
  rpcUrl: string;
  vault: { initialized: boolean; unlocked: boolean; keepUnlocked: boolean };
  bundles: boolean;
  maxSolPerAction: number;
  killSwitch: boolean;
  botsRunning: number;
  alerts: boolean;
  defaults: { priorityMicroLamports: number; jitoTipLamports: number };
}

export interface Wallet {
  id: number;
  family: string;
  address: string;
  label: string;
  groupId: number | null;
  source: "hd" | "imported";
  hdIndex: number | null;
  status: "active" | "archived";
  createdAt: string;
}

export interface Group {
  id: number;
  name: string;
  walletCount: number;
}

export interface TxResult {
  label: string;
  signature: string;
  status: "simulated" | "confirmed" | "failed" | "skipped";
  error?: string;
  logs?: string[];
}

export interface ActionResult {
  mode: string;
  note?: string;
  bundleId?: string;
  dryRun: boolean;
  txs: TxResult[];
  explorer: Record<string, string>;
}

export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  tokenProgram: string;
  venue: "pumpfun" | "pumpswap" | "jupiter" | null;
  venueNote: string;
  creatorIsOwn: boolean;
  curve: null | { complete: boolean; creator: string; progressPct: number; marketCapLamports: string; priceLamportsPerToken: number };
  pool: null | { address: string; canonical: boolean; baseReserve: string; quoteReserve: string };
  market: null | { priceLamportsPerToken: number; marketCapLamports: string; liquidityLamports: string };
}

export interface TokenProfile {
  id: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  supply: string;
  venue: string | null;
  pool: string | null;
  tracked: boolean;
  ingestError?: string | null;
}

export interface OwnLabel {
  walletId: number;
  label: string;
  groupId: number | null;
}

export interface Trade {
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
  /** Lamports per base unit. */
  price: number;
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

export interface Overview {
  info: TokenInfo;
  tracked: boolean;
  tradeCount: number;
  stats24h: { trades: number; buys: number; sells: number; volumeLamports: string; ownVolumeLamports: string };
}

export interface Holders {
  mint: string;
  supply: string;
  decimals: number;
  complete: boolean;
  holderCount: number | null;
  own: { wallets: number; amount: string; pct: number };
  holders: { owner: string; amount: string; pct: number; kind: "bonding_curve" | "pool" | "own" | "external"; own: OwnLabel | null }[];
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
  untrackedTokens: string;
}

export interface PnlReport {
  mint: string;
  priceLamportsPerToken: number;
  wallets: WalletPnl[];
  groups: { groupId: number | null; name: string; realizedLamports: string; unrealizedLamports: string; valueLamports: string; costBasisLamports: string }[];
  total: { realizedLamports: string; unrealizedLamports: string; valueLamports: string; costBasisLamports: string; holdingTokens: string; supplyPct: number };
}

export type StrategyKind = "dca" | "limit" | "counter" | "snipe";
export type StrategyStatus = "running" | "paused" | "stopped" | "completed" | "failed";

export interface Strategy {
  id: number;
  kind: StrategyKind;
  name: string;
  mint: string;
  config: { walletIds: number[]; [k: string]: unknown };
  status: StrategyStatus;
  budgetLamports: string;
  spentLamports: string;
  receivedLamports: string;
  runs: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  note: string | null;
  createdAt: string;
}

export interface StrategyIntent {
  id: number;
  key: string;
  side: "buy" | "sell";
  status: "pending" | "ok" | "failed" | "unknown";
  detail: Record<string, unknown> | null;
  result: { signatures?: { label: string; signature: string; status: string; error?: string }[]; error?: string } | null;
  createdAt: string;
}

export type AlertCategory = "fills" | "failures" | "lowBalance" | "botStatus" | "launches";

export interface AlertStatus {
  enabled: boolean;
  chatId: string | null;
  prefs: Record<AlertCategory, boolean>;
  queued: number;
  dropped: number;
  lastError: string | null;
}

export interface Activity {
  id: number;
  kind: string;
  status: "ok" | "failed" | "info" | "simulated";
  summary: string;
  walletAddress: string | null;
  token: string | null;
  signature: string | null;
  detail: { error?: string; note?: string } | null;
  createdAt: string;
}

export const lamportsToSol = (l: string | number | bigint, digits = 4) => (Number(l) / 1e9).toLocaleString("en-US", { maximumFractionDigits: digits });
export const tokenAmount = (raw: string | number, decimals: number) => (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** Signed SOL with a leading + for gains. */
export const signedSol = (l: string | number | bigint, digits = 4) => `${Number(l) > 0 ? "+" : ""}${lamportsToSol(l, digits)}`;

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
let sourceToken: string | null = null;

/** One shared server-sent-events connection; `on` returns an unsubscribe function. */
export function onServerEvent(name: string, fn: Listener): () => void {
  const token = getToken();
  if (!source || sourceToken !== token) {
    source?.close();
    sourceToken = token;
    source = new EventSource(`/api/events?token=${encodeURIComponent(token ?? "")}`);
    for (const ev of ["activity", "trade", "bot", "locked"]) {
      source.addEventListener(ev, (e) => {
        const data = JSON.parse((e as MessageEvent).data || "null") as unknown;
        for (const l of listeners.get(ev) ?? []) l(data);
      });
    }
    source.onerror = () => {
      for (const l of listeners.get("connection") ?? []) l(false);
    };
    source.onopen = () => {
      for (const l of listeners.get("connection") ?? []) l(true);
    };
  }
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => listeners.get(name)!.delete(fn);
}

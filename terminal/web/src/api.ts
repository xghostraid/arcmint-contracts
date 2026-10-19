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
  venue: "pumpfun" | "jupiter" | null;
  venueNote: string;
  creatorIsOwn: boolean;
  curve: null | { complete: boolean; creator: string; progressPct: number; marketCapLamports: string; priceLamportsPerToken: number };
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

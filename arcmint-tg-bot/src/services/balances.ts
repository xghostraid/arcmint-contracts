/**
 * Balances via Blockscout first (works when public Arc RPC is broken),
 * with short-timeout RPC fallback.
 */
import { formatUnits, hexToString, type Hex } from 'viem';
import { publicClient } from '../chain/client.js';
import { erc20Abi, erc20Bytes32MetaAbi } from '../chain/abis.js';
import { env } from '../config/env.js';
import { cacheGet, cacheGetOrSet, cacheSet } from './cache.js';

const RPC_MS = 6_000;
const HTTP_MS = 5_000;

function blockscoutBase(): string | null {
  const raw = (process.env.ARC_BLOCKSCOUT_URL || '').replace(/\/$/, '');
  if (!raw) return null;
  if (raw.includes('arc-mainnet.cloud.blockscout.com')) return null;
  return raw;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function fetchJson(url: string, ms = HTTP_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'arcmint-tg-bot/1.0 (+https://t.me/arcTraderXbot)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Blockscout account tokenbalance (raw string). */
async function blockscoutTokenBalance(
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint | null> {
  try {
    const base = blockscoutBase();
    if (!base) return null;
    const url =
      `${base}/api?module=account&action=tokenbalance` +
      `&contractaddress=${token}&address=${owner}`;
    const data = (await fetchJson(url)) as { result?: string; status?: string };
    if (data.result == null || data.result === '') return null;
    return BigInt(data.result);
  } catch {
    return null;
  }
}

export async function getUsdcBalance(address: `0x${string}`): Promise<{
  raw: bigint;
  formatted: string;
}> {
  const key = `bal:usdc:${address.toLowerCase()}`;
  return cacheGetOrSet(key, 12_000, async () => {
    const usdc = env.usdc();
    // 1) Blockscout (fast when RPC is dead)
    const fromBs = await blockscoutTokenBalance(usdc, address);
    if (fromBs != null) {
      return { raw: fromBs, formatted: formatUnits(fromBs, 6) };
    }
    // 2) RPC with hard timeout
    try {
      const client = publicClient();
      const raw = (await withTimeout(
        client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }) as Promise<bigint>,
        RPC_MS,
        'usdc balanceOf',
      )) as bigint;
      return { raw, formatted: formatUnits(raw, 6) };
    } catch {
      return { raw: 0n, formatted: '0' };
    }
  });
}

export type TokenMeta = {
  name: string;
  symbol: string;
  decimals: number;
};

export const PLACEHOLDER_META: TokenMeta = {
  name: 'Token',
  symbol: 'TOKEN',
  decimals: 18,
};

const PLACEHOLDER_LABELS = new Set(['TOKEN', '???', 'UNKNOWN', 'N/A', 'NULL']);

function cleanMetaText(raw: string, max: number): string {
  const s = raw.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

/** True for empty / generic labels like TOKEN, ???, Token. */
export function isPlaceholderLabel(value?: string | null): boolean {
  if (value == null) return true;
  const s = value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return true;
  return PLACEHOLDER_LABELS.has(s.toUpperCase());
}

/** First non-placeholder label, or empty string. */
export function bestLabel(
  ...candidates: Array<string | undefined | null>
): string {
  for (const c of candidates) {
    if (!isPlaceholderLabel(c)) return String(c).replace(/\s+/g, ' ').trim();
  }
  return '';
}

function decodeBytes32(value: Hex): string {
  try {
    return cleanMetaText(hexToString(value, { size: 32 }), 48);
  } catch {
    return '';
  }
}

async function readErc20String(
  token: `0x${string}`,
  fn: 'name' | 'symbol',
): Promise<string> {
  const client = publicClient();
  try {
    const v = await withTimeout(
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: fn,
      }) as Promise<string>,
      RPC_MS,
      `token ${fn}`,
    );
    return cleanMetaText(String(v ?? ''), 48);
  } catch {
    /* try bytes32 */
  }
  try {
    const v = await withTimeout(
      client.readContract({
        address: token,
        abi: erc20Bytes32MetaAbi,
        functionName: fn,
      }) as Promise<Hex>,
      RPC_MS,
      `token ${fn} bytes32`,
    );
    return decodeBytes32(v);
  } catch {
    return '';
  }
}

async function fetchLaunchpadMeta(token: `0x${string}`): Promise<TokenMeta | null> {
  try {
    const base = env.catalogApi();
    if (!base) return null;
    const data = (await fetchJson(`${base}/api/tokens/${token}`, 6_000)) as {
      token?: { name?: string; symbol?: string };
      name?: string;
      symbol?: string;
    };
    const row = data.token ?? data;
    const name = cleanMetaText(String(row.name ?? ''), 48);
    const symbol = cleanMetaText(String(row.symbol ?? ''), 24);
    if (isPlaceholderLabel(name) && isPlaceholderLabel(symbol)) return null;
    return {
      name: bestLabel(name, symbol) || name,
      symbol: (bestLabel(symbol, name) || symbol).slice(0, 24),
      decimals: 18,
    };
  } catch {
    return null;
  }
}

function isPlaceholderMeta(meta: TokenMeta): boolean {
  return isPlaceholderLabel(meta.symbol) && isPlaceholderLabel(meta.name);
}

export async function getTokenMeta(token: `0x${string}`): Promise<TokenMeta> {
  const key = `meta:rpc:${token.toLowerCase()}`;
  const cached = cacheGet<TokenMeta>(key);
  if (cached && !isPlaceholderMeta(cached)) return cached;

  let name = '';
  let symbol = '';
  let decimals = 18;

  try {
    const client = publicClient();
    const [n, s, d] = await Promise.all([
      readErc20String(token, 'name'),
      readErc20String(token, 'symbol'),
      withTimeout(
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'decimals',
        }) as Promise<number>,
        RPC_MS,
        'token decimals',
      ).catch(() => 18),
    ]);
    name = n;
    symbol = s;
    decimals = Number(d) || 18;
  } catch {
    /* */
  }

  if (!name || !symbol) {
    try {
      const base = blockscoutBase();
      if (base) {
        const data = (await fetchJson(`${base}/api/v2/tokens/${token}`)) as {
          name?: string;
          symbol?: string;
          decimals?: string | number;
        };
        name = name || cleanMetaText(String(data.name ?? ''), 48);
        symbol = symbol || cleanMetaText(String(data.symbol ?? ''), 24);
        if (data.decimals != null) decimals = Number(data.decimals) || decimals;
      }
    } catch {
      /* */
    }
  }

  if (!name || !symbol) {
    const catalog = await fetchLaunchpadMeta(token);
    if (catalog) {
      name = name || catalog.name;
      symbol = symbol || catalog.symbol;
    }
  }

  const resolvedName = bestLabel(name, symbol) || PLACEHOLDER_META.name;
  const resolvedSymbol = (bestLabel(symbol, name) || PLACEHOLDER_META.symbol).slice(0, 24);
  const meta: TokenMeta = {
    name: resolvedName,
    symbol: resolvedSymbol,
    decimals,
  };
  if (!isPlaceholderMeta(meta)) {
    cacheSet(key, meta, 60_000);
  }
  return meta;
}

export async function getTokenBalance(
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  const key = `bal:${token.toLowerCase()}:${owner.toLowerCase()}`;
  return cacheGetOrSet(key, 12_000, async () => {
    const fromBs = await blockscoutTokenBalance(token, owner);
    if (fromBs != null) return fromBs;
    try {
      return (await withTimeout(
        publicClient().readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner],
        }) as Promise<bigint>,
        RPC_MS,
        'token balanceOf',
      )) as bigint;
    } catch {
      return 0n;
    }
  });
}

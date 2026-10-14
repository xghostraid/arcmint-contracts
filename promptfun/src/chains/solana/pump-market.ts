import { createRequire } from "node:module";
import { PublicKey } from "@solana/web3.js";
import type { Chain } from "../registry.js";
import type { Market } from "../../api/types.js";
import { connectionFor } from "./adapter.js";
import { formatUnits } from "../../util/amount.js";
import { usdValue } from "../../util/price.js";

const pumpMod = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const { OnlinePumpSdk, bondingCurveMarketCap } = pumpMod;
const BN = createRequire(import.meta.url)("bn.js") as typeof import("bn.js");

const PUMP_FRONTEND_API =
  (typeof process !== "undefined" && process.env.PROMPTFUN_PUMP_FRONTEND_API?.trim()) ||
  "https://frontend-api-v3.pump.fun";

export interface PumpfunApiCoinRow {
  mint: string;
  complete?: boolean;
  usd_market_cap?: number;
  market_cap_usd?: number;
  market_cap_quote?: number;
}

/** pump.fun site headline mcap (POST /coins/mints). May 403 from some server egress (Cloudflare). */
export async function fetchPumpfunApiCoin(mintAddress: string): Promise<PumpfunApiCoinRow | null> {
  try {
    const res = await fetch(`${PUMP_FRONTEND_API}/coins/mints`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; promptfun/1.0; +https://promptfun.fun)",
      },
      body: JSON.stringify({ mints: [mintAddress] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as PumpfunApiCoinRow[];
    return rows.find((r) => r.mint === mintAddress) ?? rows[0] ?? null;
  } catch {
    return null;
  }
}

export function marketFromPumpfunApiRow(row: PumpfunApiCoinRow): {
  priceNative: string | null;
  marketCapNative: string | null;
  priceUsd: string | null;
  marketCapUsd: string | null;
  graduated: boolean | null;
  source: string;
} {
  const usdRaw = row.usd_market_cap ?? row.market_cap_usd;
  const marketCapUsd = usdRaw != null && Number.isFinite(usdRaw) ? usdRaw.toFixed(2) : null;
  const quoteSol = row.market_cap_quote;
  const marketCapNative = quoteSol != null && Number.isFinite(quoteSol) ? `${quoteSol}` : null;
  return {
    priceNative: null,
    marketCapNative,
    priceUsd: null,
    marketCapUsd,
    graduated: row.complete ?? null,
    source: "pump.fun frontend API (usd_market_cap)",
  };
}

/** Trade-based USD mcap when pump API is blocked (aligns with pump.fun for listed pairs). */
export async function fetchDexScreenerMarket(
  mintAddress: string,
): Promise<Pick<Market, "priceNative" | "marketCapNative" | "priceUsd" | "marketCapUsd" | "source"> | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: Array<Record<string, unknown>> };
    const pairs = body.pairs ?? [];
    if (!pairs.length) return null;
    const best = [...pairs].sort((a, b) => {
      const la = Number((a.liquidity as { usd?: number })?.usd ?? 0);
      const lb = Number((b.liquidity as { usd?: number })?.usd ?? 0);
      return lb - la;
    })[0]!;
    const marketCapUsdNum = Number(best.marketCap);
    if (!Number.isFinite(marketCapUsdNum) || marketCapUsdNum <= 0) return null;
    const priceUsd = best.priceUsd != null ? String(best.priceUsd) : null;
    return {
      priceNative: null,
      marketCapNative: null,
      priceUsd,
      marketCapUsd: marketCapUsdNum.toFixed(2),
      source: `DexScreener (${String(best.dexId ?? "dex")}, USD market cap)`,
    };
  } catch {
    return null;
  }
}

/** pump.fun create_v2 defaults when curve fields are zero (pre-field curves). */
const DEFAULT_VIRTUAL_TOKEN = 1_073_000_000_000_000n;
const DEFAULT_VIRTUAL_QUOTE = 30_000_000_000n;

function lamportsToSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

export interface BondingCurveChartPoint {
  /** 0 at curve start, 100 at the coin's current reserves (not time). */
  progressPct: number;
  marketCapNative: string;
}

export interface BondingCurveChart {
  /** Normalized 0–100 heights for small sparklines. */
  points: number[];
  /** Synthetic mcap along the curve from launch reserves → now (not trade history). */
  series: BondingCurveChartPoint[];
}

/** Normalized 0–100 bar heights along the bonding curve from launch reserves to now. */
export function chartPointsFromBondingCurve(
  input: {
    mintSupply: bigint;
    virtualTokenReserves: bigint;
    virtualQuoteReserves: bigint;
    initialVirtualQuoteReserves: bigint;
  },
  samples = 12,
): number[] {
  return bondingCurveChart(input, samples).points;
}

export function bondingCurveChart(
  input: {
    mintSupply: bigint;
    virtualTokenReserves: bigint;
    virtualQuoteReserves: bigint;
    initialVirtualQuoteReserves: bigint;
  },
  samples = 12,
): BondingCurveChart {
  const count = Math.max(2, Math.min(128, Math.floor(samples)));
  const startToken =
    input.virtualTokenReserves > DEFAULT_VIRTUAL_TOKEN / 2n
      ? DEFAULT_VIRTUAL_TOKEN
      : input.virtualTokenReserves + (DEFAULT_VIRTUAL_TOKEN / 20n);
  const startQuote =
    input.initialVirtualQuoteReserves > 0n ? input.initialVirtualQuoteReserves : DEFAULT_VIRTUAL_QUOTE;
  const k = startToken * startQuote;
  const points: number[] = [];
  let max = 0n;
  const mcaps: bigint[] = [];
  const series: BondingCurveChartPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const vToken = startToken - ((startToken - input.virtualTokenReserves) * BigInt(Math.round(t * 1000))) / 1000n;
    const safeToken = vToken > 0n ? vToken : 1n;
    const vQuote = k / safeToken;
    const mcap = bondingCurveMarketCap({
      mintSupply: new BN(input.mintSupply.toString()),
      virtualQuoteReserves: new BN(vQuote.toString()),
      virtualTokenReserves: new BN(safeToken.toString()),
    });
    const mcapBig = BigInt(mcap.toString());
    mcaps.push(mcapBig);
    series.push({
      progressPct: Math.round(t * 1000) / 10,
      marketCapNative: lamportsToSol(mcapBig),
    });
    if (mcapBig > max) max = mcapBig;
  }
  if (max === 0n) return { points: Array(count).fill(8), series };
  for (const m of mcaps) {
    const pct = Number((m * 100n) / max);
    points.push(Math.max(4, Math.min(100, pct)));
  }
  return { points, series };
}

export async function readPumpfunMarket(
  chain: Chain,
  mintAddress: string,
  options?: { chartSamples?: number },
): Promise<Market> {
  const readAt = new Date().toISOString();
  const conn = connectionFor(chain as never);
  const mint = new PublicKey(mintAddress);
  try {
    const online = new OnlinePumpSdk(conn);
    const bondingCurve = await online.fetchBondingCurve(mint);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const mcapLamports = bondingCurveMarketCap({
      mintSupply,
      virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
    });
    const mcapLamportsBig = BigInt(mcapLamports.toString());
    const marketCapNative = lamportsToSol(mcapLamportsBig);
    const priceLamports =
      bondingCurve.virtualTokenReserves.isZero()
        ? 0n
        : (BigInt(bondingCurve.virtualQuoteReserves.toString()) * 10n ** 6n) /
          BigInt(bondingCurve.virtualTokenReserves.toString());
    const priceNative = priceLamports > 0n ? lamportsToSol(priceLamports) : null;
    const chart = bondingCurveChart(
      {
        mintSupply: BigInt(mintSupply.toString()),
        virtualTokenReserves: BigInt(bondingCurve.virtualTokenReserves.toString()),
        virtualQuoteReserves: BigInt(bondingCurve.virtualQuoteReserves.toString()),
        initialVirtualQuoteReserves: BigInt(bondingCurve.initialVirtualQuoteReserves.toString()),
      },
      options?.chartSamples ?? 12,
    );

    const apiRow = await fetchPumpfunApiCoin(mintAddress);
    if (apiRow) {
      const fromApi = marketFromPumpfunApiRow(apiRow);
      if (fromApi.marketCapUsd) {
        return {
          ...fromApi,
          priceNative: priceNative ?? fromApi.priceNative,
          graduated: fromApi.graduated ?? bondingCurve.complete,
          reason: null,
          readAt,
          chartPoints: chart.points,
          chartSeries: chart.series.length > 12 ? chart.series : null,
        };
      }
    }

    const dex = await fetchDexScreenerMarket(mintAddress);
    if (dex?.marketCapUsd) {
      return {
        priceNative: priceNative ?? dex.priceNative,
        marketCapNative: dex.marketCapNative ?? marketCapNative,
        priceUsd: dex.priceUsd,
        marketCapUsd: dex.marketCapUsd,
        graduated: bondingCurve.complete,
        source: dex.source,
        reason: null,
        readAt,
        chartPoints: chart.points,
        chartSeries: chart.series.length > 12 ? chart.series : null,
      };
    }

    const usd = await usdValue(chain.nativeSymbol, marketCapNative, false);
    return {
      priceNative,
      marketCapNative,
      priceUsd: null,
      marketCapUsd: usd?.usd ?? null,
      graduated: bondingCurve.complete,
      source: "On-chain bonding curve estimate × SOL/USD (pump.fun API and DexScreener unavailable)",
      reason: null,
      readAt,
      chartPoints: chart.points,
      chartSeries: chart.series.length > 12 ? chart.series : null,
    };
  } catch (err) {
    return {
      priceNative: null,
      marketCapNative: null,
      priceUsd: null,
      marketCapUsd: null,
      graduated: null,
      source: null,
      reason: `Could not read pump.fun bonding curve: ${(err as Error).message}`,
      readAt,
      chartPoints: null,
      chartSeries: null,
    };
  }
}

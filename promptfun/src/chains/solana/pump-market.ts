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
    const usd = await usdValue(chain.nativeSymbol, marketCapNative, false);
    const chart = bondingCurveChart(
      {
        mintSupply: BigInt(mintSupply.toString()),
        virtualTokenReserves: BigInt(bondingCurve.virtualTokenReserves.toString()),
        virtualQuoteReserves: BigInt(bondingCurve.virtualQuoteReserves.toString()),
        initialVirtualQuoteReserves: BigInt(bondingCurve.initialVirtualQuoteReserves.toString()),
      },
      options?.chartSamples ?? 12,
    );
    return {
      priceNative,
      marketCapNative,
      priceUsd: null,
      marketCapUsd: usd?.usd ?? null,
      graduated: bondingCurve.complete,
      source: "pump.fun bonding curve (on chain via @pump-fun/pump-sdk)",
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

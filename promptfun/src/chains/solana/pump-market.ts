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
  process.env.PROMPTFUN_PUMP_FRONTEND_API?.replace(/\/$/, "") || "https://frontend-api-v3.pump.fun";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";

/** pump.fun create_v2 defaults when curve fields are zero (pre-field curves). */
const DEFAULT_VIRTUAL_TOKEN = 1_073_000_000_000_000n;
const DEFAULT_VIRTUAL_QUOTE = 30_000_000_000n;
const PUMP_SUPPLY_WHOLE = 1_000_000_000;

function lamportsToSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

function formatUsdAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "<0.01";
  if (value < 0.01) return "<0.01";
  return value.toFixed(2);
}

function solFromPumpQuote(quoteSol: number | undefined): string | null {
  if (quoteSol == null || !Number.isFinite(quoteSol) || quoteSol <= 0) return null;
  return quoteSol.toFixed(6).replace(/\.?0+$/, "") || "0";
}

/** Row from POST frontend-api-v3.pump.fun/coins/mints (same market cap users see on pump.fun). */
export interface PumpfunApiCoin {
  mint: string;
  complete?: boolean;
  usd_market_cap?: number;
  market_cap_usd?: number;
  market_cap?: number;
  market_cap_quote?: number;
}

/** Map a pump.fun frontend API coin row to headline market fields. */
export function marketFromPumpfunApiRow(row: PumpfunApiCoin): {
  marketCapUsd: string;
  marketCapNative: string | null;
  priceUsd: string | null;
  priceNative: string | null;
  graduated: boolean | null;
  source: string;
} | null {
  const usdRaw = row.usd_market_cap ?? row.market_cap_usd;
  const quoteSol = row.market_cap_quote ?? row.market_cap;
  if (usdRaw == null || !Number.isFinite(usdRaw)) return null;
  const marketCapNative = solFromPumpQuote(quoteSol);
  const priceUsd =
    usdRaw > 0 ? formatUsdAmount(usdRaw / PUMP_SUPPLY_WHOLE) : null;
  const priceNative =
    quoteSol != null && quoteSol > 0
      ? (quoteSol / PUMP_SUPPLY_WHOLE).toFixed(12).replace(/\.?0+$/, "") || null
      : null;
  return {
    marketCapUsd: formatUsdAmount(usdRaw),
    marketCapNative,
    priceUsd,
    priceNative,
    graduated: row.complete ?? null,
    source: "pump.fun frontend API (usd_market_cap / market_cap_quote)",
  };
}

export async function fetchPumpfunApiCoin(mintAddress: string): Promise<PumpfunApiCoin | null> {
  try {
    const res = await fetch(`${PUMP_FRONTEND_API}/coins/mints`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ mints: [mintAddress] }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as PumpfunApiCoin[];
    const row = body?.find((c) => c.mint === mintAddress) ?? body?.[0];
    return row?.mint === mintAddress ? row : null;
  } catch {
    return null;
  }
}

interface DexPair {
  priceUsd?: string;
  marketCap?: number;
  liquidity?: { usd?: number };
  dexId?: string;
}

export async function fetchDexScreenerMarket(mintAddress: string): Promise<{
  marketCapUsd: string;
  priceUsd: string | null;
  source: string;
} | null> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/${mintAddress}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: DexPair[] | null };
    const pairs = (body.pairs ?? []).filter((p) => p.marketCap != null || p.priceUsd);
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = pairs[0];
    const mcap = best.marketCap;
    if (mcap == null || !Number.isFinite(mcap)) return null;
    const dex = best.dexId ? ` (${best.dexId})` : "";
    return {
      marketCapUsd: formatUsdAmount(mcap),
      priceUsd: best.priceUsd ?? null,
      source: `DexScreener token market cap${dex}`,
    };
  } catch {
    return null;
  }
}

/** Normalized 0–100 bar heights along the bonding curve from launch reserves to now. */
export function chartPointsFromBondingCurve(input: {
  mintSupply: bigint;
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  initialVirtualQuoteReserves: bigint;
}): number[] {
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
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
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
    if (mcapBig > max) max = mcapBig;
  }
  if (max === 0n) return Array(12).fill(8);
  for (const m of mcaps) {
    const pct = Number((m * 100n) / max);
    points.push(Math.max(4, Math.min(100, pct)));
  }
  return points;
}

async function bondingCurveFallbackMarket(
  chain: Chain,
  bondingCurve: {
    tokenTotalSupply: InstanceType<typeof BN>;
    virtualQuoteReserves: InstanceType<typeof BN>;
    virtualTokenReserves: InstanceType<typeof BN>;
  },
): Promise<Pick<Market, "priceNative" | "marketCapNative" | "priceUsd" | "marketCapUsd" | "source">> {
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
  return {
    priceNative,
    marketCapNative,
    priceUsd: null,
    marketCapUsd: usd?.usd ?? null,
    source: usd
      ? `Estimated from on-chain bonding curve reserves × Pyth ${chain.nativeSymbol}/USD (pump.fun API unavailable)`
      : "On-chain bonding curve market cap in SOL (pump.fun API unavailable)",
  };
}

export async function readPumpfunMarket(chain: Chain, mintAddress: string): Promise<Market> {
  const readAt = new Date().toISOString();
  const conn = connectionFor(chain as never);
  const mint = new PublicKey(mintAddress);
  try {
    const online = new OnlinePumpSdk(conn);
    const [bondingCurve, apiCoin, dexMarket] = await Promise.all([
      online.fetchBondingCurve(mint),
      fetchPumpfunApiCoin(mintAddress),
      fetchDexScreenerMarket(mintAddress),
    ]);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const chartPoints = chartPointsFromBondingCurve({
      mintSupply: BigInt(mintSupply.toString()),
      virtualTokenReserves: BigInt(bondingCurve.virtualTokenReserves.toString()),
      virtualQuoteReserves: BigInt(bondingCurve.virtualQuoteReserves.toString()),
      initialVirtualQuoteReserves: BigInt(bondingCurve.initialVirtualQuoteReserves.toString()),
    });

    const fromApi = apiCoin ? marketFromPumpfunApiRow(apiCoin) : null;
    if (fromApi) {
      return {
        priceNative: fromApi.priceNative,
        marketCapNative: fromApi.marketCapNative,
        priceUsd: fromApi.priceUsd,
        marketCapUsd: fromApi.marketCapUsd,
        graduated: fromApi.graduated ?? bondingCurve.complete,
        source: fromApi.source,
        reason: null,
        readAt,
        chartPoints,
      };
    }

    const graduated = bondingCurve.complete;
    if (dexMarket) {
      let marketCapNative: string | null = null;
      let priceNative: string | null = null;
      if (dexMarket.priceUsd != null) {
        const usdMcap = Number(dexMarket.marketCapUsd);
        if (Number.isFinite(usdMcap)) {
          const solQuote = await usdValue(chain.nativeSymbol, "1", false);
          if (solQuote) {
            const solUsd = Number(solQuote.usd.replace(/[^0-9.]/g, ""));
            if (Number.isFinite(solUsd) && solUsd > 0) {
              marketCapNative = (usdMcap / solUsd).toFixed(6).replace(/\.?0+$/, "") || null;
              const tokUsd = Number(dexMarket.priceUsd);
              if (Number.isFinite(tokUsd)) {
                priceNative = (tokUsd / solUsd).toFixed(12).replace(/\.?0+$/, "") || null;
              }
            }
          }
        }
      }
      return {
        priceNative,
        marketCapNative,
        priceUsd: dexMarket.priceUsd,
        marketCapUsd: dexMarket.marketCapUsd,
        graduated,
        source: `${dexMarket.source}; headline matches pump.fun when their API is reachable`,
        reason: null,
        readAt,
        chartPoints,
      };
    }

    const fallback = await bondingCurveFallbackMarket(chain, bondingCurve);
    return {
      ...fallback,
      graduated,
      reason: graduated
        ? "Graduated coin: pump.fun API and DexScreener did not return a market cap."
        : null,
      readAt,
      chartPoints,
    };
  } catch (err) {
    return {
      priceNative: null,
      marketCapNative: null,
      priceUsd: null,
      marketCapUsd: null,
      graduated: null,
      source: null,
      reason: `Could not read pump.fun market: ${(err as Error).message}`,
      readAt,
      chartPoints: null,
    };
  }
}

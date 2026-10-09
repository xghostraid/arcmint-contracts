/** Pyth Hermes price feeds (public, no key): https://docs.pyth.network/price-feeds/core/api-reference */
const FEEDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BNB: "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  POL: "ffd11c5a1cfd42f80afb2df4d9f264c15f956d68153335374ec10722edd70472",
};
const HERMES = process.env.PROMPTFUN_PYTH_HERMES_URL || "https://hermes.pyth.network";
const MAX_AGE_S = 120;
const cache = new Map<string, { price: number; at: number; publishTime: number }>();

export interface UsdQuote {
  usd: string;
  source: string;
}

/** Real USD value of `amount` native units, or null when no fresh price exists. Never invents a price. */
export async function usdValue(symbol: string, amount: string, testnet: boolean): Promise<UsdQuote | null> {
  if (testnet) return null;
  const id = FEEDS[symbol];
  if (!id) return null;
  let entry = cache.get(id);
  if (!entry || Date.now() - entry.at > 60_000) {
    try {
      const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${id}&parsed=true`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { parsed?: Array<{ price: { price: string; expo: number; publish_time: number } }> };
      const p = body.parsed?.[0]?.price;
      if (!p) return null;
      entry = { price: Number(p.price) * 10 ** p.expo, at: Date.now(), publishTime: p.publish_time };
      cache.set(id, entry);
    } catch {
      return null;
    }
  }
  if (Date.now() / 1000 - entry.publishTime > MAX_AGE_S) return null;
  const value = Number(amount.replace(/,/g, "")) * entry.price;
  if (!Number.isFinite(value)) return null;
  return {
    usd: value < 0.01 ? "<0.01" : value.toFixed(2),
    source: `Pyth ${symbol}/USD ${entry.price.toFixed(2)} at ${new Date(entry.publishTime * 1000).toISOString()}`,
  };
}

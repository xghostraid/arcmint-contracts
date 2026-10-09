export const BRAND = "promptfun.fun";
export const SHORT = "promptfun";
export const VERSION = "0.1.0";

const BLOCKED = ["promptfun", "prompt fun", "promptfunfun", "promptfun.fun"];

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const MAJOR_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT", "ETH", "WETH", "BTC", "WBTC", "BNB", "POL", "MATIC", "DAI", "ARB", "OP"]);

/** Exact symbol of a major native or stable token; launching one would mislead buyers. */
export function isMajorSymbol(symbol: string): boolean {
  return MAJOR_SYMBOLS.has(symbol.trim().toUpperCase());
}

/** A launch may not pass itself off as the platform. */
export function impersonatesBrand(...values: Array<string | undefined>): boolean {
  return values.some((value) => {
    if (!value) return false;
    const flat = squash(value);
    return BLOCKED.some((name) => flat.includes(squash(name)));
  });
}

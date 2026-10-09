import type { Chain } from "./types.js";

export function buildShareText(input: {
  chain: Chain;
  name: string;
  symbol: string;
  address: string;
  explorer: string | null;
}): { text: string; intentUrl: string } {
  const badge = input.chain.testnet ? " Test coin, no market value." : "";
  const explorerLine = input.explorer ? `\n${input.explorer}` : "";
  const text =
    `I just launched $${input.symbol} (${input.name}) on ${input.chain.name} from a Claude chat with promptfun.fun.${badge}\n\n` +
    `CA: ${input.address}${explorerLine}`;
  const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
  return { text, intentUrl };
}

/** X counts some wide chars as two; keep under 280 weighted length. */
export function shareWithinLimit(text: string, max = 280): boolean {
  let w = 0;
  for (const ch of text) {
    w += ch.codePointAt(0)! > 0xffff ? 2 : 1;
    if (w > max) return false;
  }
  return true;
}

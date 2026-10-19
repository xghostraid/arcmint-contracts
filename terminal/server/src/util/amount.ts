export function parseUnits(value: string | number, decimals: number): bigint {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount "${value}"`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Amount "${value}" has more than ${decimals} decimals`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: bigint, decimals: number, maxFrac = decimals): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const sol = (lamports: bigint) => formatUnits(lamports, 9, 6);
export const toLamports = (s: string | number) => parseUnits(s, 9);

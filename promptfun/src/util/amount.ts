const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export class AmountError extends Error {}

/** Parse a human decimal string ("1.5") into base units. Rejects exponents, signs, and excess precision. */
export function parseUnits(text: string, decimals: number): bigint {
  const raw = String(text ?? "").trim().replace(/_/g, "").replace(/,/g, "");
  if (!DECIMAL.test(raw)) throw new AmountError(`"${text}" is not a plain decimal amount.`);
  const [whole, fraction = ""] = raw.split(".");
  const frac = fraction.replace(/^\./, "");
  if (frac.length > decimals) {
    throw new AmountError(`"${text}" has more than ${decimals} decimal places.`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeText}${frac ? `.${frac}` : ""}`;
}

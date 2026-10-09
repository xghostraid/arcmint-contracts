export const DASH = "\u2013";

function trim(value, digits) {
  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

export function formatSol(value) {
  if (value == null || !Number.isFinite(Number(value))) return DASH;
  const n = Number(value);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 3 : 4;
  return trim(n, digits);
}

function formatScaled(whole, unit, digits) {
  const scale = 10n ** BigInt(digits);
  const scaled = (whole * scale + unit / 2n) / unit;
  const q = scaled / scale;
  const r = scaled % scale;
  if (r === 0n) return q.toString();
  const frac = r.toString().padStart(digits, "0").replace(/0+$/, "");
  return `${q}.${frac}`;
}

function withFrac(whole, frac, digits) {
  const scale = 10n ** BigInt(digits);
  const rounded = (frac * scale + 500_000n) / 1_000_000n;
  if (rounded >= scale) return (whole + rounded / scale).toString();
  if (rounded === 0n) return whole.toString();
  const fracText = rounded.toString().padStart(digits, "0").replace(/0+$/, "");
  return `${whole}.${fracText}`;
}

export function formatTokens(raw) {
  let bi;
  try {
    bi = BigInt(String(raw ?? "0"));
  } catch {
    return "0";
  }
  const neg = bi < 0n;
  if (neg) bi = -bi;
  const whole = bi / 1_000_000n;
  const frac = bi % 1_000_000n;
  let out;
  if (whole >= 1_000_000n) out = `${formatScaled(whole, 1_000_000n, 2)}M`;
  else if (whole >= 1_000n) out = `${formatScaled(whole, 1_000n, 1)}k`;
  else if (whole === 0n && frac === 0n) out = "0";
  else if (whole >= 100n) out = whole.toString();
  else if (whole >= 1n) out = withFrac(whole, frac, 2);
  else out = withFrac(0n, frac, 4);
  return neg ? `-${out}` : out;
}

export function formatCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000, 2)}k`;
  return trim(n, abs >= 100 ? 0 : 2);
}

export function formatCap(coin) {
  if (coin.marketCapUsd != null && Number.isFinite(Number(coin.marketCapUsd))) {
    return `$${formatCompact(coin.marketCapUsd)}`;
  }
  if (coin.marketCapSol != null && Number.isFinite(Number(coin.marketCapSol))) {
    return `${formatSol(coin.marketCapSol)} SOL`;
  }
  return DASH;
}

export function formatPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return DASH;
  const n = Number(value);
  const body = trim(Math.abs(n), Math.abs(n) >= 100 ? 0 : 2);
  if (n > 0) return `+${body}%`;
  if (n < 0) return `\u2212${body}%`;
  return `${body}%`;
}

export function pctClass(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) === 0) return "";
  return Number(value) > 0 ? "up" : "down";
}

export function formatAge(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const seconds = Math.max(0, (now - t) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day} ${hh}:${mm} UTC`;
}

export function shorten(value, head = 4, tail = 4) {
  if (!value) return DASH;
  const text = String(value);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}\u2026${text.slice(-tail)}`;
}

export function marqueeLine(status) {
  const state = status.launchesOn ? "Launches on" : "Launches paused";
  const paid = formatSol(status.paidToCreatorsSol);
  const burned = formatTokens(status.tokensBurned);
  return `${state} · ${status.coins} coins · ${paid} SOL paid · ${burned} burned`;
}

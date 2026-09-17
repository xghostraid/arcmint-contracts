export function shortenAddress(addr: string, size = 4): string {
  if (!addr || addr.length < 10) return addr || "—";
  return `${addr.slice(0, size + 2)}…${addr.slice(-size)}`;
}

export function formatUsdFromMicro(value: string | number | bigint): string {
  const n = Number(value) / 1e6;
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "just now";
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

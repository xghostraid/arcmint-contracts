export function safeImage(src) {
  if (!src || typeof src !== "string") return null;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  try {
    const url = new URL(src);
    if (url.protocol === "https:") return src;
  } catch {
    return null;
  }
  return null;
}

export function showVolume(coins) {
  return coins.some((coin) => coin.volume24hUsd != null);
}

export function searchCoins(coins, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return coins.slice();
  return coins.filter((coin) =>
    String(coin.name).toLowerCase().includes(needle) ||
    String(coin.ticker).toLowerCase().includes(needle) ||
    String(coin.mint).toLowerCase().includes(needle)
  );
}

function capRank(coin) {
  if (coin.marketCapSol != null && Number.isFinite(Number(coin.marketCapSol))) {
    return [2, Number(coin.marketCapSol)];
  }
  if (coin.marketCapUsd != null && Number.isFinite(Number(coin.marketCapUsd))) {
    return [1, Number(coin.marketCapUsd)];
  }
  return [0, 0];
}

function byCreated(a, b) {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export function sortCoins(coins, mode) {
  const rows = coins.slice();
  if (mode === "top") {
    rows.sort((a, b) => {
      const [aLevel, aValue] = capRank(a);
      const [bLevel, bValue] = capRank(b);
      if (aLevel !== bLevel) return bLevel - aLevel;
      if (aValue !== bValue) return bValue - aValue;
      return byCreated(a, b);
    });
    return rows;
  }
  if (mode === "paid") {
    rows.sort((a, b) => (Number(b.paidToCreatorSol) - Number(a.paidToCreatorSol)) || byCreated(a, b));
    return rows;
  }
  rows.sort(byCreated);
  return rows;
}

(() => {
  const fmtAmount = (value, symbol) => {
    if (value == null || value === "") return { text: "n/a", title: "Not available from the chain yet." };
    return { text: `${value} ${symbol || ""}`.trim(), title: "" };
  };

  const formatCompactUsd = (raw) => {
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) return `$${raw}`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const fmtCap = (coin) => {
    const m = coin.market || {};
    if (m.marketCapUsd != null) {
      const exact = `$${m.marketCapUsd}`;
      return {
        text: formatCompactUsd(m.marketCapUsd),
        title: [exact, m.source].filter(Boolean).join(" · "),
      };
    }
    if (m.marketCapNative != null) {
      const sym = coin.chain?.nativeSymbol || "";
      return { text: `${m.marketCapNative} ${sym}`.trim(), title: m.reason || m.source || "" };
    }
    return { text: "n/a", title: m.reason || "No market data for this coin." };
  };

  window.promptfunExploreFormat = { fmtAmount, fmtCap, formatCompactUsd };
})();

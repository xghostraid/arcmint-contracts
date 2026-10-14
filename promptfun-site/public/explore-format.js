(() => {
  const fmtAmount = (value, symbol) => {
    if (value == null || value === "") return { text: "n/a", title: "Not available from the chain yet." };
    return { text: `${value} ${symbol || ""}`.trim(), title: "" };
  };

  const fmtCap = (coin) => {
    const m = coin.market || {};
    if (m.marketCapUsd != null) return { text: `$${m.marketCapUsd}`, title: m.source || "" };
    if (m.marketCapNative != null) {
      const sym = coin.chain?.nativeSymbol || "";
      return { text: `${m.marketCapNative} ${sym}`.trim(), title: m.reason || m.source || "" };
    }
    return { text: "n/a", title: m.reason || "No market data for this coin." };
  };

  window.promptfunExploreFormat = { fmtAmount, fmtCap };
})();

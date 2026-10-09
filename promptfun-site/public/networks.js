(() => {
  const panel = document.querySelector("[data-networks-panel]");
  if (!panel) return;

  const origin = document.documentElement.dataset.apiOrigin || window.location.origin;
  const labelFor = (state, testnet) => {
    if (state === "live") return testnet ? "Live · testnet" : "Live";
    if (state === "soon") return "Coming soon";
    return "Unavailable";
  };
  const classFor = (state) => {
    if (state === "live") return "status status-live";
    if (state === "soon") return "status status-soon";
    return "status status-building";
  };

  const apply = (chains) => {
    const byKey = Object.fromEntries(chains.map((c) => [c.key, c]));
    for (const row of panel.querySelectorAll("[data-chain-key]")) {
      const key = row.getAttribute("data-chain-key");
      const chip = row.querySelector("[data-network-chip]");
      if (!key || !chip) continue;
      const chain = byKey[key];
      if (!chain) continue;
      chip.className = classFor(chain.siteState);
      chip.textContent = labelFor(chain.siteState, chain.testnet);
      chip.title = chain.disabledReason || "";
    }
    panel.dataset.state = "live";
  };

  fetch(`${origin}/api/networks`, { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((data) => apply(data.chains || []))
    .catch(() => {
      panel.dataset.state = "static";
    });
})();

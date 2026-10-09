(() => {
  const root = document.querySelector("[data-explore]");
  if (!root) return;

  const origin = document.documentElement.dataset.apiOrigin || window.location.origin;
  const statusEl = root.querySelector("[data-explore-status]");
  const tbody = root.querySelector("[data-explore-rows]");
  const emptyEl = root.querySelector("[data-explore-empty]");
  const searchInput = root.querySelector("[data-explore-search]");
  const tabs = [...root.querySelectorAll("[data-explore-sort]")];

  let sort = "new";
  let query = "";
  let loading = false;

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

  const fmtPaid = (coin) => {
    const f = coin.creatorFees || {};
    const row = fmtAmount(f.paid, f.symbol);
    if (row.text === "n/a" && f.reason) row.title = f.reason;
    return row;
  };

  const age = (iso) => {
    if (!iso) return "n/a";
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return "n/a";
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  const renderRows = (coins) => {
    tbody.replaceChildren();
    if (!coins.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    for (const coin of coins) {
      const tr = document.createElement("tr");
      const cap = fmtCap(coin);
      const paid = fmtPaid(coin);
      const badge = coin.chain?.testnet
        ? `<span class="status status-testing">${coin.chain.key.replace("solana-", "Solana ").replace("-", " ")}</span>`
        : coin.chain?.key === "solana-mainnet"
          ? `<span class="status status-live">Mainnet</span>`
          : "";
      tr.innerHTML = `
        <th scope="row">
          <span class="coin-name">${coin.name}</span>
          <span class="coin-meta">$${coin.symbol}${badge ? ` ${badge}` : ""}</span>
        </th>
        <td data-label="Market cap" title="${cap.title.replace(/"/g, "&quot;")}">${cap.text}</td>
        <td data-label="Age">${age(coin.launchedAt)}</td>
        <td data-label="Paid to creator" title="${paid.title.replace(/"/g, "&quot;")}">${paid.text}</td>
      `;
      tbody.appendChild(tr);
    }
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    setStatus("Loading coins from the public API…");
    emptyEl.hidden = true;
    try {
      const params = new URLSearchParams({ sort, limit: "50" });
      if (query) params.set("q", query);
      const res = await fetch(`${origin}/api/coins?${params}`, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The coins API returned ${res.status}.`);
      }
      const data = await res.json();
      renderRows(data.coins || []);
      setStatus(
        data.total
          ? `${data.total} coin${data.total === 1 ? "" : "s"} from promptfun launches. Numbers are read from the chain; n/a means we could not read that value.`
          : "The API is up, but no promptfun launches are listed yet.",
      );
    } catch (err) {
      tbody.replaceChildren();
      emptyEl.hidden = false;
      emptyEl.textContent =
        err.message === "Failed to fetch"
          ? "No public coins API is reachable from this site yet. When the MCP server is live on the same host, this board fills automatically. Until then, nothing is shown here on purpose."
          : err.message;
      setStatus("Could not load live coins.");
    } finally {
      loading = false;
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      sort = tab.dataset.exploreSort || "new";
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      load();
    });
  });

  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = searchInput.value.trim();
        load();
      }, 320);
    });
  }

  load();
})();

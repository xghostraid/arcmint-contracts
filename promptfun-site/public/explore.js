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

  const shortCa = (address) => {
    if (!address || address.length < 12) return address || "n/a";
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  };

  const copyCaLabel = (coin) => {
    const who = coin.name || coin.symbol || "token";
    if (coin.chain?.family === "evm") return `Copy contract address for ${who}`;
    return `Copy mint address for ${who}`;
  };

  const copyText = async (text, fallbackEl) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      if (!fallbackEl) return false;
      const range = document.createRange();
      range.selectNodeContents(fallbackEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      try {
        document.execCommand("copy");
      } catch {
        return false;
      }
      sel?.removeAllRanges();
      return true;
    }
  };

  const attachCopyCa = (btn, fullAddress, codeEl) => {
    const defaultLabel = btn.textContent;
    btn.addEventListener("click", async () => {
      if (!fullAddress) return;
      const ok = await copyText(fullAddress, codeEl);
      if (!ok) return;
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
      btn.setAttribute("aria-live", "polite");
      window.setTimeout(() => {
        btn.textContent = defaultLabel;
        btn.classList.remove("is-copied");
      }, 2000);
    });
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
      const chartCell = document.createElement("td");
      chartCell.dataset.label = "Chart";
      const pts = coin.market?.chartPoints;
      if (window.promptfunSparkline) {
        chartCell.appendChild(
          window.promptfunSparkline.sparklineSvg(pts, {
            label: pts ? `${coin.symbol} bonding-curve trend` : "Chart unavailable",
          }),
        );
      } else {
        chartCell.textContent = "—";
      }
      const th = document.createElement("th");
      th.scope = "row";
      const head = document.createElement("div");
      head.className = "coin-row-head";
      if (coin.imageUrl && /^https:\/\//i.test(coin.imageUrl)) {
        const img = document.createElement("img");
        img.className = "coin-thumb";
        img.src = coin.imageUrl;
        img.alt = "";
        img.width = 40;
        img.height = 40;
        img.loading = "lazy";
        img.decoding = "async";
        head.appendChild(img);
      } else {
        const ph = document.createElement("span");
        ph.className = "coin-thumb coin-thumb--placeholder";
        ph.setAttribute("aria-hidden", "true");
        ph.textContent = (coin.symbol || "?").slice(0, 2).toUpperCase();
        head.appendChild(ph);
      }
      const textWrap = document.createElement("div");
      textWrap.className = "coin-row-text";
      textWrap.innerHTML = `
          <span class="coin-name">${coin.name}</span>
          <span class="coin-meta">$${coin.symbol}${badge ? ` ${badge}` : ""}</span>
        `;
      head.appendChild(textWrap);
      th.appendChild(head);
      tr.appendChild(th);

      const caTd = document.createElement("td");
      caTd.dataset.label = "CA";
      const caWrap = document.createElement("div");
      caWrap.className = "coin-ca";
      const fullAddress = coin.address || "";
      const code = document.createElement("code");
      code.className = "coin-ca-text";
      code.title = fullAddress || "Address not available";
      code.textContent = shortCa(fullAddress);
      caWrap.appendChild(code);
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-small copy-ca-btn";
      copyBtn.textContent = "Copy CA";
      copyBtn.setAttribute("aria-label", copyCaLabel(coin));
      if (!fullAddress) {
        copyBtn.disabled = true;
      } else {
        attachCopyCa(copyBtn, fullAddress, code);
      }
      caWrap.appendChild(copyBtn);
      caTd.appendChild(caWrap);
      tr.appendChild(caTd);

      tr.appendChild(chartCell);
      const capTd = document.createElement("td");
      capTd.dataset.label = "Market cap";
      capTd.title = cap.title;
      capTd.textContent = cap.text;
      tr.appendChild(capTd);
      const ageTd = document.createElement("td");
      ageTd.dataset.label = "Age";
      ageTd.textContent = age(coin.launchedAt);
      tr.appendChild(ageTd);
      const paidTd = document.createElement("td");
      paidTd.dataset.label = "Paid to creator";
      paidTd.title = paid.title;
      paidTd.textContent = paid.text;
      tr.appendChild(paidTd);
      tbody.appendChild(tr);
    }
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    setStatus("Loading coins from the public API…");
    emptyEl.hidden = true;
    try {
      const params = new URLSearchParams({ sort, limit: "50", network: "mainnet" });
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

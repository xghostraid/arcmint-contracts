(() => {
  const root = document.querySelector("[data-explore-coin]");
  if (!root) return;

  const origin = document.documentElement.dataset.apiOrigin || window.location.origin;
  const fmt = window.promptfunExploreFormat;
  const statusEl = root.querySelector("[data-coin-status]");
  const titleEl = root.querySelector("[data-coin-title]");
  const metaEl = root.querySelector("[data-coin-meta]");
  const mcapEl = root.querySelector("[data-coin-mcap]");
  const chartSlot = root.querySelector("[data-coin-chart]");
  const thumbEl = root.querySelector("[data-coin-thumb]");
  const linksEl = root.querySelector("[data-coin-links]");
  const caCode = root.querySelector("[data-coin-ca]");
  const copyBtn = root.querySelector("[data-copy-ca]");

  const pathMatch = /^\/explore\/coin\/([^/?#]+)/.exec(window.location.pathname);
  const queryId = new URLSearchParams(window.location.search).get("id");
  const coinId = pathMatch ? decodeURIComponent(pathMatch[1]) : queryId;

  let pollTimer = null;
  let coinDetail = null;

  const setStatus = (msg) => {
    if (statusEl) statusEl.textContent = msg;
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

  const shortCa = (address) => {
    if (!address || address.length < 12) return address || "n/a";
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  };

  const renderMcap = (coin) => {
    if (!mcapEl || !fmt) return;
    const cap = fmt.fmtCap(coin);
    mcapEl.textContent = cap.text;
    mcapEl.title = cap.title;
    mcapEl.dataset.live = "true";
  };

  const renderChart = (coin) => {
    if (!chartSlot || !window.promptfunBondChart) return;
    chartSlot.replaceChildren();
    const series = coin.market?.chartSeries || null;
    const fallback =
      coin.market?.chartPoints?.map((pct, i, arr) => ({
        progressPct: arr.length > 1 ? (i / (arr.length - 1)) * 100 : 0,
        marketCapNative: coin.market?.marketCapNative ?? "0",
      })) ?? null;
    const svg = window.promptfunBondChart.lineChartSvg(series || fallback, {
      nativeSymbol: coin.chain?.nativeSymbol || "SOL",
      label: `${coin.symbol} bonding curve market cap`,
    });
    chartSlot.appendChild(svg);
  };

  const renderLinks = (coin) => {
    if (!linksEl) return;
    linksEl.replaceChildren();
    const add = (href, text) => {
      if (!href) return;
      const a = document.createElement("a");
      a.className = "btn btn-small";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = text;
      linksEl.appendChild(a);
    };
    add(coin.links?.pumpfun, "View on pump.fun");
    add(coin.links?.pons, "View on Pons");
    add(coin.links?.explorer, "Explorer");
  };

  const render = (coin) => {
    coinDetail = coin;
    if (titleEl) titleEl.textContent = coin.name;
    if (metaEl) {
      metaEl.textContent = `$${coin.symbol} · ${coin.chain?.testnet ? coin.chain.name : "Mainnet"}`;
    }
    renderMcap(coin);
    renderChart(coin);
    renderLinks(coin);

    if (thumbEl) {
      thumbEl.replaceChildren();
      if (coin.imageUrl && /^https:\/\//i.test(coin.imageUrl)) {
        const img = document.createElement("img");
        img.className = "coin-detail-thumb";
        img.src = coin.imageUrl;
        img.alt = "";
        img.width = 96;
        img.height = 96;
        thumbEl.appendChild(img);
      } else {
        const ph = document.createElement("span");
        ph.className = "coin-detail-thumb coin-detail-thumb--placeholder";
        ph.textContent = (coin.symbol || "?").slice(0, 2).toUpperCase();
        thumbEl.appendChild(ph);
      }
    }

    if (caCode) {
      caCode.textContent = shortCa(coin.address);
      caCode.title = coin.address || "";
    }
    if (copyBtn && coin.address) {
      copyBtn.disabled = false;
      copyBtn.onclick = async () => {
        const ok = await copyText(coin.address, caCode);
        if (!ok) return;
        copyBtn.textContent = "Copied";
        window.setTimeout(() => {
          copyBtn.textContent = "Copy CA";
        }, 2000);
      };
    }
    setStatus(
      coin.market?.source
        ? `${coin.market.source}. Chart is synthetic curve progress, not trade history.`
        : "Market data unavailable.",
    );
  };

  const load = async (quiet) => {
    if (!coinId) {
      setStatus("No coin id in the URL.");
      return;
    }
    if (!quiet) setStatus("Loading coin from the public API…");
    try {
      const res = await fetch(`${origin}/api/coins/${encodeURIComponent(coinId)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The coin API returned ${res.status}.`);
      }
      const coin = await res.json();
      render(coin);
    } catch (err) {
      setStatus(err.message === "Failed to fetch" ? "Could not reach the coins API." : err.message);
    }
  };

  if (copyBtn) copyBtn.disabled = true;

  load(false);
  pollTimer = window.setInterval(() => load(true), 20_000);
  window.addEventListener("pagehide", () => {
    if (pollTimer) window.clearInterval(pollTimer);
  });
})();

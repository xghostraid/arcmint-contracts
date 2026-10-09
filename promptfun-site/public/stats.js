(() => {
  const band = document.querySelector("[data-live-stats]");
  if (!band) return;

  const origin = document.documentElement.dataset.apiOrigin || window.location.origin;
  const items = [...band.querySelectorAll("[data-stat-value]")];

  const set = (key, text, reason) => {
    const el = band.querySelector(`[data-stat-value="${key}"]`);
    if (!el) return;
    el.textContent = text;
    if (reason) el.title = reason;
  };

  fetch(`${origin}/api/stats`, { headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((data) => {
      set("coins", data.coins != null ? String(data.coins) : "n/a", data.coins == null ? "Stats API did not return a coin count." : "");
      const paid = (data.creatorFeesPaid || [])[0];
      if (paid && paid.amount != null) {
        set("paid", `${paid.amount} ${paid.symbol || "SOL"}`, paid.complete === false ? "Still scanning payout history; total may rise." : "");
      } else {
        set("paid", "n/a", "No creator fees counted yet.");
      }
      band.dataset.state = "live";
    })
    .catch(() => {
      set("coins", "n/a", "Public stats are not available from this host yet.");
      set("paid", "n/a", "Public stats are not available from this host yet.");
      band.dataset.state = "empty";
    });
})();

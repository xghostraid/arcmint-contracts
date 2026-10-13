(() => {
  const NS = "http://www.w3.org/2000/svg";

  function sparklineSvg(points, { width = 88, height = 28, label = "Price trend from bonding curve" } = {}) {
    if (!points || !points.length) {
      const g = document.createElementNS(NS, "svg");
      g.setAttribute("width", String(width));
      g.setAttribute("height", String(height));
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", "No chart data");
      g.classList.add("sparkline", "sparkline-empty");
      return g;
    }
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    svg.classList.add("sparkline");
    const pad = 2;
    const barW = (width - pad * 2) / points.length - 1;
    points.forEach((pct, i) => {
      const h = Math.max(2, ((height - pad * 2) * pct) / 100);
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", String(pad + i * (barW + 1)));
      rect.setAttribute("y", String(height - pad - h));
      rect.setAttribute("width", String(Math.max(2, barW)));
      rect.setAttribute("height", String(h));
      rect.setAttribute("rx", "1.5");
      svg.appendChild(rect);
    });
    return svg;
  }

  window.promptfunSparkline = { sparklineSvg };
})();

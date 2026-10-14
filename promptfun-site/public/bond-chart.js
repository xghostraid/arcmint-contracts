(() => {
  const NS = "http://www.w3.org/2000/svg";

  function parseNative(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Line chart of synthetic bonding-curve mcap (progressPct → marketCapNative).
   * Not historical trades — reserves interpolated from launch to now.
   */
  function lineChartSvg(series, { width = 640, height = 240, nativeSymbol = "SOL", label } = {}) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.classList.add("bond-chart");
    svg.setAttribute(
      "aria-label",
      label || `Bonding curve market cap in ${nativeSymbol}, synthetic curve from on-chain reserves`,
    );

    if (!series || !series.length) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", "16");
      t.setAttribute("y", String(height / 2));
      t.setAttribute("class", "bond-chart-empty");
      t.textContent = "No bonding curve data";
      svg.appendChild(t);
      return svg;
    }

    const pad = { l: 52, r: 16, t: 16, b: 36 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const values = series.map((p) => parseNative(p.marketCapNative)).filter((v) => v != null);
    const minV = values.length ? Math.min(...values) : 0;
    const maxV = values.length ? Math.max(...values) : 1;
    const span = maxV - minV || maxV || 1;

    const xAt = (pct) => pad.l + (pct / 100) * innerW;
    const yAt = (v) => pad.t + innerH - ((v - minV) / span) * innerH;

    const grid = document.createElementNS(NS, "g");
    grid.setAttribute("class", "bond-chart-grid");
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (innerH * i) / 4;
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", String(pad.l));
      line.setAttribute("x2", String(width - pad.r));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      grid.appendChild(line);
      const val = maxV - (span * i) / 4;
      const tick = document.createElementNS(NS, "text");
      tick.setAttribute("x", String(pad.l - 8));
      tick.setAttribute("y", String(y + 4));
      tick.setAttribute("class", "bond-chart-axis");
      tick.setAttribute("text-anchor", "end");
      tick.textContent = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(val < 10 ? 2 : 1);
      grid.appendChild(tick);
    }
    svg.appendChild(grid);

    const axisX = document.createElementNS(NS, "text");
    axisX.setAttribute("x", String(pad.l + innerW / 2));
    axisX.setAttribute("y", String(height - 8));
    axisX.setAttribute("class", "bond-chart-axis");
    axisX.setAttribute("text-anchor", "middle");
    axisX.textContent = "Curve progress (launch reserves → now)";
    svg.appendChild(axisX);

    const axisY = document.createElementNS(NS, "text");
    axisY.setAttribute("x", "12");
    axisY.setAttribute("y", String(pad.t + innerH / 2));
    axisY.setAttribute("class", "bond-chart-axis");
    axisY.setAttribute("transform", `rotate(-90 12 ${pad.t + innerH / 2})`);
    axisY.setAttribute("text-anchor", "middle");
    axisY.textContent = `Mcap (${nativeSymbol})`;
    svg.appendChild(axisY);

    let d = "";
    series.forEach((pt, i) => {
      const v = parseNative(pt.marketCapNative);
      if (v == null) return;
      const x = xAt(pt.progressPct);
      const y = yAt(v);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "bond-chart-line");
    path.setAttribute("fill", "none");
    svg.appendChild(path);

    const area = document.createElementNS(NS, "path");
    const last = series[series.length - 1];
    const lastV = parseNative(last.marketCapNative);
    if (lastV != null) {
      area.setAttribute(
        "d",
        `${d} L ${xAt(last.progressPct)} ${pad.t + innerH} L ${xAt(series[0].progressPct)} ${pad.t + innerH} Z`,
      );
      area.setAttribute("class", "bond-chart-area");
      svg.insertBefore(area, path);
    }

    return svg;
  }

  window.promptfunBondChart = { lineChartSvg };
})();

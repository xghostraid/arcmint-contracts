import assert from "node:assert/strict";
import { test } from "node:test";
import { bondingCurveChart, chartPointsFromBondingCurve } from "../../src/chains/solana/pump-market.js";

const curveInput = {
  mintSupply: 1_000_000_000_000_000n,
  virtualTokenReserves: 800_000_000_000_000n,
  virtualQuoteReserves: 40_000_000_000n,
  initialVirtualQuoteReserves: 30_000_000_000n,
};

test("chartPointsFromBondingCurve returns 12 ascending bars along the curve", () => {
  const points = chartPointsFromBondingCurve(curveInput);
  assert.equal(points.length, 12);
  assert.ok(points[0] <= points[11], "later bars should be at least as tall as early bars");
  assert.ok(points.every((p) => p >= 4 && p <= 100));
});

test("bondingCurveChart returns higher-resolution series for detail charts", () => {
  const chart = bondingCurveChart(curveInput, 80);
  assert.equal(chart.points.length, 80);
  assert.equal(chart.series.length, 80);
  assert.equal(chart.series[0]!.progressPct, 0);
  assert.equal(chart.series[79]!.progressPct, 100);
  assert.match(chart.series[0]!.marketCapNative, /^\d/);
});

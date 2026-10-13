import assert from "node:assert/strict";
import { test } from "node:test";
import { chartPointsFromBondingCurve } from "../../src/chains/solana/pump-market.js";

test("chartPointsFromBondingCurve returns 12 ascending bars along the curve", () => {
  const points = chartPointsFromBondingCurve({
    mintSupply: 1_000_000_000_000_000n,
    virtualTokenReserves: 800_000_000_000_000n,
    virtualQuoteReserves: 40_000_000_000n,
    initialVirtualQuoteReserves: 30_000_000_000n,
  });
  assert.equal(points.length, 12);
  assert.ok(points[0] <= points[11], "later bars should be at least as tall as early bars");
  assert.ok(points.every((p) => p >= 4 && p <= 100));
});

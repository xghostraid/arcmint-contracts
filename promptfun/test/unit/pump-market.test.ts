import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartPointsFromBondingCurve,
  marketFromPumpfunApiRow,
} from "../../src/chains/solana/pump-market.js";

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

test("marketFromPumpfunApiRow uses pump.fun usd_market_cap and SOL quote cap", () => {
  const row = marketFromPumpfunApiRow({
    mint: "385pCEMj4T1rTp2vgCVxmuUR2zTTmqkV6Yu3U96Fpump",
    complete: false,
    usd_market_cap: 3310.7814885906455,
    market_cap_quote: 30.898740473824184,
  });
  assert.ok(row);
  assert.equal(row.marketCapUsd, "3310.78");
  assert.equal(row.marketCapNative, "30.89874");
  assert.match(row.source, /frontend API/);
  assert.equal(row.graduated, false);
});

test("marketFromPumpfunApiRow accepts market_cap_usd alias", () => {
  const row = marketFromPumpfunApiRow({
    mint: "x",
    market_cap_usd: 12.4,
    market_cap: 0.001,
  });
  assert.ok(row);
  assert.equal(row.marketCapUsd, "12.40");
});

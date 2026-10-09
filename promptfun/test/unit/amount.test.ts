import assert from "node:assert/strict";
import { test } from "node:test";
import { AmountError, formatUnits, parseUnits } from "../../src/util/amount.js";

test("parseUnits converts decimal strings exactly", () => {
  assert.equal(parseUnits("1", 9), 1_000_000_000n);
  assert.equal(parseUnits("0.000000001", 9), 1n);
  assert.equal(parseUnits("1,234.5", 6), 1_234_500_000n);
  assert.equal(parseUnits("1_000", 0), 1000n);
  assert.equal(parseUnits("0", 9), 0n);
});

test("parseUnits rejects anything that is not a plain decimal", () => {
  for (const bad of ["", "-1", "1e9", "0x10", "01", "1.", ".5", "abc", "1.2.3", " "]) {
    assert.throws(() => parseUnits(bad, 9), AmountError, bad);
  }
  assert.throws(() => parseUnits("0.0000000001", 9), /more than 9 decimal places/);
});

test("formatUnits groups thousands and trims zeros", () => {
  assert.equal(formatUnits(1_234_500_000n, 6), "1,234.5");
  assert.equal(formatUnits(5000n, 9), "0.000005");
  assert.equal(formatUnits(0n, 9), "0");
  assert.equal(formatUnits(10n ** 18n, 6), "1,000,000,000,000");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import "../../src/chains/index.js";
import { loadConfig } from "../../src/config.js";
import { networksPayload, siteNetworkState } from "../../src/api/networks.js";
import { findChain } from "../../src/chains/registry.js";

test("production public networks API omits EVM testnets and marks Solana mainnet live", () => {
  const config = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_PUMPFUN_DEVNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
  });
  const payload = networksPayload(config);
  const byKey = Object.fromEntries(payload.chains.map((c) => [c.key, c]));
  assert.equal(byKey["solana-mainnet"].siteState, "live");
  assert.equal(byKey["solana-devnet"].siteState, "live");
  assert.equal(byKey["robinhood-testnet"], undefined);
  assert.equal(byKey["ethereum-sepolia"], undefined);
  assert.equal(byKey["ethereum"].siteState, "soon");
  assert.equal(payload.recommendedLaunchChain, "solana-mainnet");
  assert.match(payload.evmWalletFeeNote, /does not sponsor EVM gas/);
});

test("Robinhood mainnet in public API includes wallet fee note when live", () => {
  const config = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1",
  });
  const rh = networksPayload(config).chains.find((c) => c.key === "robinhood");
  assert.equal(rh?.siteState, "live");
  assert.match(rh?.walletFeeNote ?? "", /does not sponsor EVM gas/);
});

test("siteNetworkState respects disabled mainnet flag", () => {
  const config = loadConfig({});
  const mainnet = findChain(config, "solana-mainnet")!;
  assert.equal(siteNetworkState(mainnet), "soon");
});

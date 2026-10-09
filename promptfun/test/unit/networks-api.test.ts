import { test } from "node:test";
import assert from "node:assert/strict";
import "../../src/chains/index.js";
import { loadConfig } from "../../src/config.js";
import { networksPayload, siteNetworkState } from "../../src/api/networks.js";
import { findChain } from "../../src/chains/registry.js";

test("production config marks mainnet, devnet and EVM testnets live on site", () => {
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
  assert.equal(byKey["robinhood-testnet"].siteState, "live");
  assert.equal(byKey["ethereum-sepolia"].siteState, "live");
  assert.equal(byKey["ethereum"].siteState, "soon");
  assert.equal(payload.recommendedLaunchChain, "solana-mainnet");
});

test("siteNetworkState respects disabled mainnet flag", () => {
  const config = loadConfig({});
  const mainnet = findChain(config, "solana-mainnet")!;
  assert.equal(siteNetworkState(mainnet), "soon");
});

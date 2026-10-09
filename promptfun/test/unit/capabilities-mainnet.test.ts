import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";
import { chainAllowsSponsoredLaunch, sponsorBudgetSnapshot } from "../../src/sponsor/budget.js";
import { chainsForCapabilities, findChain, recommendedLaunchChainKey } from "../../src/chains/registry.js";

test("mainnet production config recommends solana-mainnet first", () => {
  const config = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
  });
  assert.equal(recommendedLaunchChainKey(config), "solana-mainnet");
  const keys = chainsForCapabilities(config).map((c) => c.key);
  assert.equal(keys[0], "solana-mainnet");
  const mainnet = findChain(config, "solana-mainnet")!;
  assert.equal(mainnet.disabledReason, undefined);
  assert.equal(mainnet.status, "verified");
});

test("sponsored mainnet stays gated unless explicitly enabled", () => {
  const config = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
  });
  const mainnet = findChain(config, "solana-mainnet")!;
  const devnet = findChain(config, "solana-devnet")!;
  assert.equal(chainAllowsSponsoredLaunch(mainnet, config), false);
  assert.equal(chainAllowsSponsoredLaunch(devnet, config), true);
  const snap = sponsorBudgetSnapshot(config);
  assert.equal(snap.sponsoredMainnetEnabled, false);
  assert.equal(snap.sponsoredTestnetsEnabled, true);

  const sponsoredMainnet = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_ENABLE_SPONSORED_MAINNET: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
  });
  assert.equal(chainAllowsSponsoredLaunch(mainnet, sponsoredMainnet), true);
  assert.equal(sponsorBudgetSnapshot(sponsoredMainnet).sponsoredMainnetEnabled, true);
  assert.match(findChain(sponsoredMainnet, "solana-mainnet")!.evidence, /sponsored pump.fun on Solana mainnet/);
});

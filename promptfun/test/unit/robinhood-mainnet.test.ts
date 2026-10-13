import { test } from "node:test";
import assert from "node:assert/strict";
import "../../src/chains/index.js";
import { loadConfig } from "../../src/config.js";
import { networksPayload } from "../../src/api/networks.js";
import { findChain, recommendedLaunchChainKey } from "../../src/chains/registry.js";
import { exampleUserPrompts, launchPlaybook } from "../../src/mcp/launch-playbook.js";
import { IntentService } from "../../src/intents/service.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";
import { openMemoryStores } from "../../src/db/test-helpers.js";

const prodPump = {
  PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
  PROMPTFUN_ENABLE_SPONSORED_MAINNET: "1",
  PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
  PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
};

test("Robinhood mainnet flag enables chain 4663 without other EVM mainnets", () => {
  const config = loadConfig({ ...prodPump, PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1" });
  const rh = findChain(config, "robinhood")!;
  assert.equal(rh.chainId, 4663);
  assert.equal(rh.disabledReason, undefined);
  assert.equal(rh.status, "verified");
  assert.match(rh.evidence, /real ETH/i);
  assert.match(rh.evidence, /does not sponsor EVM gas/);
  assert.match(findChain(config, "ethereum")!.disabledReason!, /EVM_MAINNETS/);
  assert.match(findChain(config, "base")!.disabledReason!, /EVM_MAINNETS/);
  assert.equal(recommendedLaunchChainKey(config), "solana-mainnet");
});

test("networks API marks robinhood mainnet live when flag on", () => {
  const on = loadConfig({ ...prodPump, PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1" });
  const off = loadConfig(prodPump);
  const live = networksPayload(on).chains.find((c) => c.key === "robinhood");
  const gated = networksPayload(off).chains.find((c) => c.key === "robinhood");
  assert.equal(live?.siteState, "live");
  assert.equal(live?.enabled, true);
  assert.equal(gated?.siteState, "soon");
  assert.equal(gated?.enabled, false);
});

test("get_capabilities playbook includes Robinhood wallet flow when enabled", () => {
  const config = loadConfig({ PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1" });
  const playbook = launchPlaybook(config);
  assert.ok(playbook.some((l) => /chain robinhood/i.test(l)));
  assert.ok(exampleUserPrompts(config).some((p) => /Robinhood Chain/i.test(p)));
});

test("prepare_transfer on robinhood mainnet when flag on", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1" });
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const { intents } = await openMemoryStores();
  const s = new IntentService(config, intents, pictures);
  const prep = await s.prepareTransfer({
    chain: "robinhood",
    asset: "native",
    amount: "0.001",
    to: "0x0000000000000000000000000000000000000001",
  });
  assert.equal(prep.status, "awaiting_wallet");
  assert.equal(prep.chain, "robinhood");
});

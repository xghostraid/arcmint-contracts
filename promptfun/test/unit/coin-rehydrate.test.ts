import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { IntentStore } from "../../src/intents/store.js";
import { CoinIndexStore } from "../../src/indexer/store.js";
import { CoinIndexService } from "../../src/indexer/service.js";
import type { IntentRemoteStore } from "../../src/intents/catalog.js";
import type { Intent } from "../../src/intents/types.js";
function mainnetLaunchIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    id: "int_pcat111111111111111111111111111111",
    kind: "launch_token",
    chain: "solana-mainnet",
    family: "solana",
    params: {
      name: "PCAT",
      symbol: "PCAT",
      supply: "1000000000",
      decimals: 6,
      description: "",
      metadataUri: "ipfs://x",
      fixedSupply: true,
      venue: "pumpfun",
    },
    summary: "launch",
    status: "confirmed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    built: null,
    submission: { id: "sigPCAT", submittedAt: new Date().toISOString() },
    receipt: {
      id: "sigPCAT",
      status: "success",
      slotOrBlock: 1,
      fee: "0.01",
      feeSymbol: "SOL",
      explorerUrl: null,
      verified: ["ok"],
      tokenAddress: "PCATmint111111111111111111111111111111111",
      tokenExplorerUrl: null,
      confirmedAt: "2026-10-13T12:00:00.000Z",
    },
    error: null,
    events: [],
    idempotencyKey: "pcat1",
    executionMode: "sponsor",
    instructionFingerprint: null,
    ...overrides,
  };
}

function mainnetLaunchIntentFromRemote(overrides: Partial<Intent> = {}): Intent {
  return mainnetLaunchIntent({
    ...overrides,
  });
}

test("prepareForPublicRead rehydrates confirmed mainnet launches from Blob when index is empty", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1" });
  const intents = new IntentStore(":memory:");
  const store = new CoinIndexStore(":memory:");
  const remote: IntentRemoteStore = {
    enabled: () => true,
    mirror: async () => {},
    load: async () => null,
    listMirrored: async () => [mainnetLaunchIntentFromRemote()],
  };
  const indexer = new CoinIndexService(config, intents, store, remote);
  await indexer.prepareForPublicRead();
  const list = indexer.list({ sort: "new", q: null, chain: null, network: "mainnet", limit: 50, offset: 0 });
  assert.equal(list.total, 1);
  assert.equal(list.coins[0]!.symbol, "PCAT");
});

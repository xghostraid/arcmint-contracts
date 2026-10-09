import assert from "node:assert/strict";
import { test } from "node:test";
import { IntentStore } from "../../src/intents/store.js";
import {
  assertGlobalSponsoredLaunchQuota,
  GLOBAL_SPONSORED_LAUNCHES_PER_HOUR,
} from "../../src/platform/global-quota.js";
import type { Intent } from "../../src/intents/types.js";

function sponsoredIntent(id: string): Intent {
  return {
    id,
    kind: "launch_token",
    chain: "solana-devnet",
    family: "solana",
    params: {
      name: "Q",
      symbol: "Q",
      supply: "1",
      decimals: 6,
      description: "",
      metadataUri: "https://example.com/m.json",
      fixedSupply: true,
      venue: "pumpfun",
    },
    summary: "s",
    status: "confirmed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    built: null,
    submission: null,
    receipt: { id: "x", status: "success", slotOrBlock: 1, fee: "0", feeSymbol: "SOL", explorerUrl: null, verified: [], tokenAddress: "Mint11111111111111111111111111111111111112", tokenExplorerUrl: null, confirmedAt: new Date().toISOString() },
    error: null,
    events: [],
    idempotencyKey: id,
    executionMode: "sponsor",
    instructionFingerprint: null,
  };
}

test("global sponsored launch cap matches getplugged hourly limit", () => {
  const store = new IntentStore(":memory:");
  for (let i = 0; i < GLOBAL_SPONSORED_LAUNCHES_PER_HOUR; i++) {
    const hex = i.toString(16).padStart(32, "0");
    store.save(sponsoredIntent(`int_${hex}`));
  }
  assert.throws(() => assertGlobalSponsoredLaunchQuota(store), /Global launch limit/);
  store.close();
});

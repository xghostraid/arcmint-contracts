import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { IntentStore } from "../../src/intents/store.js";
import { CoinIndexStore } from "../../src/indexer/store.js";
import { CoinIndexService } from "../../src/indexer/service.js";
import { coinFromIntent } from "../../src/indexer/sync.js";
import { coinId } from "../../src/indexer/record.js";
import { defaultLiveSnapshot } from "../../src/indexer/live.js";
import { findChain } from "../../src/chains/registry.js";
import type { Intent } from "../../src/intents/types.js";

function baseIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    id: "int_0123456789abcdef0123456789abcdef",
    kind: "launch_token",
    chain: "solana-devnet",
    family: "solana",
    params: {
      name: "Unit Coin",
      symbol: "UNIT",
      supply: "1000000",
      decimals: 6,
      description: "test",
      metadataUri: "",
      fixedSupply: true,
      venue: "spl",
    },
    summary: "launch",
    status: "confirmed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    built: { signer: "3tWcUQ5HxHcLcJvmPHJGhdDzfpdahdiJCFkKpqnDdG6G", payload: "", digest: "", steps: [], simulation: { ok: true, error: null, logs: [], unitsConsumed: 0, at: new Date().toISOString() }, cost: { label: "x", networkFee: "0", feeBasis: "x", deposits: "0", sends: "0", total: "0", symbol: "SOL", balance: null, enough: null, note: null, usd: null, usdSource: null, promptfunFee: "0" }, builtAt: new Date().toISOString(), validUntil: null, tokenAddress: "Mint11111111111111111111111111111111111112", extraSigners: [] },
    submission: { id: "sig111", submittedAt: new Date().toISOString() },
    receipt: {
      id: "sig111",
      status: "success",
      slotOrBlock: 1,
      fee: "0.001",
      feeSymbol: "SOL",
      explorerUrl: null,
      verified: ["ok"],
      tokenAddress: "Mint11111111111111111111111111111111111112",
      tokenExplorerUrl: null,
      confirmedAt: "2026-10-09T10:00:00.000Z",
    },
    error: null,
    events: [],
    idempotencyKey: "k1",
    executionMode: "wallet",
    instructionFingerprint: null,
    ...overrides,
  };
}

test("coinFromIntent maps confirmed launch receipts", () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const coin = coinFromIntent(config, baseIntent());
  assert.ok(coin);
  assert.equal(coin!.id, coinId("solana-devnet", "Mint11111111111111111111111111111111111112"));
  assert.equal(coin!.recordedFrom, "receipt");
});

test("CoinIndexService lists and sorts seeded coins", () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const intents = new IntentStore(":memory:");
  const store = new CoinIndexStore(":memory:");
  const indexer = new CoinIndexService(config, intents, store);
  const chain = findChain(config, "solana-devnet")!;
  store.upsert({
    id: coinId("solana-devnet", "aaa"),
    chainKey: "solana-devnet",
    venue: "spl",
    address: "aaa",
    name: "Older",
    symbol: "OLD",
    decimals: 6,
    supply: "1000",
    imageUrl: null,
    creator: "c",
    launchedAt: "2026-10-01T00:00:00.000Z",
    launchTx: "tx1",
    description: "",
    metadataUri: null,
    recordedFrom: "chain-import",
    verified: [],
    intentId: null,
    live: defaultLiveSnapshot(chain, "spl"),
  });
  store.upsert({
    id: coinId("solana-devnet", "bbb"),
    chainKey: "solana-devnet",
    venue: "spl",
    address: "bbb",
    name: "Newer",
    symbol: "NEW",
    decimals: 6,
    supply: "1000",
    imageUrl: null,
    creator: "c",
    launchedAt: "2026-10-09T00:00:00.000Z",
    launchTx: "tx2",
    description: "",
    metadataUri: null,
    recordedFrom: "chain-import",
    verified: [],
    intentId: null,
    live: defaultLiveSnapshot(chain, "spl"),
  });
  const list = indexer.list({ sort: "new", q: null, chain: null, network: null, limit: 50, offset: 0 });
  assert.equal(list.total, 2);
  assert.equal(list.coins[0]!.symbol, "NEW");
});

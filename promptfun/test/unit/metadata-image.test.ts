import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import {
  pictureApiUrl,
  pictureIdFromMetadataUri,
  syncImageUrlFromMetadataUri,
} from "../../src/indexer/metadata-image.js";

test("pictureIdFromMetadataUri parses hosted /m/ paths", () => {
  assert.equal(
    pictureIdFromMetadataUri("https://promptfun.fun/m/pic_0123456789abcdef01234567"),
    "pic_0123456789abcdef01234567",
  );
  assert.equal(pictureIdFromMetadataUri("/m/pic_0123456789abcdef01234567"), "pic_0123456789abcdef01234567");
  assert.equal(pictureIdFromMetadataUri("ipfs://bafytest"), null);
});

test("syncImageUrlFromMetadataUri maps hosted metadata to picture API URL", () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
  });
  const uri = "https://promptfun.fun/m/pic_0123456789abcdef01234567";
  assert.equal(
    syncImageUrlFromMetadataUri(config, uri),
    pictureApiUrl(config.publicUrl, "pic_0123456789abcdef01234567"),
  );
});

test("coinFromIntent sets imageUrl from metadataUri", async () => {
  const { coinFromIntent } = await import("../../src/indexer/sync.js");
  const { loadConfig } = await import("../../src/config.js");
  await import("../../src/chains/index.js");
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
  });
  const pic = "pic_0123456789abcdef01234567";
  const intent = {
    id: "int_0123456789abcdef0123456789abcdef",
    kind: "launch_token" as const,
    chain: "solana-mainnet",
    family: "solana" as const,
    params: {
      name: "Test",
      symbol: "TST",
      supply: "1000000000",
      decimals: 6,
      description: "",
      metadataUri: `https://promptfun.fun/m/${pic}`,
      fixedSupply: true,
      venue: "pumpfun" as const,
    },
    summary: "launch",
    status: "confirmed" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    built: null,
    submission: { id: "sig", submittedAt: new Date().toISOString() },
    receipt: {
      id: "sig",
      status: "success" as const,
      slotOrBlock: 1,
      fee: "0",
      feeSymbol: "SOL",
      explorerUrl: null,
      verified: [],
      tokenAddress: "Mint11111111111111111111111111111111111112",
      tokenExplorerUrl: null,
      confirmedAt: new Date().toISOString(),
    },
    error: null,
    events: [],
    idempotencyKey: "k",
    executionMode: "sponsored" as const,
    instructionFingerprint: null,
  };
  const coin = coinFromIntent(config, intent);
  assert.ok(coin);
  assert.equal(coin!.imageUrl, `https://promptfun.fun/api/pictures/${pic}`);
});

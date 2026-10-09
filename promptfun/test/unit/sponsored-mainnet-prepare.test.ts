import assert from "node:assert/strict";
import { test } from "node:test";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { IntentService } from "../../src/intents/service.js";
import { IntentStore } from "../../src/intents/store.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";

function mainnetSponsoredService(env: Record<string, string> = {}) {
  const kp = Keypair.generate();
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_ENABLE_SPONSORED_MAINNET: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: bs58.encode(kp.secretKey),
    ...env,
  });
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  return new IntentService(config, new IntentStore(":memory:"), pictures);
}

test("mainnet pump sponsored product rejects when sponsor key is missing", async () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_ENABLE_SPONSORED_MAINNET: "1",
  });
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const s = new IntentService(config, new IntentStore(":memory:"), pictures);
  await assert.rejects(
    s.prepareLaunch({
      chain: "solana-mainnet",
      name: "Test",
      symbol: "TST",
      metadataUri: "https://example.com/meta.json",
    }),
    (err: Error & { code?: string }) => {
      assert.match(err.message, /PROMPTFUN_SPONSOR_SECRET_KEY|sponsor/i);
      assert.equal(err.code, "sponsor_unconfigured");
      return true;
    },
  );
});

test("mainnet pump sponsored does not persist awaiting_wallet when preview build fails", async () => {
  const s = mainnetSponsoredService();
  const store = s.store;
  type BuildInternal = IntentService["buildInternal"];
  const proto = IntentService.prototype as unknown as { buildInternal: BuildInternal };
  const orig = proto.buildInternal;
  proto.buildInternal = async function () {
    throw new Error("simulation failed: insufficient lamports");
  };
  try {
    await assert.rejects(
      s.prepareLaunch({
        chain: "solana-mainnet",
        name: "Fail",
        symbol: "FAIL",
        metadataUri: "https://example.com/meta.json",
      }),
      (err: Error) => {
        assert.match(err.message, /Sponsored launch preview failed/);
        assert.match(err.message, /simulation failed/);
        assert.doesNotMatch(err.message, /approveUrl|wallet approval/i);
        return true;
      },
    );
    assert.equal(store.countSince(0), 0);
  } finally {
    proto.buildInternal = orig;
  }
});

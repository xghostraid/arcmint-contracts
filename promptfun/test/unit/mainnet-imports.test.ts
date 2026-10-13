import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { MAINNET_CHAIN_IMPORTS, importKnownCoin } from "../../src/indexer/imports.js";
import { IntentStore } from "../../src/intents/store.js";
import { CoinIndexStore } from "../../src/indexer/store.js";
import { CoinIndexService } from "../../src/indexer/service.js";

test("MAINNET_CHAIN_IMPORTS includes PCAT showcase coin", () => {
  const pcat = MAINNET_CHAIN_IMPORTS.find((s) => s.address === "GQcyhYE7iRi9yn3jxpndX5nXWUSCupj2Ughve5nLvXbs");
  assert.ok(pcat);
  assert.equal(pcat!.chainKey, "solana-mainnet");
  assert.match(pcat!.launchTx, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
});

test("importKnownCoin reads PCAT pump.fun launch from mainnet", async (t) => {
  if (!process.env.PROMPTFUN_RUN_MAINNET_IMPORT_TEST) {
    t.skip("set PROMPTFUN_RUN_MAINNET_IMPORT_TEST=1 to hit Solana mainnet RPC");
  }
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1" });
  const spec = MAINNET_CHAIN_IMPORTS[0]!;
  const coin = await importKnownCoin(config, spec);
  assert.ok(coin);
  assert.equal(coin!.symbol, "PCAT");
  assert.equal(coin!.venue, "pumpfun");
  assert.equal(coin!.address, spec.address);
  assert.match(coin!.metadataUri ?? "", /promptfun\.fun\/m\/pic_/);
});

test("CoinIndexService lists PCAT on mainnet after bootstrap import", async (t) => {
  if (!process.env.PROMPTFUN_RUN_MAINNET_IMPORT_TEST) {
    t.skip("set PROMPTFUN_RUN_MAINNET_IMPORT_TEST=1 to hit Solana mainnet RPC");
  }
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1" });
  const intents = new IntentStore(":memory:");
  const store = new CoinIndexStore(":memory:");
  const indexer = new CoinIndexService(config, intents, store, null);
  await indexer.prepareForPublicRead();
  for (const spec of MAINNET_CHAIN_IMPORTS) {
    const imported = await importKnownCoin(config, spec);
    if (imported) store.upsert(imported);
  }
  const list = indexer.list({ sort: "new", q: null, chain: null, network: "mainnet", limit: 50, offset: 0 });
  assert.ok(list.total >= 1);
  assert.ok(list.coins.some((c) => c.symbol === "PCAT"));
});

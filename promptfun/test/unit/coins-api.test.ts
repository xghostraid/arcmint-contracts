import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { CoinIndexService } from "../../src/indexer/service.js";
import { openMemoryStores } from "../../src/db/test-helpers.js";

test("resolveQuery rejects bad params", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const { intents, coins } = await openMemoryStores();
  const indexer = new CoinIndexService(config, intents, coins);
  assert.equal(indexer.resolveQuery(new URLSearchParams("sort=nope")).ok, false);
  assert.equal(indexer.resolveQuery(new URLSearchParams("limit=200")).ok, false);
  assert.equal(indexer.resolveQuery(new URLSearchParams("network=devnet")).ok, false);
  const ok = indexer.resolveQuery(new URLSearchParams("sort=top&limit=10&offset=0"));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.query.sort, "top");
    assert.equal(ok.query.network, "mainnet");
  }
  const testnet = indexer.resolveQuery(new URLSearchParams("network=testnet"));
  assert.equal(testnet.ok, true);
  if (testnet.ok) assert.equal(testnet.query.network, "testnet");
});

test("stats returns zero when empty", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const { intents, coins } = await openMemoryStores();
  const indexer = new CoinIndexService(config, intents, coins);
  const stats = await indexer.stats();
  assert.equal(stats.coins, 0);
  assert.equal(stats.mainnetCoins, 0);
});

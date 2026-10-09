import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { IntentStore } from "../../src/intents/store.js";
import { CoinIndexStore } from "../../src/indexer/store.js";
import { CoinIndexService } from "../../src/indexer/service.js";

test("resolveQuery rejects bad params", () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const indexer = new CoinIndexService(config, new IntentStore(":memory:"), new CoinIndexStore(":memory:"));
  assert.equal(indexer.resolveQuery(new URLSearchParams("sort=nope")).ok, false);
  assert.equal(indexer.resolveQuery(new URLSearchParams("limit=200")).ok, false);
  assert.equal(indexer.resolveQuery(new URLSearchParams("network=devnet")).ok, false);
  const ok = indexer.resolveQuery(new URLSearchParams("sort=top&limit=10&offset=0"));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.query.sort, "top");
});

test("stats returns zero when empty", () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:" });
  const indexer = new CoinIndexService(config, new IntentStore(":memory:"), new CoinIndexStore(":memory:"));
  const stats = indexer.stats();
  assert.equal(stats.coins, 0);
  assert.equal(stats.mainnetCoins, 0);
});

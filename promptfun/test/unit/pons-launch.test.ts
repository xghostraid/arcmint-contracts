import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/chains/index.js";
import { loadConfig } from "../../src/config.js";
import { PONS_LAUNCHPAD_URL, PONS_SUPPLY, ponsTokenUrl } from "../../src/chains/evm/pons.js";
import { launchPlaybook } from "../../src/mcp/launch-playbook.js";
import { IntentService } from "../../src/intents/service.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";
import { openMemoryStores } from "../../src/db/test-helpers.js";

test("pons token URL matches launchpad site", () => {
  assert.equal(ponsTokenUrl("0xabc"), "https://www.ponsfamily.com/token/0xabc");
  assert.match(PONS_LAUNCHPAD_URL, /ponsfamily\.com\/launchpad/);
});

test("robinhood mainnet prepare_launch defaults to pons venue", async () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1",
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
  });
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const saved = await pictures.saveFromRaw("image/png", png);
  const { intents } = await openMemoryStores();
  const s = new IntentService(config, intents, pictures);
  const prep = await s.prepareLaunch({
    chain: "robinhood",
    name: "Pons Test",
    symbol: "PONS",
    pictureId: saved.pictureId,
  });
  assert.equal(prep.chain, "robinhood");
  assert.equal((prep.params as { venue: string }).venue, "pons");
  assert.equal((prep.params as { supply: string }).supply, PONS_SUPPLY);
  assert.ok((prep.params as { logoUrl?: string }).logoUrl?.startsWith("https://"));
  assert.match(prep.summary, /pons/i);
});

test("launch playbook mentions pons when Robinhood mainnet enabled", () => {
  const config = loadConfig({ PROMPTFUN_ENABLE_ROBINHOOD_MAINNET: "1" });
  const playbook = launchPlaybook(config);
  assert.ok(playbook.some((l) => l.includes(PONS_LAUNCHPAD_URL)));
});

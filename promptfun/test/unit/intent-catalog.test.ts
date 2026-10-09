import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import type { IntentRemoteStore } from "../../src/intents/catalog.js";
import { IntentService } from "../../src/intents/service.js";
import { IntentStore } from "../../src/intents/store.js";
import type { Intent } from "../../src/intents/types.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";

class MemoryIntentRemote implements IntentRemoteStore {
  readonly map = new Map<string, Intent>();

  enabled(): boolean {
    return true;
  }

  async mirror(intent: Intent): Promise<void> {
    this.map.set(intent.id, structuredClone(intent));
  }

  async load(id: string): Promise<Intent | null> {
    const row = this.map.get(id);
    return row ? structuredClone(row) : null;
  }
}

const to = Keypair.generate().publicKey.toBase58();

test("prepare mirrors intent to remote catalog; another instance can confirm path via get", async () => {
  const remote = new MemoryIntentRemote();
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_LOCALNET: "1" });
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const writer = new IntentService(config, new IntentStore(":memory:"), pictures, null, null, remote);
  const reader = new IntentService(config, new IntentStore(":memory:"), pictures, null, null, remote);

  const intent = await writer.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  assert.ok(remote.map.has(intent.id));
  assert.equal(new IntentStore(":memory:").get(intent.id), null);

  const loaded = await reader.get(intent.id);
  assert.equal(loaded.id, intent.id);
  assert.equal(loaded.status, intent.status);
});

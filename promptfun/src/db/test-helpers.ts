import { openMainDb, type MainDb } from "./main-db.js";
import { migrateMainDb } from "./schema.js";
import { resolvePromptfunDb } from "./resolve.js";
import { IntentStore } from "../intents/store.js";
import { CoinIndexStore } from "../indexer/store.js";

export interface MemoryStores {
  mainDb: MainDb;
  intents: IntentStore;
  coins: CoinIndexStore;
}

/** Shared in-memory DB for unit tests (intents + coins in one file). */
export async function openMemoryStores(): Promise<MemoryStores> {
  const mainDb = await openMainDb(resolvePromptfunDb({ PROMPTFUN_DB: ":memory:" }));
  await migrateMainDb(mainDb);
  const intents = await IntentStore.open(mainDb);
  const coins = await CoinIndexStore.open(mainDb);
  return { mainDb, intents, coins };
}

export async function closeMemoryStores(stores: MemoryStores): Promise<void> {
  await stores.intents.close();
  await stores.coins.close();
  await stores.mainDb.close();
}

import type { MainDb } from "./main-db.js";

const INTENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intents_idem ON intents (idempotency_key);
CREATE INDEX IF NOT EXISTS intents_status ON intents (status);
`;

const COINS_SCHEMA = `
CREATE TABLE IF NOT EXISTS coins (
  id TEXT PRIMARY KEY,
  chain_key TEXT NOT NULL,
  address TEXT NOT NULL,
  launched_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coins_chain ON coins (chain_key);
CREATE INDEX IF NOT EXISTS coins_launched ON coins (launched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS coins_chain_address ON coins (chain_key, address);
`;

/** Idempotent schema for intents + coins (SQLite / libSQL / Postgres). */
export async function migrateMainDb(db: MainDb): Promise<void> {
  if (db.driver === "postgres") {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        body TEXT NOT NULL
      );
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS intents_idem ON intents (idempotency_key);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS intents_status ON intents (status);`);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS coins (
        id TEXT PRIMARY KEY,
        chain_key TEXT NOT NULL,
        address TEXT NOT NULL,
        launched_at BIGINT NOT NULL,
        body TEXT NOT NULL
      );
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS coins_chain ON coins (chain_key);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS coins_launched ON coins (launched_at DESC);`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS coins_chain_address ON coins (chain_key, address);`);
    return;
  }
  await db.exec(INTENTS_SCHEMA);
  await db.exec(COINS_SCHEMA);
}

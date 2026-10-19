import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE vault_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL,
    kdf TEXT NOT NULL,
    wrapped_dek TEXT NOT NULL,
    encrypted_mnemonic TEXT NOT NULL,
    next_hd_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE wallet_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT NOT NULL,
    group_id INTEGER REFERENCES wallet_groups(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    hd_index INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    encrypted_secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (family, address)
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    network TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    wallet_address TEXT,
    token TEXT,
    signature TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_created ON activity(created_at DESC);
  CREATE TABLE launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    mint TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    status TEXT NOT NULL,
    plan TEXT NOT NULL,
    result TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE launches ADD COLUMN lookup_table TEXT;
  ALTER TABLE launches ADD COLUMN lookup_table_status TEXT;
  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    mint TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    decimals INTEGER NOT NULL DEFAULT 6,
    supply TEXT NOT NULL DEFAULT '0',
    venue TEXT,
    pool TEXT,
    tracked INTEGER NOT NULL DEFAULT 1,
    newest_signature TEXT,
    added_at TEXT NOT NULL,
    UNIQUE (network, mint)
  );
  CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    mint TEXT NOT NULL,
    signature TEXT NOT NULL,
    seq INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    block_time INTEGER NOT NULL,
    venue TEXT NOT NULL,
    side TEXT NOT NULL,
    trader TEXT NOT NULL,
    sol_lamports TEXT NOT NULL,
    tokens TEXT NOT NULL,
    price REAL NOT NULL,
    UNIQUE (network, signature, seq)
  );
  CREATE INDEX trades_mint_time ON trades(network, mint, block_time);
  CREATE INDEX trades_trader ON trades(network, trader);
  CREATE TABLE strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mint TEXT NOT NULL,
    config TEXT NOT NULL,
    status TEXT NOT NULL,
    budget_lamports TEXT NOT NULL,
    spent_lamports TEXT NOT NULL DEFAULT '0',
    received_lamports TEXT NOT NULL DEFAULT '0',
    runs INTEGER NOT NULL DEFAULT 0,
    next_run_at INTEGER,
    last_run_at INTEGER,
    state TEXT NOT NULL DEFAULT '{}',
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE strategy_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    intent_key TEXT NOT NULL UNIQUE,
    side TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX strategy_intents_strategy ON strategy_intents(strategy_id, id DESC);
  `,
];

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      version += 1;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

export function now(): string {
  return new Date().toISOString();
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CoinRecord } from "./record.js";

export class CoinIndexStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    `);
  }

  upsert(record: CoinRecord): void {
    this.db
      .prepare(
        `INSERT INTO coins (id, chain_key, address, launched_at, body) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET chain_key = excluded.chain_key, address = excluded.address,
           launched_at = excluded.launched_at, body = excluded.body`,
      )
      .run(record.id, record.chainKey, record.address, Date.parse(record.launchedAt), JSON.stringify(record));
  }

  get(id: string): CoinRecord | null {
    const row = this.db.prepare("SELECT body FROM coins WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as CoinRecord) : null;
  }

  findByAddress(address: string): CoinRecord[] {
    const rows = this.db.prepare("SELECT body FROM coins WHERE address = ?").all(address) as Array<{ body: string }>;
    return rows.map((r) => JSON.parse(r.body) as CoinRecord);
  }

  all(): CoinRecord[] {
    const rows = this.db.prepare("SELECT body FROM coins ORDER BY launched_at DESC").all() as Array<{ body: string }>;
    return rows.map((r) => JSON.parse(r.body) as CoinRecord);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM coins").get() as { n: number };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}

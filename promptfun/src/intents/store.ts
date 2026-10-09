import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Intent } from "./types.js";

/** Intents only: no keys, no signatures beyond what is already public on chain. */
export class IntentStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS intents_idem ON intents (idempotency_key);
      CREATE INDEX IF NOT EXISTS intents_status ON intents (status);
    `);
  }

  save(intent: Intent): void {
    this.db
      .prepare(
        `INSERT INTO intents (id, idempotency_key, status, created_at, body) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body`,
      )
      .run(intent.id, intent.idempotencyKey, intent.status, Date.parse(intent.createdAt), JSON.stringify(intent));
  }

  get(id: string): Intent | null {
    const row = this.db.prepare("SELECT body FROM intents WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Intent) : null;
  }

  /** Newest intent with this key that is still in flight. Finished or expired intents never block a new one. */
  findLive(idempotencyKey: string): Intent | null {
    const row = this.db
      .prepare(
        `SELECT body FROM intents WHERE idempotency_key = ? AND status IN ('awaiting_wallet','built','submitted')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(idempotencyKey) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Intent) : null;
  }

  withStatus(...statuses: string[]): Intent[] {
    const marks = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT body FROM intents WHERE status IN (${marks})`).all(...statuses) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as Intent);
  }

  countSince(sinceMs: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM intents WHERE created_at >= ?").get(sinceMs) as { n: number };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}

import type { MainDb } from "../db/main-db.js";
import { migrateMainDb } from "../db/schema.js";
import type { Intent } from "./types.js";

/** Intents only: no keys, no signatures beyond what is already public on chain. */
export class IntentStore {
  private readonly db: MainDb;
  private readonly ownsDb: boolean;

  private constructor(db: MainDb, ownsDb: boolean) {
    this.db = db;
    this.ownsDb = ownsDb;
  }

  /** Open store (runs idempotent migrations). Share one MainDb across IntentStore + CoinIndexStore in production. */
  static async open(db: MainDb): Promise<IntentStore> {
    await migrateMainDb(db);
    return new IntentStore(db, false);
  }

  /** Convenience for tests: opens a dedicated connection and owns lifecycle. */
  static async openPath(dbPath: string): Promise<IntentStore> {
    const { resolvePromptfunDb } = await import("../db/resolve.js");
    const { openMainDb } = await import("../db/main-db.js");
    const config =
      dbPath === ":memory:"
        ? resolvePromptfunDb({ PROMPTFUN_DB: ":memory:" })
        : resolvePromptfunDb({ PROMPTFUN_DB: dbPath });
    const main = await openMainDb(config);
    await migrateMainDb(main);
    return new IntentStore(main, true);
  }

  async save(intent: Intent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO intents (id, idempotency_key, status, created_at, body) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body`,
      )
      .run(intent.id, intent.idempotencyKey, intent.status, Date.parse(intent.createdAt), JSON.stringify(intent));
  }

  async get(id: string): Promise<Intent | null> {
    const row = await this.db.prepare("SELECT body FROM intents WHERE id = ?").get(id);
    const body = row?.body;
    return typeof body === "string" ? (JSON.parse(body) as Intent) : null;
  }

  /** Newest intent with this key that is still in flight. Finished or expired intents never block a new one. */
  async findLive(idempotencyKey: string): Promise<Intent | null> {
    const row = await this.db
      .prepare(
        `SELECT body FROM intents WHERE idempotency_key = ? AND status IN ('awaiting_wallet','awaiting_confirm','built','submitted')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(idempotencyKey);
    const body = row?.body;
    return typeof body === "string" ? (JSON.parse(body) as Intent) : null;
  }

  async withStatus(...statuses: string[]): Promise<Intent[]> {
    const marks = statuses.map(() => "?").join(",");
    const rows = await this.db.prepare(`SELECT body FROM intents WHERE status IN (${marks})`).all(...statuses);
    return rows.map((row) => JSON.parse(String(row.body)) as Intent);
  }

  async countSince(sinceMs: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM intents WHERE created_at >= ?").get(sinceMs);
    return Number(row?.n ?? 0);
  }

  /** Confirmed sponsored token launches since `sinceMs` (global cap, getplugged-style). */
  async countSponsoredLaunchesSince(sinceMs: number): Promise<number> {
    const rows = await this.db
      .prepare("SELECT body FROM intents WHERE created_at >= ? AND status = 'confirmed'")
      .all(sinceMs);
    let n = 0;
    for (const row of rows) {
      const intent = JSON.parse(String(row.body)) as { executionMode?: string; kind?: string };
      if (intent.executionMode === "sponsor" && intent.kind === "launch_token") n++;
    }
    return n;
  }

  async close(): Promise<void> {
    if (this.ownsDb) await this.db.close();
  }
}

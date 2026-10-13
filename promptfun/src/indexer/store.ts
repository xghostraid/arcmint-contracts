import type { MainDb } from "../db/main-db.js";
import type { CoinRecord } from "./record.js";

export class CoinIndexStore {
  private readonly db: MainDb;
  private readonly ownsDb: boolean;

  private constructor(db: MainDb, ownsDb: boolean) {
    this.db = db;
    this.ownsDb = ownsDb;
  }

  static async open(db: MainDb): Promise<CoinIndexStore> {
    return new CoinIndexStore(db, false);
  }

  static async openPath(dbPath: string): Promise<CoinIndexStore> {
    const { resolvePromptfunDb } = await import("../db/resolve.js");
    const { openMainDb } = await import("../db/main-db.js");
    const { migrateMainDb } = await import("../db/schema.js");
    const config =
      dbPath === ":memory:"
        ? resolvePromptfunDb({ PROMPTFUN_DB: ":memory:" })
        : resolvePromptfunDb({ PROMPTFUN_DB: dbPath });
    const main = await openMainDb(config);
    await migrateMainDb(main);
    return new CoinIndexStore(main, true);
  }

  async upsert(record: CoinRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO coins (id, chain_key, address, launched_at, body) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET chain_key = excluded.chain_key, address = excluded.address,
           launched_at = excluded.launched_at, body = excluded.body`,
      )
      .run(record.id, record.chainKey, record.address, Date.parse(record.launchedAt), JSON.stringify(record));
  }

  async get(id: string): Promise<CoinRecord | null> {
    const row = await this.db.prepare("SELECT body FROM coins WHERE id = ?").get(id);
    const body = row?.body;
    return typeof body === "string" ? (JSON.parse(body) as CoinRecord) : null;
  }

  async findByAddress(address: string): Promise<CoinRecord[]> {
    const rows = await this.db.prepare("SELECT body FROM coins WHERE address = ?").all(address);
    return rows.map((r) => JSON.parse(String(r.body)) as CoinRecord);
  }

  async all(): Promise<CoinRecord[]> {
    const rows = await this.db.prepare("SELECT body FROM coins ORDER BY launched_at DESC").all();
    return rows.map((r) => JSON.parse(String(r.body)) as CoinRecord);
  }

  async count(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM coins").get();
    return Number(row?.n ?? 0);
  }

  async close(): Promise<void> {
    if (this.ownsDb) await this.db.close();
  }
}

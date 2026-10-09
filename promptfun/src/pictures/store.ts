import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface PictureRow {
  id: string;
  mime: string;
  data: Buffer;
  imageCid: string | null;
  createdAt: number;
  expiresAt: number;
}

export class PictureStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pictures (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        image_cid TEXT,
        token_metadata BLOB,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pictures_expires ON pictures (expires_at);
    `);
    try {
      this.db.exec("ALTER TABLE pictures ADD COLUMN token_metadata BLOB");
    } catch {
      /* column exists */
    }
  }

  create(mime: string, data: Buffer, ttlMs: number): PictureRow {
    const id = `pic_${randomBytes(12).toString("hex")}`;
    const createdAt = Date.now();
    const expiresAt = createdAt + ttlMs;
    this.db
      .prepare("INSERT INTO pictures (id, mime, data, image_cid, created_at, expires_at) VALUES (?, ?, ?, NULL, ?, ?)")
      .run(id, mime, data, createdAt, expiresAt);
    return { id, mime, data, imageCid: null, createdAt, expiresAt };
  }

  get(id: string): PictureRow | null {
    this.purgeExpired();
    const row = this.db
      .prepare("SELECT id, mime, data, image_cid AS imageCid, created_at AS createdAt, expires_at AS expiresAt FROM pictures WHERE id = ?")
      .get(id) as PictureRow | undefined;
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.delete(id);
      return null;
    }
    return { ...row, data: Buffer.from(row.data as unknown as Buffer) };
  }

  setImageCid(id: string, cid: string): void {
    this.db.prepare("UPDATE pictures SET image_cid = ? WHERE id = ?").run(cid, id);
  }

  setTokenMetadata(id: string, json: Buffer): void {
    this.db.prepare("UPDATE pictures SET token_metadata = ? WHERE id = ?").run(json, id);
  }

  getTokenMetadata(id: string): Buffer | null {
    this.purgeExpired();
    const row = this.db.prepare("SELECT token_metadata FROM pictures WHERE id = ?").get(id) as
      | { token_metadata: Buffer | null }
      | undefined;
    if (!row?.token_metadata) return null;
    return Buffer.from(row.token_metadata as unknown as Buffer);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM pictures WHERE id = ?").run(id);
  }

  purgeExpired(): void {
    this.db.prepare("DELETE FROM pictures WHERE expires_at <= ?").run(Date.now());
  }

  close(): void {
    this.db.close();
  }
}

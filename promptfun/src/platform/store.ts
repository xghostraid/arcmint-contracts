import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ClaimWalletRecord } from "../wallets/types.js";

export interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  createdAt: string;
}

export interface StoredAuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  sub: string;
  email: string;
  expiresAt: number;
}

/** SQLite backing for OAuth clients, magic links, and auth codes (not wired to HTTP yet). */
export class PlatformStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        redirect_uris TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_magic (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL,
        sub TEXT NOT NULL,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_users (
        sub TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS launch_quota_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sub TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_launch_quota_sub_time ON launch_quota_events (sub, created_at);
      CREATE TABLE IF NOT EXISTS sponsor_spend (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sub TEXT NOT NULL,
        month_key TEXT NOT NULL,
        usd_estimate REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sponsor_spend_month ON sponsor_spend (month_key);
      CREATE TABLE IF NOT EXISTS claim_wallets (
        sub TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        privy_user_id TEXT NOT NULL,
        solana_address TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS claim_magic (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  saveClient(client: OAuthClient): void {
    this.db.prepare("INSERT OR REPLACE INTO oauth_clients (client_id, redirect_uris, created_at) VALUES (?, ?, ?)")
      .run(client.clientId, JSON.stringify(client.redirectUris), client.createdAt);
  }

  getClient(clientId: string): OAuthClient | undefined {
    const row = this.db.prepare("SELECT client_id, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?").get(clientId) as
      | { client_id: string; redirect_uris: string; created_at: string }
      | undefined;
    if (!row) return undefined;
    return { clientId: row.client_id, redirectUris: JSON.parse(row.redirect_uris) as string[], createdAt: row.created_at };
  }

  saveMagicToken(token: string, email: string, expiresAt: number): void {
    this.db.prepare("INSERT OR REPLACE INTO oauth_magic (token, email, expires_at) VALUES (?, ?, ?)").run(token, email, expiresAt);
  }

  consumeMagicToken(token: string): string | null {
    const row = this.db.prepare("SELECT email, expires_at FROM oauth_magic WHERE token = ?").get(token) as
      | { email: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    this.db.prepare("DELETE FROM oauth_magic WHERE token = ?").run(token);
    return row.email;
  }

  upsertUser(sub: string, email: string): void {
    this.db.prepare("INSERT OR REPLACE INTO platform_users (sub, email, updated_at) VALUES (?, ?, ?)")
      .run(sub, email, new Date().toISOString());
  }

  saveAuthCode(record: StoredAuthCode): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO oauth_codes
      (code, client_id, redirect_uri, code_challenge, code_challenge_method, sub, email, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.code, record.clientId, record.redirectUri, record.codeChallenge, record.codeChallengeMethod, record.sub, record.email, record.expiresAt);
  }

  consumeAuthCode(code: string): StoredAuthCode | null {
    const row = this.db.prepare(`
      SELECT code, client_id AS clientId, redirect_uri AS redirectUri, code_challenge AS codeChallenge,
        code_challenge_method AS codeChallengeMethod, sub, email, expires_at AS expiresAt
      FROM oauth_codes WHERE code = ?
    `).get(code) as StoredAuthCode | undefined;
    if (!row || row.expiresAt < Date.now()) return null;
    this.db.prepare("DELETE FROM oauth_codes WHERE code = ?").run(code);
    return row;
  }

  recordLaunchQuota(sub: string): void {
    this.db.prepare("INSERT INTO launch_quota_events (sub, created_at) VALUES (?, ?)").run(sub, Date.now());
  }

  countLaunchesSince(sub: string, sinceMs: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM launch_quota_events WHERE sub = ? AND created_at >= ?").get(sub, sinceMs) as { c: number };
    return row.c;
  }

  addSponsorSpend(sub: string, usdEstimate: number, monthKey: string): void {
    this.db.prepare("INSERT INTO sponsor_spend (sub, month_key, usd_estimate, created_at) VALUES (?, ?, ?, ?)").run(sub, monthKey, usdEstimate, Date.now());
  }

  sumSponsorSpend(monthKey: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(usd_estimate), 0) AS s FROM sponsor_spend WHERE month_key = ?").get(monthKey) as { s: number };
    return row.s;
  }

  getClaimWallet(sub: string): ClaimWalletRecord | undefined {
    const row = this.db.prepare(`
      SELECT sub, email, privy_user_id AS privyUserId, solana_address AS solanaAddress, created_at AS createdAt, updated_at AS updatedAt
      FROM claim_wallets WHERE sub = ?
    `).get(sub) as ClaimWalletRecord | undefined;
    return row;
  }

  saveClaimWallet(record: ClaimWalletRecord): void {
    const existing = this.getClaimWallet(record.sub);
    const createdAt = existing?.createdAt ?? record.createdAt;
    this.db.prepare(`
      INSERT OR REPLACE INTO claim_wallets (sub, email, privy_user_id, solana_address, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.sub, record.email, record.privyUserId, record.solanaAddress, createdAt, record.updatedAt);
  }

  saveClaimMagicToken(token: string, email: string, expiresAt: number): void {
    this.db.prepare("INSERT OR REPLACE INTO claim_magic (token, email, expires_at) VALUES (?, ?, ?)").run(token, email, expiresAt);
  }

  consumeClaimMagicToken(token: string): string | null {
    const row = this.db.prepare("SELECT email, expires_at FROM claim_magic WHERE token = ?").get(token) as
      | { email: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < Date.now()) return null;
    this.db.prepare("DELETE FROM claim_magic WHERE token = ?").run(token);
    return row.email;
  }

  close(): void {
    this.db.close();
  }
}

export function platformDbPath(configDbPath: string): string {
  const dir = path.dirname(configDbPath);
  const base = path.basename(configDbPath, path.extname(configDbPath));
  return path.join(dir, `${base}-platform.sqlite`);
}

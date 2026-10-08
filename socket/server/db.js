import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { safeImage } from "../public/board.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coins (
  mint TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  image TEXT,
  description TEXT,
  website TEXT,
  x_url TEXT,
  wallet TEXT,
  recipient TEXT,
  user_bps INTEGER NOT NULL DEFAULT 5000,
  recipient_bps INTEGER NOT NULL DEFAULT 5000,
  status TEXT NOT NULL DEFAULT 'confirmed',
  error TEXT,
  created_at TEXT NOT NULL,
  market_cap_usd REAL,
  market_cap_sol REAL,
  since_launch_pct REAL,
  change_24h_pct REAL,
  volume_24h_usd REAL,
  paid_to_creator_sol REAL NOT NULL DEFAULT 0,
  pending_fee_sol REAL NOT NULL DEFAULT 0,
  graduated INTEGER NOT NULL DEFAULT 0,
  launch_sig TEXT,
  live INTEGER NOT NULL DEFAULT 0,
  CHECK (user_bps = 5000 AND recipient_bps = 5000),
  CHECK (status IN ('received', 'quoted', 'submitted', 'confirmed', 'failed')),
  CHECK (paid_to_creator_sol >= 0),
  CHECK (pending_fee_sol >= 0),
  CHECK (live IN (0, 1)),
  CHECK (graduated IN (0, 1))
);

CREATE TABLE IF NOT EXISTS burns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sol REAL NOT NULL,
  tokens TEXT NOT NULL,
  swap_sig TEXT,
  burn_sig TEXT,
  at TEXT NOT NULL,
  mint TEXT,
  CHECK (sol >= 0)
);

CREATE INDEX IF NOT EXISTS idx_coins_created ON coins (created_at);
CREATE INDEX IF NOT EXISTS idx_coins_live ON coins (status, live);
CREATE INDEX IF NOT EXISTS idx_burns_at ON burns (at);
CREATE INDEX IF NOT EXISTS idx_burns_mint ON burns (mint);

CREATE TABLE IF NOT EXISTS pictures (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (size > 0),
  CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp'))
);

CREATE INDEX IF NOT EXISTS idx_pictures_sha ON pictures (sha256);
CREATE INDEX IF NOT EXISTS idx_pictures_expires ON pictures (expires_at);

CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT,
  website TEXT,
  x_url TEXT,
  wallet TEXT,
  picture_id TEXT,
  image_url TEXT,
  user_bps INTEGER NOT NULL DEFAULT 5000,
  recipient_bps INTEGER NOT NULL DEFAULT 5000,
  status TEXT NOT NULL,
  error TEXT,
  states TEXT NOT NULL,
  mint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (user_bps = 5000 AND recipient_bps = 5000),
  CHECK (status IN ('received', 'quoted', 'submitted', 'confirmed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_launches_status ON launches (status);
`;

export function openDb(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  const coinCols = db.prepare("PRAGMA table_info(coins)").all();
  if (!coinCols.some((col) => col.name === "pending_fee_sol")) {
    db.exec("ALTER TABLE coins ADD COLUMN pending_fee_sol REAL NOT NULL DEFAULT 0");
  }
  return db;
}

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("bad time");
  return date.toISOString();
}

const INSERT_COIN = `
INSERT INTO coins (
  mint, name, ticker, image, description, website, x_url, wallet, recipient,
  user_bps, recipient_bps, status, error, created_at,
  market_cap_usd, market_cap_sol, since_launch_pct, change_24h_pct, volume_24h_usd,
  paid_to_creator_sol, pending_fee_sol, graduated, launch_sig, live
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?
)`;

export function insertCoin(db, input) {
  db.prepare(INSERT_COIN).run(
    input.mint,
    input.name,
    input.ticker,
    input.image ?? null,
    input.description ?? null,
    input.website ?? null,
    input.x ?? null,
    input.wallet ?? null,
    input.recipient ?? null,
    input.userBps ?? 5000,
    input.recipientBps ?? 5000,
    input.status ?? "confirmed",
    input.error ?? null,
    iso(input.createdAt),
    input.marketCapUsd ?? null,
    input.marketCapSol ?? null,
    input.sinceLaunchPct ?? null,
    input.change24hPct ?? null,
    input.volume24hUsd ?? null,
    input.paidToCreatorSol ?? 0,
    input.pendingFeeSol ?? 0,
    input.graduated ? 1 : 0,
    input.launchSig ?? null,
    input.live ? 1 : 0,
  );
}

export function insertBurn(db, input) {
  if (!/^\d+$/.test(String(input.tokens))) throw new Error("bad tokens");
  db.prepare(`
    INSERT INTO burns (sol, tokens, swap_sig, burn_sig, at, mint)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.sol,
    String(input.tokens),
    input.swapSig ?? null,
    input.burnSig ?? null,
    iso(input.at),
    input.mint ?? null,
  );
}

export function toPublicCoin(row) {
  return {
    mint: row.mint,
    name: row.name,
    ticker: row.ticker,
    image: safeImage(row.image),
    createdAt: row.created_at,
    marketCapUsd: row.market_cap_usd,
    marketCapSol: row.market_cap_sol,
    sinceLaunchPct: row.since_launch_pct,
    change24hPct: row.change_24h_pct,
    volume24hUsd: row.volume_24h_usd,
    paidToCreatorSol: row.paid_to_creator_sol,
    graduated: row.graduated === 1,
    wallet: row.wallet,
    recipient: row.recipient,
    userPercent: row.user_bps / 100,
    recipientPercent: row.recipient_bps / 100,
    launchSig: row.launch_sig,
  };
}

export function toPublicBurn(row) {
  return {
    sol: row.sol,
    tokens: String(row.tokens),
    swapSig: row.swap_sig,
    burnSig: row.burn_sig,
    at: row.at,
  };
}

export const COIN_KEYS = Object.freeze([
  "mint",
  "name",
  "ticker",
  "image",
  "createdAt",
  "marketCapUsd",
  "marketCapSol",
  "sinceLaunchPct",
  "change24hPct",
  "volume24hUsd",
  "paidToCreatorSol",
  "graduated",
  "wallet",
  "recipient",
  "userPercent",
  "recipientPercent",
  "launchSig",
]);

export const BURN_KEYS = Object.freeze(["sol", "tokens", "swapSig", "burnSig", "at"]);

export function listLiveCoins(db) {
  return db.prepare(`
    SELECT * FROM coins
    WHERE status = 'confirmed' AND live = 1
    ORDER BY created_at DESC
  `).all().map(toPublicCoin);
}

export function getLiveCoin(db, mint) {
  const row = db.prepare(`
    SELECT * FROM coins
    WHERE mint = ? AND status = 'confirmed' AND live = 1
  `).get(mint);
  return row ? toPublicCoin(row) : null;
}

export function listBurns(db) {
  return db.prepare(`
    SELECT * FROM burns
    ORDER BY at DESC, id DESC
  `).all().map(toPublicBurn);
}

export function coinEvents(db, coin) {
  const burns = db.prepare(`
    SELECT * FROM burns WHERE mint = ? ORDER BY at ASC, id ASC
  `).all(coin.mint);
  const events = [{
    kind: "launched",
    at: coin.createdAt,
    signature: coin.launchSig,
  }];
  for (const burn of burns) {
    events.push({
      kind: "burn",
      at: burn.at,
      sol: burn.sol,
      tokens: String(burn.tokens),
      signature: burn.burn_sig,
      swapSig: burn.swap_sig,
    });
  }
  return { events, burnsAttributed: burns.length > 0 };
}

export function counts(db) {
  const coins = db.prepare(`SELECT COUNT(*) AS n FROM coins WHERE status = 'confirmed'`).get();
  const live = db.prepare(`
    SELECT COUNT(*) AS n FROM coins WHERE status = 'confirmed' AND live = 1
  `).get();
  return { coins: Number(coins.n), live: Number(live.n) };
}

export function sumPaid(db) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(paid_to_creator_sol), 0) AS n
    FROM coins WHERE status = 'confirmed'
  `).get();
  return Number(row.n);
}

export function sumBurnSol(db) {
  const row = db.prepare(`SELECT COALESCE(SUM(sol), 0) AS n FROM burns`).get();
  return Number(row.n);
}

export function sumBurnTokens(db) {
  const rows = db.prepare(`SELECT tokens FROM burns`).all();
  return rows.reduce((sum, row) => sum + BigInt(row.tokens), 0n).toString();
}

const PICTURE_TTL_MS = 24 * 60 * 60 * 1000;

export function deleteExpiredPictures(db, now = new Date()) {
  db.prepare(`DELETE FROM pictures WHERE expires_at <= ?`).run(now.toISOString());
}

export function getPicture(db, id, now = new Date()) {
  if (!id) return null;
  const row = db.prepare(`SELECT * FROM pictures WHERE id = ?`).get(id);
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return row;
}

export function storePicture(db, { bytes, mime }, now = new Date()) {
  deleteExpiredPictures(db, now);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = db.prepare(`
    SELECT id, expires_at, mime, size FROM pictures
    WHERE sha256 = ?
    ORDER BY expires_at DESC
  `).get(sha256);
  if (existing && Date.parse(existing.expires_at) > now.getTime()) {
    return {
      id: existing.id,
      expiresAt: existing.expires_at,
      size: existing.size,
      mime: existing.mime,
      deduped: true,
    };
  }
  const id = `pic_${randomBytes(8).toString("hex")}`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PICTURE_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO pictures (id, sha256, mime, bytes, size, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sha256, mime, bytes, bytes.length, createdAt, expiresAt);
  return { id, expiresAt, size: bytes.length, mime, deduped: false };
}

export function countLaunchesSince(db, isoStart) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM coins
    WHERE created_at >= ? AND status IN ('submitted', 'confirmed')
  `).get(isoStart);
  return Number(row.n);
}

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const LOCAL_MINT = `SoCk${"1".repeat(38)}12`;
const LOCAL_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

export function latestLiveRow(db) {
  return db.prepare(`
    SELECT * FROM coins
    WHERE status = 'confirmed' AND live = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get() || null;
}

export function toLiveView(row) {
  if (!row) return null;
  return {
    ...toPublicCoin(row),
    pendingFeeSol: Number(row.pending_fee_sol ?? 0),
  };
}

export function getLaunchByKey(db, key) {
  return db.prepare(`SELECT * FROM launches WHERE idempotency_key = ?`).get(key) || null;
}

export function insertLaunch(db, input, now) {
  const stamp = now.toISOString();
  db.prepare(`
    INSERT INTO launches (
      id, idempotency_key, name, ticker, description, website, x_url, wallet,
      picture_id, image_url, user_bps, recipient_bps, status, error, states,
      mint, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, 5000, 5000, 'received', NULL, 'received',
      NULL, ?, ?
    )
  `).run(
    input.id,
    input.idempotencyKey,
    input.name,
    input.ticker,
    input.description ?? null,
    input.website ?? null,
    input.x ?? null,
    input.wallet ?? null,
    input.pictureId ?? null,
    input.imageUrl ?? null,
    stamp,
    stamp,
  );
}

export function markLaunch(db, id, { status, error = null, states, mint = null }, now) {
  db.prepare(`
    UPDATE launches
    SET status = ?, error = ?, states = ?, mint = ?, updated_at = ?
    WHERE id = ?
  `).run(status, error, states, mint, now.toISOString(), id);
}

export function seedLocalCoin(db) {
  if (!BASE58_MINT.test(LOCAL_MINT) || !BASE58_MINT.test(LOCAL_WALLET)) {
    throw new Error("bad local coin");
  }
  const existing = db.prepare(`SELECT mint FROM coins WHERE mint = ?`).get(LOCAL_MINT);
  if (existing) return false;
  insertCoin(db, {
    mint: LOCAL_MINT,
    name: "Chamber Lamp",
    ticker: "LAMP",
    image: "/assets/seed-face.png",
    description: "Local confirmed coin for the live card.",
    wallet: LOCAL_WALLET,
    recipient: "published recipient",
    status: "confirmed",
    createdAt: "2026-10-08T12:00:00.000Z",
    paidToCreatorSol: 0.0123,
    pendingFeeSol: 0.0012,
    marketCapSol: 28,
    live: true,
  });
  return true;
}

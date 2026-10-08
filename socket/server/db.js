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
  graduated INTEGER NOT NULL DEFAULT 0,
  launch_sig TEXT,
  live INTEGER NOT NULL DEFAULT 0,
  CHECK (user_bps = 5000 AND recipient_bps = 5000),
  CHECK (status IN ('received', 'quoted', 'submitted', 'confirmed', 'failed')),
  CHECK (paid_to_creator_sol >= 0),
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
  paid_to_creator_sol, graduated, launch_sig, live
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?
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

export function countLaunchesSince(db, isoStart) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM coins
    WHERE created_at >= ? AND status IN ('submitted', 'confirmed')
  `).get(isoStart);
  return Number(row.n);
}

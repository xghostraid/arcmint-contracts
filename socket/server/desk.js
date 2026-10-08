import { randomBytes } from "node:crypto";
import { DAILY_CAP, HOURLY_CAP, WALLET_DAILY_CAP, WALLET_HOURLY_CAP } from "../shared/copy.js";
import {
  countLaunchesSince,
  countWalletLaunchesSince,
  walletCoins,
  walletFailedJobs,
} from "./db.js";
import { verifyWalletSignature } from "./solana.js";

const NONCE_MS = 10 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;

function windows(now) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  return { dayStart, hourStart };
}

export function launchLimit(db, wallet, now = new Date()) {
  const { dayStart, hourStart } = windows(now);
  if (wallet) {
    if (countWalletLaunchesSince(db, wallet, hourStart) >= WALLET_HOURLY_CAP) return "wallet-hourly";
    if (countWalletLaunchesSince(db, wallet, dayStart) >= WALLET_DAILY_CAP) return "wallet-daily";
  }
  if (countLaunchesSince(db, hourStart) >= HOURLY_CAP) return "hourly";
  if (countLaunchesSince(db, dayStart) >= DAILY_CAP) return "daily";
  return null;
}

export function issueNonce(db, wallet, now = new Date()) {
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_MS).toISOString();
  db.prepare(`
    INSERT INTO nonces (nonce, wallet, expires_at, used) VALUES (?, ?, ?, 0)
  `).run(nonce, wallet, expiresAt);
  return { ok: true, nonce, expiresAt };
}

export function walletDesk(db, wallet) {
  const coins = walletCoins(db, wallet);
  const failed = walletFailedJobs(db, wallet);
  const paidSol = coins.reduce((sum, coin) => sum + Number(coin.paidToCreatorSol || 0), 0);
  return {
    ok: true,
    wallet,
    paidSol,
    coins,
    failed,
    walletHourlyCap: WALLET_HOURLY_CAP,
    walletDailyCap: WALLET_DAILY_CAP,
  };
}

export function proveWallet(db, input, now = new Date(), options = {}) {
  const wallet = typeof input?.wallet === "string" ? input.wallet.trim() : "";
  const nonce = typeof input?.nonce === "string" ? input.nonce.trim() : "";
  const signature = typeof input?.signature === "string" ? input.signature.trim() : "";
  const row = nonce
    ? db.prepare(`SELECT wallet, expires_at, used FROM nonces WHERE nonce = ?`).get(nonce)
    : null;
  const fresh = row && row.used === 0 && row.wallet === wallet && Date.parse(row.expires_at) > now.getTime();
  if (!fresh || !verifyWalletSignature(wallet, nonce, signature)) {
    return { ok: false, error: "rejected" };
  }
  db.prepare(`UPDATE nonces SET used = 1 WHERE nonce = ?`).run(nonce);
  const desk = walletDesk(db, wallet);
  if (!options.session) return { ok: true, desk };
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_MS).toISOString();
  db.prepare(`INSERT INTO sessions (token, wallet, expires_at) VALUES (?, ?, ?)`).run(token, wallet, expiresAt);
  return { ok: true, token, expiresAt, desk };
}

export function sessionWallet(db, token, now = new Date()) {
  if (!token) return null;
  const row = db.prepare(`SELECT wallet, expires_at FROM sessions WHERE token = ?`).get(token);
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return row.wallet;
}

import { createHash, randomBytes } from "node:crypto";
import { launchLimit } from "./desk.js";
import { BRAND } from "../shared/copy.js";
import { DRAFT_CARD_URI } from "./draft-card.js";
import { getLaunchByKey, insertLaunch, markLaunch } from "./db.js";
import { buildQuote } from "./quote.js";
import { treasuryCanPay } from "./treasury.js";

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const WINDOW_MS = 10 * 60 * 1000;

function clip(value, max) {
  if (value == null) return "";
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function idempotencyKey(args, now = new Date()) {
  const explicit = typeof args?.idempotency_key === "string" ? args.idempotency_key.trim() : "";
  if (KEY_RE.test(explicit)) return explicit;
  const window = Math.floor(now.getTime() / WINDOW_MS);
  const material = [
    args?.name ?? "",
    args?.ticker ?? "",
    args?.picture_id ?? "",
    args?.wallet ?? "",
    args?.image_url ?? "",
    String(window),
  ].join("|");
  return createHash("sha256").update(String(material)).digest("hex");
}

function presentLaunch(row) {
  const states = String(row.states || "").split(",").filter(Boolean);
  const paused = row.error === "paused";
  let text = "Launch failed.";
  if (paused) text = "Launches are paused.";
  else if (row.error === "blocked") text = `That name cannot impersonate ${BRAND}.`;
  else if (row.error === "wallet") text = "That fee address is not an ordinary wallet.";
  else if (row.error === "wallet-hourly") text = "This wallet is at its hourly launch cap.";
  else if (row.error === "wallet-daily") text = "This wallet is at its daily launch cap.";
  else if (row.error === "hourly" || row.error === "daily") text = "The launch cap is full.";
  else if (row.status === "quoted") text = "No mainnet transaction is sent from this build.";
  return {
    content: [{ type: "text", text }],
    isError: true,
    structuredContent: {
      ok: false,
      status: row.status,
      error: row.error,
      states,
      idempotencyKey: row.idempotency_key,
      userPercent: 50,
      recipientPercent: 50,
      mint: row.mint,
      paused,
    },
    _meta: { ui: { resourceUri: DRAFT_CARD_URI } },
  };
}

export function launchCoin(db, raw = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const env = options.env ?? process.env;
  const args = raw && typeof raw === "object" ? raw : {};
  const key = idempotencyKey(args, now);
  const prior = getLaunchByKey(db, key);
  if (prior) return presentLaunch(prior);

  const quote = buildQuote(db, args, now);
  const id = `job_${randomBytes(8).toString("hex")}`;
  const canPay = treasuryCanPay(env);

  db.exec("BEGIN");
  try {
    insertLaunch(db, {
      id,
      idempotencyKey: key,
      name: quote.name || clip(args.name, 32),
      ticker: quote.ticker || clip(args.ticker, 10),
      description: quote.description,
      website: quote.website,
      x: quote.x,
      wallet: quote.wallet,
      pictureId: quote.pictureId,
      imageUrl: quote.imageUrl,
    }, now);
    // received → quoted. The split is locked at 5000/5000 by the table.
    let states = "received,quoted";
    markLaunch(db, id, { status: "quoted", error: null, states, mint: null }, now);

    const blocked = quote.issues.some((issue) => issue.error === "blocked");
    const walletRejected = quote.issues.some((issue) => issue.field === "wallet");
    const cap = !blocked && !walletRejected ? launchLimit(db, quote.wallet, now) : null;
    if (blocked) {
      states = "received,quoted,failed";
      markLaunch(db, id, { status: "failed", error: "blocked", states, mint: null }, now);
    } else if (walletRejected) {
      states = "received,quoted,failed";
      markLaunch(db, id, { status: "failed", error: "wallet", states, mint: null }, now);
    } else if (cap) {
      states = "received,quoted,failed";
      markLaunch(db, id, { status: "failed", error: cap, states, mint: null }, now);
    } else if (!canPay) {
      states = "received,quoted,failed";
      markLaunch(db, id, { status: "failed", error: "paused", states, mint: null }, now);
    } else if (quote.issues.length) {
      states = "received,quoted,failed";
      markLaunch(db, id, { status: "failed", error: quote.issues[0].error, states, mint: null }, now);
    }
    // A balance that could pay still does not reach submitted or confirmed.
    // This step does not build or broadcast a transaction.
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    const raced = getLaunchByKey(db, key);
    if (raced) return presentLaunch(raced);
    throw err;
  }
  return presentLaunch(getLaunchByKey(db, key));
}

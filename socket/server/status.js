import { DAILY_CAP, HOURLY_CAP, RESERVE_RULE } from "../shared/copy.js";
import { formatSol, formatTokens, marqueeLine } from "../public/format.js";
import { countLaunchesSince, counts, sumBurnSol, sumBurnTokens, sumPaid } from "./db.js";

// Paused until a signer exists that can pay one launch.
// This process does not create or store that key.
export const LAUNCHES_ON = false;

export const STATUS_KEYS = Object.freeze([
  "ok",
  "coins",
  "live",
  "paidToCreatorsSol",
  "tokensBurned",
  "spentOnBurnsSol",
  "launchesOn",
  "launchesLeftToday",
  "launchesLeftThisHour",
  "dailyCap",
  "hourlyCap",
  "split",
  "reserveRule",
  "venue",
  "display",
]);

export function publicStatus(db, now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { coins, live } = counts(db);
  const paid = sumPaid(db);
  const tokens = sumBurnTokens(db);
  const leftToday = Math.max(0, DAILY_CAP - countLaunchesSince(db, dayStart));
  const leftHour = Math.max(0, HOURLY_CAP - countLaunchesSince(db, hourStart));
  const body = {
    ok: true,
    coins,
    live,
    paidToCreatorsSol: paid,
    tokensBurned: tokens,
    spentOnBurnsSol: sumBurnSol(db),
    launchesOn: LAUNCHES_ON,
    launchesLeftToday: leftToday,
    launchesLeftThisHour: leftHour,
    dailyCap: DAILY_CAP,
    hourlyCap: HOURLY_CAP,
    split: {
      userPercent: 50,
      recipientPercent: 50,
      recipient: null,
    },
    reserveRule: RESERVE_RULE,
    venue: "pump.fun",
    display: {
      leftToday: String(leftToday),
      paid: formatSol(paid),
      burned: formatTokens(tokens),
      marquee: "",
    },
  };
  body.display.marquee = marqueeLine(body);
  return body;
}

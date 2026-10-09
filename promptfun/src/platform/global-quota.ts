import type { IntentStore } from "../intents/store.js";

/** Matches getplugged.fun global caps (no per-user limit on their side). */
export const GLOBAL_SPONSORED_LAUNCHES_PER_HOUR = 30;
export const GLOBAL_SPONSORED_LAUNCHES_PER_DAY = 200;

export function assertGlobalSponsoredLaunchQuota(intents: IntentStore): void {
  const now = Date.now();
  const hourSince = now - 60 * 60 * 1000;
  const daySince = now - 24 * 60 * 60 * 1000;
  const hourCount = intents.countSponsoredLaunchesSince(hourSince);
  if (hourCount >= GLOBAL_SPONSORED_LAUNCHES_PER_HOUR) {
    throw new Error(`Global launch limit reached (${GLOBAL_SPONSORED_LAUNCHES_PER_HOUR}/hour). Try again later.`);
  }
  const dayCount = intents.countSponsoredLaunchesSince(daySince);
  if (dayCount >= GLOBAL_SPONSORED_LAUNCHES_PER_DAY) {
    throw new Error(`Global launch limit reached (${GLOBAL_SPONSORED_LAUNCHES_PER_DAY}/day). Try again tomorrow.`);
  }
}

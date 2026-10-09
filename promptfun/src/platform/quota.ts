import type { PlatformStore } from "./store.js";

export const DAILY_LAUNCH_LIMIT = 2;
export const MONTHLY_LAUNCH_LIMIT = 5;

export interface QuotaSnapshot {
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}

export function quotaSnapshot(store: PlatformStore, sub: string): QuotaSnapshot {
  return {
    dailyUsed: store.countLaunchesSince(sub, startOfUtcDay()),
    dailyLimit: DAILY_LAUNCH_LIMIT,
    monthlyUsed: store.countLaunchesSince(sub, startOfUtcMonth()),
    monthlyLimit: MONTHLY_LAUNCH_LIMIT,
  };
}

export function assertLaunchQuota(store: PlatformStore, sub: string): void {
  const q = quotaSnapshot(store, sub);
  if (q.dailyUsed >= q.dailyLimit) {
    throw new Error(`Daily launch limit reached (${q.dailyLimit}/day). Try again tomorrow UTC.`);
  }
  if (q.monthlyUsed >= q.monthlyLimit) {
    throw new Error(`Monthly launch limit reached (${q.monthlyLimit}/month).`);
  }
}

function startOfUtcDay(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcMonth(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

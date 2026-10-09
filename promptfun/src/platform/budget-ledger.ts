import type { PlatformStore } from "./store.js";

export function recordSponsorSpendUsd(store: PlatformStore, sub: string, usdEstimate: number, monthKey: string): void {
  store.addSponsorSpend(sub, usdEstimate, monthKey);
}

export function monthlySpendUsd(store: PlatformStore, monthKey: string): number {
  return store.sumSponsorSpend(monthKey);
}

export function monthKeyUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function assertMonthlyBudget(store: PlatformStore, budgetUsd: number, monthKey: string): void {
  if (budgetUsd <= 0) return;
  const spent = monthlySpendUsd(store, monthKey);
  if (spent >= budgetUsd) {
    throw new Error("promptfun's sponsored launch budget for this month is used up. Use your own wallet instead.");
  }
}

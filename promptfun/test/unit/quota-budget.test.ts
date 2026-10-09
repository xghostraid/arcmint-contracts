import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PlatformStore } from "../../src/platform/store.js";
import { assertLaunchQuota, DAILY_LAUNCH_LIMIT, quotaSnapshot } from "../../src/platform/quota.js";
import { assertMonthlyBudget, monthKeyUtc, recordSponsorSpendUsd } from "../../src/platform/budget-ledger.js";
import { sponsorBudgetSnapshot } from "../../src/sponsor/budget.js";
import { loadConfig } from "../../src/config.js";
import { resetRuntimeOpsForTests, setRuntimeSponsorPaused } from "../../src/ops/runtime.js";

test("launch quota counts per sub", () => {
  const store = new PlatformStore(":memory:");
  const sub = "abc";
  for (let i = 0; i < DAILY_LAUNCH_LIMIT; i++) store.recordLaunchQuota(sub);
  const q = quotaSnapshot(store, sub);
  assert.equal(q.dailyUsed, DAILY_LAUNCH_LIMIT);
  assert.throws(() => assertLaunchQuota(store, sub), /Daily launch limit/);
  store.close();
});

test("monthly budget ledger blocks over cap", () => {
  const store = new PlatformStore(":memory:");
  const month = monthKeyUtc();
  recordSponsorSpendUsd(store, "u1", 299, month);
  assert.doesNotThrow(() => assertMonthlyBudget(store, 300, month));
  recordSponsorSpendUsd(store, "u1", 2, month);
  assert.throws(() => assertMonthlyBudget(store, 300, month), /budget/);
  store.close();
});

test("runtime ops pause mirrors env kill switch in snapshot", () => {
  resetRuntimeOpsForTests();
  const config = loadConfig({ PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1", PROMPTFUN_SPONSOR_SECRET_KEY: "dummy" });
  setRuntimeSponsorPaused(true);
  const snap = sponsorBudgetSnapshot(config);
  assert.equal(snap.killSwitch, true);
  resetRuntimeOpsForTests();
});

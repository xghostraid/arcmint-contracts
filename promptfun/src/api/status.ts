import type http from "node:http";
import type { Config } from "../config.js";
import { monthKeyUtc, monthlySpendUsd } from "../platform/budget-ledger.js";
import type { PlatformStore } from "../platform/store.js";
import { setRuntimeSponsorPaused } from "../ops/runtime.js";
import { sponsorBudgetSnapshot } from "../sponsor/budget.js";

export function handleStatusApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  json: (status: number, body: unknown) => void,
  config: Config,
  platform: PlatformStore | null,
): boolean {
  if (pathname !== "/api/status") return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(405, { error: "Method not allowed.", code: "method_not_allowed" });
    return true;
  }
  const month = monthKeyUtc();
  const sponsored = sponsorBudgetSnapshot(config);
  json(200, {
    oauthEnabled: config.oauthEnabled,
    oauthRequired: config.oauthRequired,
    sponsoredLaunches: {
      enabled: sponsored.sponsoredLaunchesEnabled,
      killSwitch: sponsored.killSwitch,
      pauseReason: sponsored.pauseReason,
    },
    monthlyBudgetUsd: config.monthlyBudgetUsd,
    monthlySpendUsdEstimate: platform ? monthlySpendUsd(platform, month) : 0,
    month,
    generatedAt: new Date().toISOString(),
  });
  return true;
}

export function handleOpsRoutes(
  req: http.IncomingMessage,
  pathname: string,
  json: (status: number, body: unknown) => void,
  config: Config,
  readJson: () => Promise<Record<string, unknown>>,
): Promise<boolean> {
  if (pathname !== "/ops/sponsor-pause") return Promise.resolve(false);
  if (req.method !== "POST") {
    json(405, { error: "Method not allowed." });
    return Promise.resolve(true);
  }
  if (!config.opsToken) {
    json(503, { error: "Ops API is not configured." });
    return Promise.resolve(true);
  }
  const auth = String(req.headers.authorization ?? "");
  if (auth !== `Bearer ${config.opsToken}`) {
    json(401, { error: "Unauthorized." });
    return Promise.resolve(true);
  }
  return readJson().then((body) => {
    setRuntimeSponsorPaused(body.paused === true);
    json(200, { ok: true, runtimeSponsorPaused: body.paused === true });
    return true;
  });
}

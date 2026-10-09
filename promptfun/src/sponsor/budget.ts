import type { Config } from "../config.js";
import type { Chain } from "../chains/registry.js";
import { isRuntimeSponsorPaused } from "../ops/runtime.js";
import type { SponsorBudgetSnapshot } from "./types.js";

export function sponsorBudgetSnapshot(config: Config): SponsorBudgetSnapshot {
  if (config.sponsorKillSwitch || isRuntimeSponsorPaused()) {
    return { killSwitch: true, sponsoredLaunchesEnabled: false, pauseReason: "promptfun isn't paying for launches right now. Use your own wallet instead." };
  }
  if (!config.enableSponsoredLaunches) {
    return { killSwitch: false, sponsoredLaunchesEnabled: false, pauseReason: "Sponsored launches are off on this server." };
  }
  if (!config.sponsorSecretKey) {
    return { killSwitch: false, sponsoredLaunchesEnabled: false, pauseReason: "Sponsor wallet is not configured yet." };
  }
  return { killSwitch: false, sponsoredLaunchesEnabled: true, pauseReason: null };
}

export function chainAllowsSponsoredLaunch(chain: Chain): boolean {
  return chain.family === "solana" && chain.testnet && chain.actions.includes("launch_token");
}

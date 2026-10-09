import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { Config } from "../config.js";
import type { Chain } from "../chains/registry.js";
import { isRuntimeSponsorPaused } from "../ops/runtime.js";
import type { SponsorBudgetSnapshot } from "./types.js";

export function sponsorPubkeyFromConfig(config: Config): string | null {
  const secret = config.sponsorSecretKey?.trim();
  if (!secret) return null;
  try {
    const kp = secret.startsWith("[")
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)))
      : Keypair.fromSecretKey(bs58.decode(secret));
    return kp.publicKey.toBase58();
  } catch {
    return null;
  }
}

function baseSponsorOff(config: Config, pauseReason: string): SponsorBudgetSnapshot {
  return {
    killSwitch: config.sponsorKillSwitch || isRuntimeSponsorPaused(),
    sponsoredLaunchesEnabled: false,
    sponsoredTestnetsEnabled: false,
    sponsoredMainnetEnabled: false,
    pauseReason,
  };
}

export function sponsorBudgetSnapshot(config: Config): SponsorBudgetSnapshot {
  if (config.sponsorKillSwitch || isRuntimeSponsorPaused()) {
    return { ...baseSponsorOff(config, "promptfun isn't paying for launches right now. Use your own wallet instead."), killSwitch: true };
  }
  if (!config.enableSponsoredLaunches) {
    return baseSponsorOff(config, "Sponsored launches are off on this server.");
  }
  if (!config.sponsorSecretKey) {
    return baseSponsorOff(config, "Sponsor wallet is not configured yet.");
  }
  return {
    killSwitch: false,
    sponsoredLaunchesEnabled: true,
    sponsoredTestnetsEnabled: true,
    sponsoredMainnetEnabled: config.enableSponsoredMainnet,
    pauseReason: null,
  };
}

export function chainAllowsSponsoredLaunch(chain: Chain, config: Config): boolean {
  if (chain.family !== "solana" || !chain.actions.includes("launch_token")) return false;
  if (chain.testnet) return true;
  return chain.cluster === "mainnet-beta" && config.enableSponsoredMainnet && chain.launchVenues.includes("pumpfun");
}

/** Production mainnet pump.fun is sponsored-only when these flags are on (not wallet approval). */
export function mainnetPumpSponsoredProductDefault(config: Config): boolean {
  return config.enablePumpfunMainnet && config.enableSponsoredMainnet && config.enableSponsoredLaunches;
}

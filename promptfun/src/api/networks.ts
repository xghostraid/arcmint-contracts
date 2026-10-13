import type http from "node:http";
import type { Config } from "../config.js";
import { chainsForCapabilities, recommendedLaunchChainKey, type Chain } from "../chains/registry.js";
import { EVM_WALLET_FEE_NOTE } from "../brand.js";
import { sponsorBudgetSnapshot } from "../sponsor/budget.js";

/** Public /api/networks omits EVM testnets (no testnet promotion on the marketing site). */
export function chainsForPublicNetworksApi(chains: Chain[]): Chain[] {
  return chains.filter((c) => c.key !== "solana-localnet" && c.key !== "evm-localnet" && !(c.family === "evm" && c.testnet));
}

export type SiteNetworkState = "live" | "soon" | "off";

/** Whether the marketing site should show a green live chip for this chain. */
export function siteNetworkState(chain: Chain): SiteNetworkState {
  if (chain.disabledReason) return chain.testnet ? "off" : "soon";
  if (chain.key === "solana-localnet" || chain.key === "evm-localnet") return "off";
  if (chain.testnet) return "live";
  if (chain.status === "verified") return "live";
  return "soon";
}

function publicChainRow(chain: Chain) {
  const state = siteNetworkState(chain);
  const row = {
    key: chain.key,
    name: chain.name,
    family: chain.family,
    testnet: chain.testnet,
    status: chain.status,
    enabled: !chain.disabledReason,
    siteState: state,
    disabledReason: chain.disabledReason ?? null,
    actions: chain.actions,
    walletFeeNote: null as string | null,
  };
  if (chain.key === "robinhood" && state === "live") {
    row.walletFeeNote = EVM_WALLET_FEE_NOTE;
  }
  return row;
}

export function networksPayload(config: Config) {
  const chains = chainsForPublicNetworksApi(chainsForCapabilities(config)).map(publicChainRow);
  return {
    recommendedLaunchChain: recommendedLaunchChainKey(config),
    sponsoredLaunches: sponsorBudgetSnapshot(config),
    evmWalletFeeNote: EVM_WALLET_FEE_NOTE,
    chains,
    generatedAt: new Date().toISOString(),
  };
}

export function handleNetworksApi(
  req: http.IncomingMessage,
  pathname: string,
  json: (status: number, body: unknown) => void,
  config: Config,
): boolean {
  if (pathname !== "/api/networks") return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(405, { error: "Method not allowed.", code: "method_not_allowed" });
    return true;
  }
  if (req.method === "HEAD") {
    json(200, {});
    return true;
  }
  json(200, networksPayload(config));
  return true;
}

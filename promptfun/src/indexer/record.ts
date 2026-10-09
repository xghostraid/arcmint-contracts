import type { Chain as RegistryChain } from "../chains/registry.js";
import { explorerLink } from "../chains/registry.js";
import { buildShareText } from "../api/share.js";
import type { CoinDetail, CoinSummary, CreatorFees, FeeSplit, Holders, Market } from "../api/types.js";

export type Venue = "spl" | "pumpfun" | "erc20";

export interface LiveSnapshot {
  market: Market;
  holders: Holders;
  creatorFees: CreatorFees;
  feeSplit: FeeSplit;
}

export interface CoinRecord {
  id: string;
  chainKey: string;
  venue: Venue;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  imageUrl: string | null;
  creator: string;
  launchedAt: string;
  launchTx: string;
  description: string;
  metadataUri: string | null;
  recordedFrom: "receipt" | "chain-import";
  verified: string[];
  intentId: string | null;
  /** Lamports paid out via permissionless distribute_creator_fees (tracked locally after cron). */
  feePayoutAudit?: { totalLamports: string; payouts: number; lastPaidAt: string | null };
  live: LiveSnapshot;
}

export function coinId(chainKey: string, address: string): string {
  return `${chainKey}:${address}`;
}

function chainView(chain: RegistryChain) {
  return {
    key: chain.key,
    name: chain.name,
    family: chain.family,
    testnet: chain.testnet,
    nativeSymbol: chain.nativeSymbol,
  };
}

function links(chain: RegistryChain, record: CoinRecord) {
  return {
    explorer: explorerLink(chain, "address", record.address),
    launchTx: explorerLink(chain, "tx", record.launchTx),
    pumpfun:
      record.venue === "pumpfun" && !chain.testnet
        ? `https://pump.fun/coin/${record.address}`
        : null,
  };
}

export function toSummary(chain: RegistryChain, record: CoinRecord): CoinSummary {
  return {
    id: record.id,
    chain: chainView(chain),
    venue: record.venue,
    address: record.address,
    name: record.name,
    symbol: record.symbol,
    decimals: record.decimals,
    supply: record.supply,
    imageUrl: record.imageUrl,
    creator: record.creator,
    launchedAt: record.launchedAt,
    links: links(chain, record),
    market: record.live.market,
    holders: record.live.holders,
    creatorFees: record.live.creatorFees,
  };
}

export function toDetail(chain: RegistryChain, record: CoinRecord): CoinDetail {
  const summary = toSummary(chain, record);
  const share = buildShareText({
    chain: summary.chain,
    name: record.name,
    symbol: record.symbol,
    address: record.address,
    explorer: summary.links.explorer,
  });
  return {
    ...summary,
    description: record.description,
    metadataUri: record.metadataUri,
    launchTx: record.launchTx,
    recordedFrom: record.recordedFrom,
    verified: record.verified,
    feeSplit: record.live.feeSplit,
    share,
  };
}

import { PublicKey } from "@solana/web3.js";
import { getMint, getTokenMetadata, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createPublicClient, http, type Hex } from "viem";
import type { Config } from "../config.js";
import type { Chain } from "../chains/registry.js";
import { connectionFor } from "../chains/solana/adapter.js";
import { formatUnits } from "../util/amount.js";
import type { CoinRecord, LiveSnapshot, Venue } from "./record.js";

const ERC20_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

function testnetMarket(chain: Chain, readAt: string) {
  return {
    priceNative: null,
    marketCapNative: null,
    priceUsd: null,
    marketCapUsd: null,
    graduated: null,
    source: null,
    reason: chain.testnet
      ? `${chain.name} coin: testnet has no markets, so there is no price.`
      : null,
    readAt,
  };
}

function plainSplFees(chain: Chain, readAt: string) {
  return {
    creatorFees: {
      symbol: chain.nativeSymbol,
      paid: null,
      waiting: null,
      payouts: null,
      lastPaidAt: null,
      complete: true,
      source: null,
      reason: "Plain SPL token: creator fees exist only for pump.fun coins.",
      readAt,
    },
    feeSplit: {
      recipients: null,
      locked: null,
      source: null,
      reason: "Plain SPL token: creator fees exist only for pump.fun coins.",
      readAt,
    },
  };
}

function plainErc20Fees(chain: Chain, readAt: string) {
  return {
    creatorFees: {
      symbol: chain.nativeSymbol,
      paid: null,
      waiting: null,
      payouts: null,
      lastPaidAt: null,
      complete: true,
      source: null,
      reason: "Plain ERC-20 token: no creator fees exist for it.",
      readAt,
    },
    feeSplit: {
      recipients: null,
      locked: null,
      source: null,
      reason: "Plain ERC-20 token: no creator fees exist for it.",
      readAt,
    },
  };
}

export function defaultLiveSnapshot(chain: Chain, venue: Venue): LiveSnapshot {
  const readAt = new Date().toISOString();
  const market = testnetMarket(chain, readAt);
  const holders: LiveSnapshot["holders"] = {
    count: null,
    exact: false,
    source: null,
    reason: "Live holder count has not been read yet.",
    readAt,
  };
  const fees = venue === "erc20" ? plainErc20Fees(chain, readAt) : plainSplFees(chain, readAt);
  return { market, holders, creatorFees: fees.creatorFees, feeSplit: fees.feeSplit };
}

export async function refreshLive(config: Config, chain: Chain, record: CoinRecord): Promise<LiveSnapshot> {
  const readAt = new Date().toISOString();
  if (chain.testnet) {
    const base = defaultLiveSnapshot(chain, record.venue);
    base.market = testnetMarket(chain, readAt);
    try {
      if (chain.family === "solana") {
        base.holders = await holdersSolana(chain, record.address, readAt);
      } else {
        base.holders = await holdersEvm(chain, record.address, readAt);
      }
    } catch (err) {
      base.holders = {
        count: null,
        exact: false,
        source: null,
        reason: `Could not read holders: ${(err as Error).message}`,
        readAt,
      };
    }
    return base;
  }
  // Mainnet live reads (pump.fun / Jupiter) are not enabled in v1 indexer; honest nulls.
  const snap = defaultLiveSnapshot(chain, record.venue);
  snap.market.reason = record.venue === "pumpfun"
    ? "Mainnet pump.fun pricing is not refreshed on this server yet."
    : "Market data is not refreshed on this server yet.";
  return snap;
}

async function holdersSolana(chain: Chain, mintAddress: string, readAt: string) {
  const conn = connectionFor(chain as never);
  const mint = new PublicKey(mintAddress);
  const largest = await conn.getTokenLargestAccounts(mint, "confirmed");
  const withBalance = largest.value.filter((a) => BigInt(a.amount) > 0n);
  return {
    count: withBalance.length,
    exact: false,
    source: "getTokenLargestAccounts (token accounts with a balance)",
    reason: withBalance.length >= 20 ? "Solana returns at most 20 largest accounts; count is a lower bound." : null,
    readAt,
  };
}

async function holdersEvm(chain: Chain, _token: string, readAt: string) {
  const explorerUrl = chain.family === "evm" ? chain.explorerUrl : null;
  if (!explorerUrl) {
    return {
      count: null,
      exact: false,
      source: null,
      reason: "No explorer API is configured for holder counts on this chain.",
      readAt,
    };
  }
  return {
    count: null,
    exact: false,
    source: explorerUrl,
    reason: "Holder count is not read automatically on this EVM chain yet.",
    readAt,
  };
}

export async function readSolanaMintMeta(chain: Chain, mintAddress: string) {
  const conn = connectionFor(chain as never);
  const mint = new PublicKey(mintAddress);
  const info = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const meta = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
  return {
    decimals: info.decimals,
    supply: formatUnits(info.supply, info.decimals),
    name: meta?.name ?? "Unknown",
    symbol: meta?.symbol ?? "?",
    uri: meta?.uri ?? null,
  };
}

export async function readEvmTokenMeta(chain: Chain, address: Hex) {
  const client = createPublicClient({ transport: http(chain.rpcUrl) });
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: "name" }),
    client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
    client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address, abi: ERC20_ABI, functionName: "totalSupply" }),
  ]);
  return {
    name,
    symbol,
    decimals: Number(decimals),
    supply: formatUnits(totalSupply, Number(decimals)),
  };
}

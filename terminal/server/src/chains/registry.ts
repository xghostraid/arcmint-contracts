import type { NetworkKey } from "../config.js";
import type { ChainFamily } from "./families.js";

export type ChainId = "solana-local" | "solana-devnet" | "solana-mainnet" | "base" | "bsc" | "ethereum";

export interface ChainInfo {
  id: ChainId;
  family: ChainFamily;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  /** "planned" chains are listed so the UI and data model know about them; no adapter exists yet. */
  status: "active" | "planned";
  bundles: "jito" | "none";
  explorerTx(sig: string): string;
  explorerAddress(addr: string): string;
}

function solscan(cluster: string | null) {
  const q = cluster ? `?cluster=${cluster}` : "";
  return {
    explorerTx: (sig: string) => `https://solscan.io/tx/${sig}${q}`,
    explorerAddress: (addr: string) => `https://solscan.io/account/${addr}${q}`,
  };
}

function localExplorer() {
  const q = "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899";
  return {
    explorerTx: (sig: string) => `https://explorer.solana.com/tx/${sig}${q}`,
    explorerAddress: (addr: string) => `https://explorer.solana.com/address/${addr}${q}`,
  };
}

function evmPlanned(id: ChainId, name: string, symbol: string, explorer: string): ChainInfo {
  return {
    id,
    family: "evm",
    name,
    nativeSymbol: symbol,
    nativeDecimals: 18,
    status: "planned",
    bundles: "none",
    explorerTx: (h) => `${explorer}/tx/${h}`,
    explorerAddress: (a) => `${explorer}/address/${a}`,
  };
}

export const CHAINS: Record<ChainId, ChainInfo> = {
  "solana-local": { id: "solana-local", family: "solana", name: "Solana local validator", nativeSymbol: "SOL", nativeDecimals: 9, status: "active", bundles: "none", ...localExplorer() },
  "solana-devnet": { id: "solana-devnet", family: "solana", name: "Solana devnet", nativeSymbol: "SOL", nativeDecimals: 9, status: "active", bundles: "none", ...solscan("devnet") },
  "solana-mainnet": { id: "solana-mainnet", family: "solana", name: "Solana mainnet", nativeSymbol: "SOL", nativeDecimals: 9, status: "active", bundles: "jito", ...solscan(null) },
  base: evmPlanned("base", "Base", "ETH", "https://basescan.org"),
  bsc: evmPlanned("bsc", "BNB Smart Chain", "BNB", "https://bscscan.com"),
  ethereum: evmPlanned("ethereum", "Ethereum", "ETH", "https://etherscan.io"),
};

export function solanaChainFor(network: NetworkKey): ChainInfo {
  return CHAINS[network === "local" ? "solana-local" : network === "devnet" ? "solana-devnet" : "solana-mainnet"];
}

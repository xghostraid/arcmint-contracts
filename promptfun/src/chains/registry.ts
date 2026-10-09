import type { Config } from "../config.js";

export type Family = "solana" | "evm";
export type ActionKind = "launch_token" | "transfer";
/**
 * verified   — proven end to end; `evidence` names how.
 * configured — in the registry and wired to the same adapter code, but not run end to end here.
 * gated      — real money; only active behind an explicit flag.
 */
export type ChainStatus = "verified" | "configured" | "gated";

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

interface ChainBase {
  key: string;
  name: string;
  family: Family;
  testnet: boolean;
  status: ChainStatus;
  evidence: string;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
  actions: ActionKind[];
  tokens: TokenInfo[];
  /** Why this chain is off, when it is. */
  disabledReason?: string;
}

export interface SolanaChain extends ChainBase {
  family: "solana";
  cluster: "localnet" | "devnet" | "mainnet-beta";
  walletChain: "solana:localnet" | "solana:devnet" | "solana:mainnet";
  launchVenues: Array<"spl" | "pumpfun">;
}

export interface EvmChain extends ChainBase {
  family: "evm";
  chainId: number;
  explorerUrl: string | null;
  stack: "l1" | "op-stack" | "arbitrum-nitro" | "pos";
  /** Build order after Solana: lower comes first. */
  priority: number;
}

export type Chain = SolanaChain | EvmChain;

function rpc(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[`PROMPTFUN_RPC_${key.toUpperCase().replace(/-/g, "_")}`] || fallback;
}

export function allChains(config: Config): Chain[] {
  const env = config.env;
  const solana: SolanaChain[] = [
    {
      key: "solana-localnet",
      name: "Solana local validator",
      family: "solana",
      testnet: true,
      status: "verified",
      evidence:
        "Automated end-to-end tests (test/e2e/solana-localnet.e2e.ts) launch a Token-2022 coin and send SOL and SPL tokens through the MCP server, approval API, and chain-read receipts against solana-test-validator. Local only: these transactions do not exist on any public network.",
      rpcUrl: rpc(env, "solana-localnet", "http://127.0.0.1:8899"),
      nativeSymbol: "SOL",
      nativeDecimals: 9,
      actions: ["launch_token", "transfer"],
      tokens: [],
      cluster: "localnet",
      walletChain: "solana:localnet",
      launchVenues: ["spl"],
      disabledReason: config.enableLocalnet ? undefined : "Set PROMPTFUN_ENABLE_LOCALNET=1 and run solana-test-validator.",
    },
    {
      key: "solana-devnet",
      name: "Solana devnet",
      family: "solana",
      testnet: true,
      status: "verified",
      evidence:
        "Run end to end on public devnet on 2026-10-09 through the MCP tools and the approval page (scripts/devnet-demo.ts): Token-2022 launch Lvr3Gs42ZPMteZZZrDG48g3S9peoC6pg2UneTWPa5GHy2rUTwqe5Jmeuna8r42XPusL8SYcXVk6iB4bR9LKf1EY (mint 9T2ZGEjbngvadmgZQouQgHRaA2pDFLkcpb3Mo2faikds), token transfer 2ZRSbzmC3fDyGrG4g3f9xJkCLkaRZdSpwtWhPs57i2eyYPaLRHBUBhUpfB919bHXyC5abhxWQBAUjFttMW7G5SE7, SOL transfer 2o5CqE8gtZGhiAxCKGht5awAQmGBahvXxLaYDf1gmd6c6m5CwW7U5X1BcAnAhLvMk9Un5xNBkfYnBSeNNj5K4KsQ, each receipt read from chain. Signed by a Wallet Standard test wallet, not yet by Phantom itself.",
      rpcUrl: rpc(env, "solana-devnet", "https://api.devnet.solana.com"),
      nativeSymbol: "SOL",
      nativeDecimals: 9,
      actions: ["launch_token", "transfer"],
      tokens: [{ symbol: "USDC", address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 }],
      cluster: "devnet",
      walletChain: "solana:devnet",
      launchVenues: config.enablePumpfunDevnet ? ["spl", "pumpfun"] : ["spl"],
    },
    {
      key: "solana-mainnet",
      name: "Solana mainnet (pump.fun launches only)",
      family: "solana",
      testnet: false,
      status: "gated",
      evidence:
        "pump.fun has no testnet. The pump.fun launch transaction is built with the official @pump-fun/pump-sdk and simulated, but promptfun has never broadcast one. Real SOL is spent.",
      rpcUrl: rpc(env, "solana-mainnet", "https://api.mainnet-beta.solana.com"),
      nativeSymbol: "SOL",
      nativeDecimals: 9,
      actions: ["launch_token"],
      tokens: [],
      cluster: "mainnet-beta",
      walletChain: "solana:mainnet",
      launchVenues: ["pumpfun"],
      disabledReason: config.enablePumpfunMainnet
        ? undefined
        : "Mainnet is off. Set PROMPTFUN_ENABLE_PUMPFUN_MAINNET=1 for pump.fun launches (real SOL; single-user local runs only until OAuth lands).",
    },
  ];
  return [...solana, ...evmChains(config)];
}

/** EVM registry entries are added by the EVM adapter module once it is built. */
let evmChains: (config: Config) => EvmChain[] = () => [];
export function registerEvmChains(fn: (config: Config) => EvmChain[]): void {
  evmChains = fn;
}

export function enabledChains(config: Config): Chain[] {
  return allChains(config).filter((chain) => !chain.disabledReason);
}

export function findChain(config: Config, key: string): Chain | undefined {
  return allChains(config).find((chain) => chain.key === key);
}

export function explorerLink(chain: Chain, kind: "tx" | "address", id: string): string | null {
  if (chain.family === "solana") {
    const base = `https://explorer.solana.com/${kind}/${id}`;
    if (chain.cluster === "mainnet-beta") return base;
    if (chain.cluster === "devnet") return `${base}?cluster=devnet`;
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(chain.rpcUrl)}`;
  }
  if (!chain.explorerUrl) return null;
  return `${chain.explorerUrl}/${kind}/${id}`;
}

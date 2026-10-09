import type { Config } from "../../config.js";
import type { EvmChain } from "../registry.js";

interface Spec {
  key: string;
  name: string;
  chainId: number;
  rpc: string;
  explorer: string;
  native: string;
  stack: EvmChain["stack"];
  priority: number;
  testnet: boolean;
  source: string;
}

/**
 * Build order after Solana (user priority): 1) Ethereum, 2) Robinhood Chain, 3) Base, then the rest.
 * Every value below comes from the network's official docs; Robinhood Chain values were also checked live
 * (eth_chainId on both public RPCs, 2026-10-09).
 */
const SPECS: Spec[] = [
  { key: "ethereum-sepolia", name: "Ethereum Sepolia", chainId: 11155111, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", native: "ETH", stack: "l1", priority: 1, testnet: true, source: "https://ethereum.org/en/developers/docs/networks/" },
  { key: "ethereum", name: "Ethereum", chainId: 1, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io", native: "ETH", stack: "l1", priority: 1, testnet: false, source: "https://ethereum.org/en/developers/docs/networks/" },
  { key: "robinhood-testnet", name: "Robinhood Chain Testnet", chainId: 46630, rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", native: "ETH", stack: "arbitrum-nitro", priority: 2, testnet: true, source: "https://docs.robinhood.com/chain/connecting/" },
  { key: "robinhood", name: "Robinhood Chain", chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", native: "ETH", stack: "arbitrum-nitro", priority: 2, testnet: false, source: "https://docs.robinhood.com/chain/connecting/" },
  { key: "base-sepolia", name: "Base Sepolia", chainId: 84532, rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org", native: "ETH", stack: "op-stack", priority: 3, testnet: true, source: "https://docs.base.org/base-chain/quickstart/connecting-to-base" },
  { key: "base", name: "Base", chainId: 8453, rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: "ETH", stack: "op-stack", priority: 3, testnet: false, source: "https://docs.base.org/base-chain/quickstart/connecting-to-base" },
  { key: "arbitrum-sepolia", name: "Arbitrum Sepolia", chainId: 421614, rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io", native: "ETH", stack: "arbitrum-nitro", priority: 4, testnet: true, source: "https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers" },
  { key: "arbitrum", name: "Arbitrum One", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: "ETH", stack: "arbitrum-nitro", priority: 4, testnet: false, source: "https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers" },
  { key: "optimism-sepolia", name: "OP Sepolia", chainId: 11155420, rpc: "https://sepolia.optimism.io", explorer: "https://sepolia-optimism.etherscan.io", native: "ETH", stack: "op-stack", priority: 4, testnet: true, source: "https://docs.optimism.io/chain/networks" },
  { key: "optimism", name: "OP Mainnet", chainId: 10, rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io", native: "ETH", stack: "op-stack", priority: 4, testnet: false, source: "https://docs.optimism.io/chain/networks" },
  { key: "polygon-amoy", name: "Polygon Amoy", chainId: 80002, rpc: "https://rpc-amoy.polygon.technology", explorer: "https://amoy.polygonscan.com", native: "POL", stack: "pos", priority: 4, testnet: true, source: "https://docs.polygon.technology/pos/reference/rpc-endpoints/" },
  { key: "polygon", name: "Polygon PoS", chainId: 137, rpc: "https://polygon-rpc.com", explorer: "https://polygonscan.com", native: "POL", stack: "pos", priority: 4, testnet: false, source: "https://docs.polygon.technology/pos/reference/rpc-endpoints/" },
  { key: "bnb-testnet", name: "BNB Smart Chain Testnet", chainId: 97, rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", explorer: "https://testnet.bscscan.com", native: "BNB", stack: "pos", priority: 4, testnet: true, source: "https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/" },
  { key: "bnb", name: "BNB Smart Chain", chainId: 56, rpc: "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com", native: "BNB", stack: "pos", priority: 4, testnet: false, source: "https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/" },
];

/** Set by the EVM adapter module when it is installed; until then EVM chains are listed but off. */
let adapterReady = false;
export function markEvmAdapterReady(): void {
  adapterReady = true;
}

function rpc(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[`PROMPTFUN_RPC_${key.toUpperCase().replace(/-/g, "_")}`] || fallback;
}

export function evmChains(config: Config): EvmChain[] {
  return SPECS.map((spec): EvmChain => {
    const disabledReason = !adapterReady
      ? "The EVM adapter is not built yet. Solana ships first; EVM order is Ethereum, Robinhood Chain, Base."
      : !spec.testnet && !config.enableEvmMainnets
        ? "Mainnet is off. Set PROMPTFUN_ENABLE_EVM_MAINNETS=1 (real funds; single-user local runs only until OAuth lands)."
        : undefined;
    return {
      key: spec.key,
      name: spec.name,
      family: "evm",
      testnet: spec.testnet,
      status: spec.testnet ? "configured" : "gated",
      evidence: spec.testnet
        ? `Network values from ${spec.source}. Not yet run end to end by promptfun.`
        : `Real-money network, values from ${spec.source}. Never broadcast by promptfun; off unless explicitly enabled.`,
      rpcUrl: rpc(config.env, spec.key, spec.rpc),
      nativeSymbol: spec.native,
      nativeDecimals: 18,
      actions: ["launch_token", "transfer"],
      tokens: [],
      chainId: spec.chainId,
      explorerUrl: spec.explorer,
      stack: spec.stack,
      priority: spec.priority,
      disabledReason,
    };
  });
}

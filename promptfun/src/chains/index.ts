import type { ChainAdapter } from "./adapter.js";
import { registerEvmChains, type Family } from "./registry.js";
import { solanaAdapter } from "./solana/adapter.js";
import { evmAdapter } from "./evm/adapter.js";
import { evmChains, markEvmAdapterReady } from "./evm/chains.js";

registerEvmChains(evmChains);
markEvmAdapterReady();

const adapters: Partial<Record<Family, ChainAdapter>> = { solana: solanaAdapter, evm: evmAdapter };

export function registerAdapter(family: Family, adapter: ChainAdapter): void {
  adapters[family] = adapter;
}

export function adapterFor(family: Family): ChainAdapter {
  const adapter = adapters[family];
  if (!adapter) throw new Error(`No adapter for the ${family} family is installed.`);
  return adapter;
}

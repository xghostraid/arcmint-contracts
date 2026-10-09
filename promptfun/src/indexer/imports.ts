import { getAddress, type Hex } from "viem";
import type { Config } from "../config.js";
import { findChain } from "../chains/registry.js";
import { connectionFor } from "../chains/solana/adapter.js";
import { decodeInstructions } from "../chains/solana/decode.js";
import { deployData } from "../chains/evm/token.js";
import { createPublicClient, http } from "viem";
import { coinId, type CoinRecord } from "./record.js";
import { defaultLiveSnapshot, readEvmTokenMeta, readSolanaMintMeta } from "./live.js";

/** Verified promptfun launches on public testnets (see README / registry evidence). */
export const CHAIN_IMPORTS = [
  {
    chainKey: "solana-devnet",
    launchTx: "Lvr3Gs42ZPMteZZZrDG48g3S9peoC6pg2UneTWPa5GHy2rUTwqe5Jmeuna8r42XPusL8SYcXVk6iB4bR9LKf1EY",
    address: "9T2ZGEjbngvadmgZQouQgHRaA2pDFLkcpb3Mo2faikds",
  },
  {
    chainKey: "robinhood-testnet",
    launchTx: "0x046eb9dc67e3e65795938f81d37c80d143414e96fc8d1fbb4f92b644283e28e5",
    address: "0x9381DFa468Bf1a15432EC0Ca3A2Aef84274FA5c6",
  },
] as const;

export async function importKnownCoin(config: Config, spec: (typeof CHAIN_IMPORTS)[number]): Promise<CoinRecord | null> {
  const chain = findChain(config, spec.chainKey);
  if (!chain) return null;
  if (chain.family === "solana") return importSolanaLaunch(config, chain, spec.launchTx, spec.address);
  return importEvmLaunch(config, chain, spec.launchTx as Hex, getAddress(spec.address));
}

async function importSolanaLaunch(config: Config, chain: ReturnType<typeof findChain>, launchTx: string, mintExpected: string): Promise<CoinRecord | null> {
  if (!chain || chain.family !== "solana") return null;
  const conn = connectionFor(chain);
  const tx = await conn.getTransaction(launchTx, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.transaction) return null;
  const message = tx.transaction.message;
  const keys = message.getAccountKeys().staticAccountKeys;
  const ixs = message.compiledInstructions.map((ix) => ({
    programId: keys[ix.programIdIndex]!,
    keys: ix.accountKeyIndexes.map((i) => ({ pubkey: keys[i]!, isSigner: false, isWritable: false })),
    data: Buffer.from(ix.data),
  }));
  const decoded = decodeInstructions(ixs as never, new Map());
  if (!decoded.createdMint?.seed.startsWith("pf")) return null;
  const mint = decoded.createdMint.mint;
  if (mint !== mintExpected) return null;
  const meta = await readSolanaMintMeta(chain, mint);
  const signer = decoded.createdMint.base;
  const launchedAt = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();
  const verified = [
    `Mint ${mint} created by ${signer} with promptfun's launch seed ${decoded.createdMint.seed}.`,
    `Name and symbol read from chain: ${meta.name} (${meta.symbol}).`,
    `Supply on chain: ${meta.supply} ${meta.symbol}.`,
  ];
  const record: CoinRecord = {
    id: coinId(chain.key, mint),
    chainKey: chain.key,
    venue: "spl",
    address: mint,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    supply: meta.supply,
    imageUrl: null,
    creator: signer,
    launchedAt,
    launchTx,
    description: "Devnet demo token launched through promptfun.fun's MCP tools.",
    metadataUri: meta.uri,
    recordedFrom: "chain-import",
    verified,
    intentId: null,
    live: defaultLiveSnapshot(chain, "spl"),
  };
  return record;
}

async function importEvmLaunch(config: Config, chain: ReturnType<typeof findChain>, launchTx: Hex, tokenExpected: Hex): Promise<CoinRecord | null> {
  if (!chain || chain.family !== "evm") return null;
  const client = createPublicClient({ transport: http(chain.rpcUrl) });
  const receipt = await client.getTransactionReceipt({ hash: launchTx }).catch(() => null);
  const tx = await client.getTransaction({ hash: launchTx }).catch(() => null);
  if (!receipt?.contractAddress || !tx) return null;
  const token = getAddress(receipt.contractAddress);
  if (token.toLowerCase() !== tokenExpected.toLowerCase()) return null;
  const meta = await readEvmTokenMeta(chain, token);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const launchedAt = new Date(Number(block.timestamp) * 1000).toISOString();
  const verified = [
    `Contract ${token} deployed by ${tx.from} with promptfun's PromptfunToken bytecode.`,
    `Name and symbol read from chain: ${meta.name} (${meta.symbol}).`,
    `Supply on chain: ${meta.supply} ${meta.symbol}.`,
  ];
  const record: CoinRecord = {
    id: coinId(chain.key, token),
    chainKey: chain.key,
    venue: "erc20",
    address: token,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    supply: meta.supply,
    imageUrl: null,
    creator: getAddress(tx.from),
    launchedAt,
    launchTx,
    description: "Robinhood Chain Testnet demo token launched through promptfun.fun's MCP tools.",
    metadataUri: null,
    recordedFrom: "chain-import",
    verified,
    intentId: null,
    live: defaultLiveSnapshot(chain, "erc20"),
  };
  return record;
}

/** Verify deploy calldata matches promptfun token for sanity checks in tests. */
export function deployMatchesPromptfun(name: string, symbol: string, decimals: number, supplyBase: bigint, input: Hex): boolean {
  return deployData(name, symbol, decimals, supplyBase).toLowerCase() === input.toLowerCase();
}

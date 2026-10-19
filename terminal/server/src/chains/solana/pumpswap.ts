import { createRequire } from "node:module";
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import type { SwapSolanaState } from "@pump-fun/pump-swap-sdk";
import type { IxGroup } from "./pack.js";
import { InputError } from "../../errors.js";

type PumpSwapSdk = typeof import("@pump-fun/pump-swap-sdk");
let mod: PumpSwapSdk | null = null;
/** Loaded through CJS for the same reason as the Pump.fun SDK. */
export function pumpSwapSdk(): PumpSwapSdk {
  mod ??= createRequire(import.meta.url)("@pump-fun/pump-swap-sdk") as PumpSwapSdk;
  return mod;
}

export const SWAP_CU = 220_000;

/** Pool account layout: discriminator(8) pool_bump(1) index(2) creator(32) base_mint(32) quote_mint(32). */
const POOL_BASE_MINT_OFFSET = 43;
const POOL_QUOTE_MINT_OFFSET = 75;

export interface PoolSnapshot {
  pool: string;
  baseReserve: bigint;
  quoteReserve: bigint;
  virtualQuoteReserve: bigint;
  baseSupply: bigint;
  canonical: boolean;
}

export interface Reserves {
  base: bigint;
  quote: bigint;
}

export class PumpSwap {
  constructor(private readonly conn: Connection) {}

  /** The canonical pool a graduated Pump.fun coin migrates to, else any SOL-quoted pool for the mint. */
  async findPool(mint: PublicKey): Promise<{ pool: PublicKey; canonical: boolean } | null> {
    const sdk = pumpSwapSdk();
    const canonical = sdk.canonicalPumpPoolPda(mint);
    if (await this.conn.getAccountInfo(canonical, "confirmed")) return { pool: canonical, canonical: true };
    const found = await this.conn
      .getProgramAccounts(sdk.PUMP_AMM_PROGRAM_ID, {
        commitment: "confirmed",
        dataSlice: { offset: 0, length: 0 },
        filters: [{ memcmp: { offset: POOL_BASE_MINT_OFFSET, bytes: mint.toBase58() } }, { memcmp: { offset: POOL_QUOTE_MINT_OFFSET, bytes: NATIVE_MINT.toBase58() } }],
      })
      .catch(() => []);
    return found.length ? { pool: found[0]!.pubkey, canonical: false } : null;
  }

  /** Pool, config and reserves, fetched once and reused for every wallet in a batch. */
  async state(pool: PublicKey): Promise<SwapSolanaState> {
    const online = new (pumpSwapSdk().OnlinePumpAmmSdk)(this.conn);
    return online.swapSolanaState(pool, PublicKey.default);
  }

  /** `base` with the user-specific accounts filled in for each owner (one RPC round trip). */
  async forUsers(base: SwapSolanaState, users: PublicKey[]): Promise<SwapSolanaState[]> {
    const pairs = users.map((u) => ({
      user: u,
      baseAta: getAssociatedTokenAddressSync(base.baseMint, u, true, base.baseTokenProgram),
      quoteAta: getAssociatedTokenAddressSync(base.pool.quoteMint, u, true, base.quoteTokenProgram),
    }));
    const infos = await this.conn.getMultipleAccountsInfo(pairs.flatMap((p) => [p.baseAta, p.quoteAta]), "confirmed");
    return pairs.map((p, i) => ({ ...base, user: p.user, userBaseTokenAccount: p.baseAta, userQuoteTokenAccount: p.quoteAta, userBaseAccountInfo: infos[2 * i] ?? null, userQuoteAccountInfo: infos[2 * i + 1] ?? null }));
  }

  snapshot(st: SwapSolanaState, canonical: boolean): PoolSnapshot {
    return {
      pool: st.poolKey.toBase58(),
      baseReserve: BigInt(st.poolBaseAmount.toString()),
      quoteReserve: BigInt(st.poolQuoteAmount.toString()),
      virtualQuoteReserve: BigInt(st.pool.virtualQuoteReserves.toString()),
      baseSupply: BigInt(st.baseMintAccount.supply.toString()),
      canonical,
    };
  }
}

function quoteArgs(st: SwapSolanaState, r: Reserves) {
  return {
    baseReserve: new BN(r.base.toString()),
    quoteReserve: new BN(r.quote.toString()),
    virtualQuoteReserves: st.pool.virtualQuoteReserves,
    globalConfig: st.globalConfig,
    baseMintAccount: st.baseMintAccount,
    baseMint: st.baseMint,
    coinCreator: st.pool.coinCreator,
    creator: st.pool.creator,
    feeConfig: st.feeConfig,
    quoteMint: st.pool.quoteMint,
    isMayhemMode: st.pool.isMayhemMode,
    creatorFeeBps: st.pool.creatorFeeBps,
  };
}

export function reservesOf(st: SwapSolanaState): Reserves {
  return { base: BigInt(st.poolBaseAmount.toString()), quote: BigInt(st.poolQuoteAmount.toString()) };
}

/** Tokens out and the max SOL in for spending `lamports` against reserves `r`. */
export function swapQuoteBuy(st: SwapSolanaState, r: Reserves, lamports: bigint, slippageBps: number): { tokens: bigint; maxLamports: bigint; poolQuoteIn: bigint } {
  const q = pumpSwapSdk().buyQuoteInput({ ...quoteArgs(st, r), quote: new BN(lamports.toString()), slippage: slippageBps / 100 });
  return { tokens: BigInt(q.base.toString()), maxLamports: BigInt(q.maxQuote.toString()), poolQuoteIn: BigInt(q.internalQuoteWithoutFees.toString()) };
}

export function swapQuoteSell(st: SwapSolanaState, r: Reserves, tokens: bigint, slippageBps: number): { lamports: bigint; minLamports: bigint; poolQuoteOut: bigint } {
  const q = pumpSwapSdk().sellBaseInput({ ...quoteArgs(st, r), base: new BN(tokens.toString()), slippage: slippageBps / 100 });
  return { lamports: BigInt(q.uiQuote.toString()), minLamports: BigInt(q.minQuote.toString()), poolQuoteOut: BigInt(q.internalQuoteAmountOut.toString()) };
}

/** Reserves after a buy or sell, so the next wallet in a batch is quoted against the pool the previous one leaves. */
export function applySwap(r: Reserves, side: "buy" | "sell", tokens: bigint, poolQuote: bigint): Reserves {
  if (side === "buy") {
    if (tokens >= r.base) throw new InputError("Buys exceed the pool's token reserve");
    return { base: r.base - tokens, quote: r.quote + poolQuote };
  }
  return { base: r.base + tokens, quote: r.quote > poolQuote ? r.quote - poolQuote : 0n };
}

/** Spot price in lamports per base unit, including the pool's virtual quote reserve. */
export function poolPrice(snapshot: Pick<PoolSnapshot, "baseReserve" | "quoteReserve" | "virtualQuoteReserve">): number {
  if (snapshot.baseReserve === 0n) return 0;
  return Number(snapshot.quoteReserve + snapshot.virtualQuoteReserve) / Number(snapshot.baseReserve);
}

export async function swapBuyGroup(st: SwapSolanaState, user: Keypair, tokens: bigint, maxLamports: bigint, label: string): Promise<IxGroup> {
  const instructions = await pumpSwapSdk().PUMP_AMM_SDK.buyInstructions(st, new BN(tokens.toString()), new BN(maxLamports.toString()));
  return { label, instructions, signers: [user], computeUnits: SWAP_CU };
}

export async function swapSellGroup(st: SwapSolanaState, user: Keypair, tokens: bigint, minLamports: bigint, label: string): Promise<IxGroup> {
  const instructions = await pumpSwapSdk().PUMP_AMM_SDK.sellInstructions(st, new BN(tokens.toString()), new BN(minLamports.toString()));
  return { label, instructions, signers: [user], computeUnits: SWAP_CU };
}

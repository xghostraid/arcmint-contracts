import { SystemProgram, type Keypair, type PublicKey } from "@solana/web3.js";
import type { IxGroup } from "./pack.js";

export const BASE_FEE_LAMPORTS = 5_000n;
/** Rent-exempt minimum for a 0-byte system account; a balance between 1 and this is rejected by the runtime. */
export const RENT_EXEMPT_MIN = 890_880n;
export const TRANSFER_CU = 450;

export function transferGroup(from: Keypair, to: PublicKey, lamports: bigint, label: string): IxGroup {
  if (lamports <= 0n) throw new Error(`${label}: amount must be positive`);
  return {
    label,
    instructions: [SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })],
    signers: [from],
    computeUnits: TRANSFER_CU,
  };
}

export function priorityFeeLamports(microLamports: number, computeUnits: number): bigint {
  return BigInt(Math.ceil((microLamports * computeUnits) / 1_000_000));
}

/**
 * How much a wallet can send while paying its own fee and keeping `reserve`.
 * A non-zero remainder below the rent-exempt minimum would fail, so a small reserve is raised to that minimum.
 */
export function sweepAmount(balance: bigint, reserve: bigint, fee: bigint): { amount: bigint; reserve: bigint } {
  const keep = reserve > 0n && reserve < RENT_EXEMPT_MIN ? RENT_EXEMPT_MIN : reserve;
  const amount = balance - fee - keep;
  return { amount: amount > 0n ? amount : 0n, reserve: keep };
}

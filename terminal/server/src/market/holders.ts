import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface Holder {
  owner: string;
  amount: bigint;
}

export interface HolderSnapshot {
  /** All non-empty token accounts when the RPC allows a program scan, else the 20 largest. */
  holders: Holder[];
  complete: boolean;
}

/** Owner(32) at offset 32 and amount(u64) at offset 64 in both SPL Token and Token-2022 accounts. */
const SLICE = { offset: 32, length: 40 };

export async function holderSnapshot(conn: Connection, mint: PublicKey, tokenProgram: PublicKey): Promise<HolderSnapshot> {
  try {
    const filters = [{ memcmp: { offset: 0, bytes: mint.toBase58() } }, ...(tokenProgram.equals(TOKEN_PROGRAM_ID) ? [{ dataSize: 165 }] : [])];
    const accounts = await conn.getProgramAccounts(tokenProgram, { commitment: "confirmed", dataSlice: SLICE, filters });
    return { holders: merge(accounts.map((a) => ({ owner: new PublicKey(a.account.data.subarray(0, 32)).toBase58(), amount: a.account.data.readBigUInt64LE(32) }))), complete: true };
  } catch {
    const largest = await conn.getTokenLargestAccounts(mint, "confirmed");
    const infos = await conn.getMultipleAccountsInfo(largest.value.map((a) => a.address), "confirmed");
    const holders = largest.value.flatMap((a, i) => {
      const data = infos[i]?.data;
      return data && data.length >= 72 ? [{ owner: new PublicKey(data.subarray(32, 64)).toBase58(), amount: BigInt(a.amount) }] : [];
    });
    return { holders: merge(holders), complete: false };
  }
}

/** One row per owner (an owner can hold several token accounts), largest first, empty accounts dropped. */
function merge(rows: Holder[]): Holder[] {
  const by = new Map<string, bigint>();
  for (const r of rows) if (r.amount > 0n) by.set(r.owner, (by.get(r.owner) ?? 0n) + r.amount);
  return [...by.entries()].map(([owner, amount]) => ({ owner, amount })).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

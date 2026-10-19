import { AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import type { SolanaExecutor, TxResult } from "./executor.js";
import type { IxGroup, TxDraft } from "./pack.js";

/** Addresses per extend instruction that keep the transaction under the size limit. */
const EXTEND_CHUNK = 26;
const EXTEND_CU = 20_000;

/** Every non-signer account the groups touch; signers can never be loaded from a table. */
export function tableAddresses(groups: IxGroup[], extra: PublicKey[] = []): PublicKey[] {
  const signers = new Set(groups.flatMap((g) => g.signers.map((s) => s.publicKey.toBase58())));
  const seen = new Map<string, PublicKey>();
  const add = (k: PublicKey) => {
    const s = k.toBase58();
    if (!signers.has(s) && !seen.has(s)) seen.set(s, k);
  };
  for (const g of groups) {
    for (const ix of g.instructions) {
      for (const k of ix.keys) add(k.pubkey);
      add(ix.programId);
    }
  }
  extra.forEach(add);
  return [...seen.values()];
}

/** An in-memory table, used to size transactions before the real one exists (dry runs). */
export function syntheticTable(addresses: PublicKey[], key = PublicKey.default): AddressLookupTableAccount {
  return new AddressLookupTableAccount({ key, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses } });
}

export interface CreatedTable {
  address: string;
  table: AddressLookupTableAccount;
  txs: TxResult[];
}

export class LookupTables {
  constructor(
    private readonly conn: Connection,
    private readonly executor: SolanaExecutor,
  ) {}

  /** Creates and fills a table, then waits until it is active (one slot after the last extension). */
  async create(authority: Keypair, addresses: PublicKey[], microLamports: number, timeoutMs = 60_000): Promise<CreatedTable> {
    const recentSlot = await this.conn.getSlot("finalized");
    const [createIx, address] = AddressLookupTableProgram.createLookupTable({ authority: authority.publicKey, payer: authority.publicKey, recentSlot });
    const drafts: TxDraft[] = [];
    for (let i = 0; i < addresses.length || i === 0; i += EXTEND_CHUNK) {
      const chunk = addresses.slice(i, i + EXTEND_CHUNK);
      const extend = chunk.length ? [AddressLookupTableProgram.extendLookupTable({ lookupTable: address, authority: authority.publicKey, payer: authority.publicKey, addresses: chunk })] : [];
      drafts.push({ label: i === 0 ? "create lookup table" : `extend lookup table ${i / EXTEND_CHUNK}`, feePayer: authority, signers: [authority], instructions: i === 0 ? [createIx, ...extend] : extend, computeUnits: EXTEND_CU });
    }
    const exec = await this.executor.run(drafts, { mode: "sequential", microLamports });
    if (!exec.txs.every((t) => t.status === "confirmed")) {
      const failed = exec.txs.find((t) => t.status !== "confirmed");
      throw new Error(`Lookup table setup failed at "${failed?.label}": ${failed?.error ?? failed?.status}`);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const table = (await this.conn.getAddressLookupTable(address, { commitment: "confirmed" })).value;
      if (table && table.state.addresses.length === addresses.length) {
        const slot = await this.conn.getSlot("confirmed");
        if (slot > table.state.lastExtendedSlot) return { address: address.toBase58(), table, txs: exec.txs };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Lookup table ${address.toBase58()} did not activate in time`);
  }

  /** Deactivation starts the ~512-slot cool-down after which the rent can be reclaimed with `close`. */
  async deactivate(authority: Keypair, address: PublicKey, microLamports: number): Promise<TxResult> {
    const ix = AddressLookupTableProgram.deactivateLookupTable({ lookupTable: address, authority: authority.publicKey });
    const exec = await this.executor.run([{ label: "deactivate lookup table", feePayer: authority, signers: [authority], instructions: [ix], computeUnits: EXTEND_CU }], { mode: "sequential", microLamports });
    return exec.txs[0]!;
  }

  async close(authority: Keypair, address: PublicKey, microLamports: number): Promise<TxResult> {
    const ix = AddressLookupTableProgram.closeLookupTable({ lookupTable: address, authority: authority.publicKey, recipient: authority.publicKey });
    const exec = await this.executor.run([{ label: "close lookup table", feePayer: authority, signers: [authority], instructions: [ix], computeUnits: EXTEND_CU }], { mode: "sequential", microLamports });
    return exec.txs[0]!;
  }
}

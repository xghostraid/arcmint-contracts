import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";

export const MAX_TX_BYTES = 1232;
const DUMMY_BLOCKHASH = "11111111111111111111111111111111";

export interface Priority {
  microLamports: number;
  computeUnits: number;
}

/** One logical action (for example one wallet's buy) that must stay inside a single transaction. */
export interface IxGroup {
  label: string;
  instructions: TransactionInstruction[];
  signers: Keypair[];
  computeUnits: number;
}

export interface TxDraft {
  label: string;
  feePayer: Keypair;
  signers: Keypair[];
  instructions: TransactionInstruction[];
  computeUnits: number;
  /** A transaction built elsewhere (Jupiter); compiled as-is and only signed. */
  prebuilt?: VersionedTransaction;
}

export function cuLimit(computeUnits: number): number {
  return Math.min(1_400_000, Math.max(1_000, Math.ceil(computeUnits)));
}

export function priorityIxs(p: Priority): TransactionInstruction[] {
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit(p.computeUnits) })];
  if (p.microLamports > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(p.microLamports) }));
  return ixs;
}

export function compileDraft(draft: TxDraft, blockhash: string, microLamports: number): VersionedTransaction {
  if (draft.prebuilt) return draft.prebuilt;
  const message = new TransactionMessage({
    payerKey: draft.feePayer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...priorityIxs({ microLamports, computeUnits: draft.computeUnits }), ...draft.instructions],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function draftSize(draft: TxDraft, microLamports = 1): number {
  try {
    return compileDraft(draft, DUMMY_BLOCKHASH, microLamports).serialize().length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function uniqueSigners(signers: Keypair[]): Keypair[] {
  const seen = new Map<string, Keypair>();
  for (const s of signers) seen.set(s.publicKey.toBase58(), s);
  return [...seen.values()];
}

function draftFrom(groups: IxGroup[], head?: IxGroup): TxDraft {
  const all = head ? [head, ...groups] : groups;
  const signers = uniqueSigners(all.flatMap((g) => g.signers));
  return {
    label: all.map((g) => g.label).join(" + "),
    feePayer: all[0]!.signers[0]!,
    signers,
    instructions: all.flatMap((g) => g.instructions),
    computeUnits: all.reduce((n, g) => n + g.computeUnits, 0),
  };
}

/**
 * Greedily packs groups into as few transactions as fit under 1232 bytes, preserving order.
 * `head` (for example create + dev buy) always starts the first transaction.
 */
export function packGroups(groups: IxGroup[], opts: { head?: IxGroup; maxPerTx?: number } = {}): TxDraft[] {
  const drafts: TxDraft[] = [];
  let current: IxGroup[] = [];
  let head = opts.head;
  const maxPerTx = opts.maxPerTx ?? Number.POSITIVE_INFINITY;
  const flush = () => {
    if (current.length || head) drafts.push(draftFrom(current, head));
    current = [];
    head = undefined;
  };
  for (const group of groups) {
    const candidate = [...current, group];
    if (candidate.length <= maxPerTx && draftSize(draftFrom(candidate, head)) <= MAX_TX_BYTES) {
      current = candidate;
      continue;
    }
    if (!current.length && !head) throw new Error(`"${group.label}" does not fit in one transaction`);
    flush();
    if (draftSize(draftFrom([group])) > MAX_TX_BYTES) throw new Error(`"${group.label}" does not fit in one transaction`);
    current = [group];
  }
  flush();
  return drafts;
}

/** Adds the tip to the last draft if it fits, otherwise appends a tip-only transaction. */
export function appendTip(drafts: TxDraft[], tip: IxGroup): TxDraft[] {
  const last = drafts.at(-1);
  if (last && !last.prebuilt) {
    const merged: TxDraft = {
      ...last,
      label: `${last.label} + ${tip.label}`,
      signers: uniqueSigners([...last.signers, ...tip.signers]),
      instructions: [...last.instructions, ...tip.instructions],
      computeUnits: last.computeUnits + tip.computeUnits,
    };
    if (draftSize(merged) <= MAX_TX_BYTES) return [...drafts.slice(0, -1), merged];
  }
  return [...drafts, draftFrom([tip])];
}

export function signDraft(tx: VersionedTransaction, draft: TxDraft): VersionedTransaction {
  const required = new Set(tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k: PublicKey) => k.toBase58()));
  const signers = uniqueSigners([draft.feePayer, ...draft.signers]).filter((s) => required.has(s.publicKey.toBase58()));
  tx.sign(signers);
  return tx;
}

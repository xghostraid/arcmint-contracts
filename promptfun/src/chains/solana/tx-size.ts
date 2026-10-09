import { TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";

/** Solana packet limits for legacy / v0 transactions (serialized wire format). */
export const SOLANA_TX_RAW_MAX = 1232;
export const SOLANA_TX_BASE64_MAX = 1644;

export function versionedTxWireSize(instructions: TransactionInstruction[], payerKey: import("@solana/web3.js").PublicKey): {
  raw: number;
  base64: number;
} {
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  }).compileToLegacyMessage();
  const raw = Buffer.from(new VersionedTransaction(message).serialize());
  return { raw: raw.length, base64: raw.toString("base64").length };
}

export function assertVersionedTxFits(instructions: TransactionInstruction[], payerKey: import("@solana/web3.js").PublicKey): void {
  const { raw, base64 } = versionedTxWireSize(instructions, payerKey);
  if (raw <= SOLANA_TX_RAW_MAX && base64 <= SOLANA_TX_BASE64_MAX) return;
  throw new Error(
    `Solana transaction too large (${raw} bytes raw, ${base64} base64; max ${SOLANA_TX_RAW_MAX}/${SOLANA_TX_BASE64_MAX}). ` +
      "Shorten the metadata link, use a shorter coin name/symbol, or launch with a hosted picture so promptfun can use a compact metadata URL.",
  );
}

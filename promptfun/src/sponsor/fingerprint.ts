import { createHash } from "node:crypto";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { Built } from "../intents/types.js";

export function solanaInstructionFingerprint(built: Built): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(built.payload, "base64"));
  const msg = TransactionMessage.decompile(tx.message);
  return createHash("sha256").update(JSON.stringify({
    signer: built.signer,
    tokenAddress: built.tokenAddress,
    instructions: msg.instructions.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ p: k.pubkey.toBase58(), s: k.isSigner, w: k.isWritable })),
      data: Buffer.from(ix.data).toString("base64"),
    })),
  })).digest("hex");
}

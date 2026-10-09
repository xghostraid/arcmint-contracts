import { SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Config } from "../config.js";
import type { Built, Intent } from "../intents/types.js";

const ALLOWED = new Set([SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), "ComputeBudget111111111111111111111111111111"]);

export function checkSolanaSponsorPolicy(config: Config, intent: Intent, built: Built, unsignedPayloadBase64: string, sponsor: string): { ok: boolean; reason?: string } {
  if (intent.kind !== "launch_token") return { ok: false, reason: "Sponsored mode supports token launches only." };
  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedPayloadBase64, "base64"));
  for (const ix of TransactionMessage.decompile(tx.message).instructions) {
    if (!ALLOWED.has(ix.programId.toBase58())) return { ok: false, reason: `Program ${ix.programId.toBase58()} is not allowlisted.` };
  }
  if (tx.message.staticAccountKeys[0]?.toBase58() !== sponsor) return { ok: false, reason: "Fee payer must be the sponsor wallet." };
  const fee = BigInt(Math.ceil(Number.parseFloat(built.cost.total) * 1e9) || 0);
  if (fee > config.sponsorMaxLamportsPerLaunch) return { ok: false, reason: "Network fee exceeds sponsor cap." };
  return { ok: true };
}

import { createHash } from "node:crypto";
import { PublicKey, SystemInstruction, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeInitializeMintInstruction,
  decodeMintToCheckedInstruction,
  decodeSetAuthorityInstruction,
  decodeTransferCheckedInstruction,
} from "@solana/spl-token";
import { formatUnits } from "../../util/amount.js";
import type { Step } from "../../intents/types.js";

const METADATA_INIT = createHash("sha256").update("spl_token_metadata_interface:initialize_account").digest().subarray(0, 8);
const METADATA_POINTER_EXT = 39;

export interface MintFacts {
  decimals: number;
  symbol: string;
}

/** Facts read back from the compiled bytes, so the preview and the checks never rely on what we meant to build. */
export interface DecodedTx {
  steps: Step[];
  createdMint: { mint: string; seed: string; base: string; lamports: bigint; space: number; owner: string } | null;
  mintInit: { mint: string; decimals: number; mintAuthority: string; freezeAuthority: string | null } | null;
  metadata: { name: string; symbol: string; uri: string; mint: string; updateAuthority: string } | null;
  mintedTo: { account: string; amount: bigint } | null;
  mintAuthorityRevoked: boolean;
  solTransfers: Array<{ from: string; to: string; lamports: bigint }>;
  tokenTransfers: Array<{ mint: string; destination: string; owner: string; amount: bigint; decimals: number }>;
  createdTokenAccounts: Array<{ account: string; owner: string; mint: string }>;
  pumpCreate: { mint: string; user: string; name: string; symbol: string; uri: string; creator: string; mayhem: boolean } | null;
}

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_CREATE_V2 = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

function readBorshString(data: Buffer, offset: number): [string, number] {
  const len = data.readUInt32LE(offset);
  const start = offset + 4;
  return [data.subarray(start, start + len).toString("utf8"), start + len];
}

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export class UnknownInstructionError extends Error {}

export function decodeInstructions(
  instructions: TransactionInstruction[],
  mints: Map<string, MintFacts>,
): DecodedTx {
  const out: DecodedTx = {
    steps: [],
    createdMint: null,
    mintInit: null,
    metadata: null,
    mintedTo: null,
    mintAuthorityRevoked: false,
    solTransfers: [],
    tokenTransfers: [],
    createdTokenAccounts: [],
    pumpCreate: null,
  };
  const sol = (lamports: bigint) => `${formatUnits(lamports, 9)} SOL`;

  for (const ix of instructions) {
    const program = ix.programId.toBase58();
    if (ix.programId.equals(SystemProgram.programId)) {
      const type = SystemInstruction.decodeInstructionType(ix);
      if (type === "CreateWithSeed") {
        const d = SystemInstruction.decodeCreateWithSeed(ix);
        out.createdMint = {
          mint: d.newAccountPubkey.toBase58(),
          seed: d.seed,
          base: d.basePubkey.toBase58(),
          lamports: BigInt(d.lamports),
          space: d.space,
          owner: d.programId.toBase58(),
        };
        out.steps.push({
          program: "System",
          text: `Create the token's mint account ${d.newAccountPubkey.toBase58()} (refundable deposit ${sol(BigInt(d.lamports))}), derived from your wallet so no extra key is needed.`,
        });
        continue;
      }
      if (type === "Transfer") {
        const d = SystemInstruction.decodeTransfer(ix);
        out.solTransfers.push({ from: d.fromPubkey.toBase58(), to: d.toPubkey.toBase58(), lamports: BigInt(d.lamports) });
        out.steps.push({ program: "System", text: `Send ${sol(BigInt(d.lamports))} to ${d.toPubkey.toBase58()}.` });
        continue;
      }
      throw new UnknownInstructionError(`System instruction ${type} is not allowed.`);
    }

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== 1) throw new UnknownInstructionError("Only idempotent token-account creation is allowed.");
      const account = ix.keys[1].pubkey.toBase58();
      const owner = ix.keys[2].pubkey.toBase58();
      const mint = ix.keys[3].pubkey.toBase58();
      out.createdTokenAccounts.push({ account, owner, mint });
      out.steps.push({
        program: "Associated Token",
        text: `Make sure ${owner} has a token account for ${mints.get(mint)?.symbol ?? short(mint)} (created only if missing).`,
      });
      continue;
    }

    if (ix.programId.equals(TOKEN_2022_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const programId = ix.programId;
      const label = programId.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "Token";
      const tag = ix.data[0];
      if (Buffer.from(ix.data.subarray(0, 8)).equals(METADATA_INIT)) {
        const data = Buffer.from(ix.data);
        const [name, a] = readBorshString(data, 8);
        const [symbol, b] = readBorshString(data, a);
        const [uri] = readBorshString(data, b);
        out.metadata = {
          name,
          symbol,
          uri,
          mint: ix.keys[2].pubkey.toBase58(),
          updateAuthority: ix.keys[1].pubkey.toBase58(),
        };
        out.steps.push({
          program: label,
          text: `Write the token's name "${name}" and symbol "${symbol}"${uri ? ` with metadata ${uri}` : " (no metadata link)"}. You stay the metadata update authority.`,
        });
        continue;
      }
      if (tag === METADATA_POINTER_EXT && ix.data[1] === 0) {
        out.steps.push({ program: label, text: "Point the token's metadata at the mint itself (Token-2022 metadata extension)." });
        continue;
      }
      if (tag === 0) {
        const d = decodeInitializeMintInstruction(ix, programId);
        out.mintInit = {
          mint: d.keys.mint.pubkey.toBase58(),
          decimals: d.data.decimals,
          mintAuthority: d.data.mintAuthority.toBase58(),
          freezeAuthority: d.data.freezeAuthority ? d.data.freezeAuthority.toBase58() : null,
        };
        out.steps.push({
          program: label,
          text: `Set up the token with ${d.data.decimals} decimals. Mint authority: your wallet. Freeze authority: ${d.data.freezeAuthority ? d.data.freezeAuthority.toBase58() : "none (nobody can freeze holders)"}.`,
        });
        continue;
      }
      if (tag === 14) {
        const d = decodeMintToCheckedInstruction(ix, programId);
        const facts = mints.get(d.keys.mint.pubkey.toBase58());
        const amount = BigInt(d.data.amount);
        out.mintedTo = { account: d.keys.destination.pubkey.toBase58(), amount };
        out.steps.push({
          program: label,
          text: `Mint ${formatUnits(amount, d.data.decimals)} ${facts?.symbol ?? ""} into your token account ${short(d.keys.destination.pubkey.toBase58())}.`.replace("  ", " "),
        });
        continue;
      }
      if (tag === 6) {
        const d = decodeSetAuthorityInstruction(ix, programId);
        if (d.data.authorityType === AuthorityType.MintTokens && d.data.newAuthority === null) {
          out.mintAuthorityRevoked = true;
          out.steps.push({ program: label, text: "Give up the mint authority for good, so the supply can never grow." });
          continue;
        }
        throw new UnknownInstructionError("Only revoking the mint authority is allowed.");
      }
      if (tag === 12) {
        const d = decodeTransferCheckedInstruction(ix, programId);
        const mint = d.keys.mint.pubkey.toBase58();
        const amount = BigInt(d.data.amount);
        out.tokenTransfers.push({
          mint,
          destination: d.keys.destination.pubkey.toBase58(),
          owner: d.keys.owner.pubkey.toBase58(),
          amount,
          decimals: d.data.decimals,
        });
        out.steps.push({
          program: label,
          text: `Send ${formatUnits(amount, d.data.decimals)} ${mints.get(mint)?.symbol ?? short(mint)} to token account ${short(d.keys.destination.pubkey.toBase58())}.`,
        });
        continue;
      }
      throw new UnknownInstructionError(`${label} instruction ${tag} is not allowed.`);
    }

    if (ix.programId.equals(PUMP_PROGRAM)) {
      const data = Buffer.from(ix.data);
      if (!data.subarray(0, 8).equals(PUMP_CREATE_V2)) throw new UnknownInstructionError("Only pump.fun coin creation is allowed.");
      const [name, a] = readBorshString(data, 8);
      const [symbol, b] = readBorshString(data, a);
      const [uri, c] = readBorshString(data, b);
      const creator = new PublicKey(data.subarray(c, c + 32)).toBase58();
      const mayhem = data[c + 32] === 1;
      const mint = ix.keys[0].pubkey.toBase58();
      const user = ix.keys[5].pubkey.toBase58();
      out.pumpCreate = { mint, user, name, symbol, uri, creator, mayhem };
      out.steps.push({
        program: "pump.fun",
        text: `Create the pump.fun coin "${name}" (${symbol}) at ${mint} on its bonding curve, with metadata ${uri}. Creator: ${creator}. pump.fun fixes the supply at 1,000,000,000 and holds it in the curve.`,
      });
      continue;
    }

    throw new UnknownInstructionError(`Program ${program} is not allowed in a promptfun transaction.`);
  }
  return out;
}

export function isWalletAddress(address: string): boolean {
  try {
    const key = new PublicKey(address);
    return key.toBase58() === address && PublicKey.isOnCurve(key.toBytes());
  } catch {
    return false;
  }
}

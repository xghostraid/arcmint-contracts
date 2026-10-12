import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import type { Config } from "../../config.js";
import { IntentError } from "../../intents/types.js";

export type FeeShareholder = { address: string; shareBps: number };

const BPS_TOTAL = 10_000;

async function promptBalanceRaw(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner, false);
    const acc = await getAccount(conn, ata);
    return acc.amount;
  } catch {
    return 0n;
  }
}

/** Returns shareholders when $PROMPT tier enforcement applies; null to keep 100% to fee recipient (pre-mint or mint not live). */
export async function resolvePromptFeeShareholders(
  config: Config,
  conn: Connection,
  creatorWallet: string,
): Promise<FeeShareholder[] | null> {
  const mintStr = config.promptMint?.trim();
  if (!mintStr) return null;

  let mint: PublicKey;
  let creator: PublicKey;
  try {
    mint = new PublicKey(mintStr);
    creator = new PublicKey(creatorWallet.trim());
  } catch {
    return null;
  }

  const mintAccount = await conn.getAccountInfo(mint, "confirmed");
  if (!mintAccount) return null;

  const mintMeta = await getMint(conn, mint, "confirmed");
  const oneWhole =
    config.promptMinBalanceRaw ??
    10n ** BigInt(mintMeta.decimals);

  const balance = await promptBalanceRaw(conn, mint, creator);
  if (balance >= oneWhole) {
    return [{ address: creator.toBase58(), shareBps: BPS_TOTAL }];
  }

  const treasury =
    config.promptfunTreasuryPubkey?.trim() ||
    config.sponsorFeeRecipient?.trim();
  if (!treasury) {
    throw new IntentError(
      "Non-holder creator fee tier needs PROMPTFUN_TREASURY_PUBKEY or PROMPTFUN_SPONSOR_FEE_RECIPIENT when $PROMPT enforcement is active.",
    );
  }

  return [
    { address: creator.toBase58(), shareBps: 5_000 },
    { address: treasury, shareBps: 5_000 },
  ];
}

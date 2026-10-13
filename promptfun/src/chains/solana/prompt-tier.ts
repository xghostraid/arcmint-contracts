import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import type { Config } from "../../config.js";
export type FeeShareholder = { address: string; shareBps: number };

const BPS_TOTAL = 10_000;

/** Production treasury, sponsor fee recipient, and $PROMPT launch wallet (same pubkey). */
export const PROMPTFUN_OFFICIAL_WALLET_PUBKEY = "5YPhpDDtYtKaKnUgSskb4tXKZL9a7rj8siCuMS7qESpv";

/** Live $PROMPT SPL mint on Solana mainnet (pump.fun). Override with `PROMPTFUN_PROMPT_MINT`; set empty to disable tier gate. */
export const PROMPTFUN_PROMPT_MINT_LIVE = "385pCEMj4T1rTp2vgCVxmuUR2zTTmqkV6Yu3U96Fpump";

/** promptfun official wallet for pre-mint creator fees and post-mint non-holder half. */
export function officialTreasuryPubkey(config: Config, sponsorFallback?: string): string {
  const treasury =
    config.promptfunTreasuryPubkey?.trim() ||
    config.sponsorFeeRecipient?.trim() ||
    sponsorFallback?.trim() ||
    PROMPTFUN_OFFICIAL_WALLET_PUBKEY;
  return treasury;
}

async function promptBalanceRaw(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner, false);
    const acc = await getAccount(conn, ata);
    return acc.amount;
  } catch {
    return 0n;
  }
}

/** Post-$PROMPT tier split when mint env is set and the mint account exists; null if tier gate is inactive. */
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
  const oneWhole = config.promptMinBalanceRaw ?? 10n ** BigInt(mintMeta.decimals);

  const balance = await promptBalanceRaw(conn, mint, creator);
  if (balance >= oneWhole) {
    return [{ address: creator.toBase58(), shareBps: BPS_TOTAL }];
  }

  const treasury = officialTreasuryPubkey(config);
  return [
    { address: creator.toBase58(), shareBps: 5_000 },
    { address: treasury, shareBps: 5_000 },
  ];
}

export type PumpfunFeeLock = {
  feeRecipient: string;
  feeShareholders: FeeShareholder[];
  /** Recorded creator wallet for ops / manual payout (not always the on-chain recipient). */
  creatorWallet?: string;
  /** Until $PROMPT tier is active on chain, fees lock to promptfun treasury only. */
  preMintTreasuryRouting: boolean;
};

/** Resolves locked pump.fun fee shares for sponsored launches. */
export async function resolvePumpfunCreatorFeeLock(
  config: Config,
  conn: Connection,
  creatorWallet: string | undefined,
  sponsorFallback: string | undefined,
): Promise<PumpfunFeeLock> {
  const treasury = officialTreasuryPubkey(config, sponsorFallback);
  const recorded = creatorWallet?.trim() || undefined;

  if (recorded && config.promptMint) {
    const tierShares = await resolvePromptFeeShareholders(config, conn, recorded);
    if (tierShares) {
      return {
        feeRecipient: recorded,
        feeShareholders: tierShares,
        creatorWallet: recorded,
        preMintTreasuryRouting: false,
      };
    }
  }

  return {
    feeRecipient: treasury,
    feeShareholders: [{ address: treasury, shareBps: BPS_TOTAL }],
    ...(recorded ? { creatorWallet: recorded } : {}),
    preMintTreasuryRouting: true,
  };
}

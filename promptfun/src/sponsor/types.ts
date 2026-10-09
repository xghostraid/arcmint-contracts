import type { Built, Intent } from "../intents/types.js";

export interface FeePayerSigner {
  readonly publicKey: string;
  signSolanaTransaction(chainKey: string, intent: Intent, built: Built, unsignedPayloadBase64: string): Promise<string>;
}

export interface SponsorBudgetSnapshot {
  killSwitch: boolean;
  sponsoredLaunchesEnabled: boolean;
  /** Sponsored launches on Solana testnets (devnet SPL/pump.fun). */
  sponsoredTestnetsEnabled: boolean;
  /** Sponsored pump.fun on Solana mainnet; requires PROMPTFUN_ENABLE_SPONSORED_MAINNET=1 and funded sponsor SOL. */
  sponsoredMainnetEnabled: boolean;
  pauseReason: string | null;
}

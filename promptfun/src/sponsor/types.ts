import type { Built, Intent } from "../intents/types.js";

export interface FeePayerSigner {
  readonly publicKey: string;
  signSolanaTransaction(chainKey: string, intent: Intent, built: Built, unsignedPayloadBase64: string): Promise<string>;
}

export interface SponsorBudgetSnapshot {
  killSwitch: boolean;
  sponsoredLaunchesEnabled: boolean;
  pauseReason: string | null;
}

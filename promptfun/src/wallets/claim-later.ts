import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import type { PlatformStore } from "../platform/store.js";
import { PrivyApiClient, solanaEmbeddedAddress } from "./privy-api.js";
import type { ClaimWalletRecord, ClaimWalletView, WalletProvider } from "./types.js";

export function platformSubFromEmail(email: string): string {
  return createHash("sha256").update(`promptfun:${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export class ClaimLaterWalletProvider implements WalletProvider {
  private readonly privy: PrivyApiClient | null;

  constructor(
    private readonly config: Config,
    private readonly platform: PlatformStore,
    privy?: PrivyApiClient | null,
  ) {
    if (config.privyAppId && config.privyAppSecret) {
      this.privy = privy ?? new PrivyApiClient(config.privyAppId, config.privyAppSecret);
    } else {
      this.privy = null;
    }
  }

  isConfigured(): boolean {
    return this.privy !== null;
  }

  claimUrl(): string {
    return `${this.config.publicUrl}/claim`;
  }

  getCached(sub: string): ClaimWalletRecord | undefined {
    return this.platform.getClaimWallet(sub);
  }

  toView(record: ClaimWalletRecord): ClaimWalletView {
    return {
      sub: record.sub,
      email: record.email,
      solanaAddress: record.solanaAddress,
      claimUrl: this.claimUrl(),
      custody: "privy_embedded_user_owned",
      privyConfigured: this.isConfigured(),
    };
  }

  async ensureSolanaWallet(sub: string, email: string): Promise<ClaimWalletRecord> {
    const cached = this.platform.getClaimWallet(sub);
    if (cached) return cached;

    if (!this.privy) {
      throw new Error("Claim-later wallets are not configured (set PROMPTFUN_PRIVY_APP_ID and PROMPTFUN_PRIVY_APP_SECRET).");
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await this.privy.lookupUserByEmail(normalizedEmail);
    if (!user) {
      user = await this.privy.createUserWithSolanaWallet(normalizedEmail);
    }

    let address = solanaEmbeddedAddress(user);
    if (!address) {
      const created = await this.privy.createSolanaWalletForUser(user.id);
      address = created.address?.trim() ?? "";
    }
    if (!address) throw new Error("Privy did not return a Solana wallet address.");

    const now = new Date().toISOString();
    const record: ClaimWalletRecord = {
      sub,
      email: normalizedEmail,
      privyUserId: user.id,
      solanaAddress: address,
      createdAt: now,
      updatedAt: now,
    };
    this.platform.saveClaimWallet(record);
    return record;
  }
}

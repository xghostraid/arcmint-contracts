export interface ClaimWalletRecord {
  sub: string;
  email: string;
  privyUserId: string;
  solanaAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimWalletView {
  sub: string;
  email: string;
  solanaAddress: string;
  claimUrl: string;
  custody: "privy_embedded_user_owned";
  privyConfigured: boolean;
}

export interface WalletProvider {
  isConfigured(): boolean;
  claimUrl(): string;
  ensureSolanaWallet(sub: string, email: string): Promise<ClaimWalletRecord>;
  getCached(sub: string): ClaimWalletRecord | undefined;
}

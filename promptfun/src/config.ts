import path from "node:path";

export interface Config {
  host: string;
  port: number;
  publicUrl: string;
  dbPath: string;
  enableLocalnet: boolean;
  enablePumpfunMainnet: boolean;
  enableEvmMainnets: boolean;
  enableSponsoredLaunches: boolean;
  sponsorSecretKey: string | null;
  sponsorMaxLamportsPerLaunch: bigint;
  sponsorKillSwitch: boolean;
  intentTtlMs: number;
  maxIntentsPerHour: number;
  pictureTtlMs: number;
  ipfsGateway: string;
  ipfsImageServePath: string | null;
  /** HMAC secret for OAuth access tokens (auth slice; MCP stays no-sign-in until wired). */
  oauthSigningSecret: string;
  oauthExposeMagicLink: boolean;
  oauthEnabled: boolean;
  oauthRequired: boolean;
  /** Estimated monthly USD cap for sponsored launches (0 = unlimited tracking only). */
  monthlyBudgetUsd: number;
  opsToken: string | null;
  /** Solana pubkey that receives 100% creator fees on sponsored pump.fun launches (defaults to sponsor). */
  sponsorFeeRecipient: string | null;
  enablePumpfunDevnet: boolean;
  /** Sponsored pump.fun launches on Solana mainnet (real SOL from sponsor; keep off without OAuth). */
  enableSponsoredMainnet: boolean;
  /** Permissionless pump.fun creator-fee payouts (sponsor pays tx fee). */
  enablePayoutCron: boolean;
  /** Privy app credentials for claim-later embedded Solana wallets (env only; never commit secrets). */
  privyAppId: string | null;
  privyAppSecret: string | null;
  env: NodeJS.ProcessEnv;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT || 8787);
  const host = env.HOST || "127.0.0.1";
  const publicUrl = (env.PROMPTFUN_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  return {
    host,
    port,
    publicUrl,
    dbPath: env.PROMPTFUN_DB || path.resolve(process.cwd(), "data/promptfun.sqlite"),
    enableLocalnet: flag(env.PROMPTFUN_ENABLE_LOCALNET),
    enablePumpfunMainnet: flag(env.PROMPTFUN_ENABLE_PUMPFUN_MAINNET),
    enableEvmMainnets: flag(env.PROMPTFUN_ENABLE_EVM_MAINNETS),
    enableSponsoredLaunches: flag(env.PROMPTFUN_ENABLE_SPONSORED_LAUNCHES),
    sponsorSecretKey: env.PROMPTFUN_SPONSOR_SECRET_KEY?.trim() || null,
    sponsorMaxLamportsPerLaunch: BigInt(env.PROMPTFUN_SPONSOR_MAX_LAMPORTS || "20000000"),
    sponsorKillSwitch: flag(env.PROMPTFUN_SPONSOR_KILL_SWITCH),
    intentTtlMs: Number(env.PROMPTFUN_INTENT_TTL_MS || 15 * 60 * 1000),
    maxIntentsPerHour: Number(env.PROMPTFUN_MAX_INTENTS_PER_HOUR || 120),
    pictureTtlMs: Number(env.PROMPTFUN_PICTURE_TTL_MS || 24 * 60 * 60 * 1000),
    ipfsGateway: (env.PROMPTFUN_IPFS_GATEWAY || "https://ipfs.io/ipfs").replace(/\/+$/, ""),
    ipfsImageServePath: env.PROMPTFUN_IPFS_IMAGE_PATH === "0" ? null : env.PROMPTFUN_IPFS_IMAGE_PATH || "/api/img",
    oauthSigningSecret: env.PROMPTFUN_OAUTH_SIGNING_SECRET?.trim() || "dev-only-change-me",
    oauthExposeMagicLink: flag(env.PROMPTFUN_OAUTH_EXPOSE_MAGIC_LINK),
    oauthRequired: flag(env.PROMPTFUN_OAUTH_REQUIRED),
    oauthEnabled: flag(env.PROMPTFUN_OAUTH_ENABLED) || flag(env.PROMPTFUN_OAUTH_REQUIRED),
    monthlyBudgetUsd: Number(env.PROMPTFUN_MONTHLY_BUDGET_USD || "300"),
    opsToken: env.PROMPTFUN_OPS_TOKEN?.trim() || null,
    sponsorFeeRecipient: env.PROMPTFUN_SPONSOR_FEE_RECIPIENT?.trim() || null,
    enablePumpfunDevnet: flag(env.PROMPTFUN_ENABLE_PUMPFUN_DEVNET),
    enableSponsoredMainnet: flag(env.PROMPTFUN_ENABLE_SPONSORED_MAINNET),
    enablePayoutCron: env.PROMPTFUN_ENABLE_PAYOUT_CRON === "0" ? false : flag(env.PROMPTFUN_ENABLE_PAYOUT_CRON) || flag(env.PROMPTFUN_ENABLE_SPONSORED_LAUNCHES),
    privyAppId: env.PROMPTFUN_PRIVY_APP_ID?.trim() || null,
    privyAppSecret: env.PROMPTFUN_PRIVY_APP_SECRET?.trim() || null,
    env,
  };
}

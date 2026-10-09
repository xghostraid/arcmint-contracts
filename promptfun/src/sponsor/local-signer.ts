import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Config } from "../config.js";
import type { Built, Intent } from "../intents/types.js";
import { IntentError } from "../intents/types.js";
import { checkSolanaSponsorPolicy } from "./policy.js";
import type { FeePayerSigner } from "./types.js";

function loadKeypair(secret: string): Keypair {
  const t = secret.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  return Keypair.fromSecretKey(bs58.decode(t));
}

export class LocalFeePayerSigner implements FeePayerSigner {
  readonly publicKey: string;
  private readonly keypair: Keypair;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
    if (!config.sponsorSecretKey) throw new IntentError("Sponsor signing is not configured.", "sponsor_unconfigured");
    this.keypair = loadKeypair(config.sponsorSecretKey);
    this.publicKey = this.keypair.publicKey.toBase58();
  }

  async signSolanaTransaction(chainKey: string, intent: Intent, built: Built, unsignedPayloadBase64: string): Promise<string> {
    const policy = checkSolanaSponsorPolicy(this.config, intent, built, unsignedPayloadBase64, this.publicKey);
    if (!policy.ok) throw new IntentError(policy.reason ?? "Sponsor policy refused.", "policy_refused");
    void chainKey;
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedPayloadBase64, "base64"));
    tx.sign([this.keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  }
}

export function createFeePayerSigner(config: Config): FeePayerSigner | null {
  if (!config.enableSponsoredLaunches || !config.sponsorSecretKey) return null;
  return new LocalFeePayerSigner(config);
}

import { createRequire } from "node:module";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Config } from "../config.js";
import { findChain } from "../chains/registry.js";
import { connectionFor } from "../chains/solana/adapter.js";
import type { CoinIndexStore } from "../indexer/store.js";
import type { CoinRecord } from "../indexer/record.js";
import { sponsorBudgetSnapshot } from "../sponsor/budget.js";

const pumpMod = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const { OnlinePumpSdk } = pumpMod;

/** Same order of magnitude as getplugged's permissionless payout bot (~0.003 SOL). */
export const MIN_PAYOUT_LAMPORTS = 3_000_000n;

function loadKeypair(secret: string): Keypair {
  const t = secret.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  return Keypair.fromSecretKey(bs58.decode(t));
}

export class PayoutCron {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: Config,
    private readonly coinStore: CoinIndexStore,
  ) {}

  start(intervalMs = 60_000): void {
    if (!this.config.enablePayoutCron || !this.config.sponsorSecretKey) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || !this.config.enablePayoutCron || !this.config.sponsorSecretKey) return;
    if (!sponsorBudgetSnapshot(this.config).sponsoredLaunchesEnabled && !this.config.sponsorKillSwitch) {
      // Still run payouts when sponsor only paused launches (fees already accrued).
    }
    this.running = true;
    try {
      const payer = loadKeypair(this.config.sponsorSecretKey);
      for (const record of this.coinStore.all()) {
        if (record.venue !== "pumpfun") continue;
        const chain = findChain(this.config, record.chainKey);
        if (!chain || chain.family !== "solana" || !chain.testnet) continue;
        await this.tryPayout(record, chain.key, payer).catch(() => undefined);
      }
    } finally {
      this.running = false;
    }
  }

  private async tryPayout(record: CoinRecord, chainKey: string, payer: Keypair): Promise<void> {
    const chain = findChain(this.config, chainKey);
    if (!chain) return;
    const conn = connectionFor(chain as never);
    const mint = new PublicKey(record.address);
    const online = new OnlinePumpSdk(conn);
    const min = await online.getMinimumDistributableFee(mint, payer.publicKey, { payer: payer.publicKey });
    const distributable = BigInt(min.distributableFees.toString());
    if (!min.canDistribute || distributable < MIN_PAYOUT_LAMPORTS) return;

    const { instructions } = await online.buildDistributeCreatorFeesInstructions(mint, { payer: payer.publicKey });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
    tx.sign([payer]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    const prev = BigInt(record.feePayoutAudit?.totalLamports ?? "0");
    const nextTotal = prev + distributable;
    const updated: CoinRecord = {
      ...record,
      feePayoutAudit: {
        totalLamports: nextTotal.toString(),
        payouts: (record.feePayoutAudit?.payouts ?? 0) + 1,
        lastPaidAt: new Date().toISOString(),
      },
    };
    this.coinStore.upsert(updated);
  }
}

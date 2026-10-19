import type { Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { compileDraft, signDraft, type TxDraft } from "./pack.js";
import { JitoClient, MAX_BUNDLE_TXS } from "./jito.js";

export type ExecMode = "parallel" | "sequential" | "bundle";

export interface TxResult {
  label: string;
  signature: string;
  status: "simulated" | "confirmed" | "failed" | "skipped";
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
}

export interface ExecResult {
  mode: ExecMode;
  bundleId?: string;
  note?: string;
  txs: TxResult[];
}

export interface ExecOptions {
  mode: ExecMode;
  microLamports: number;
  dryRun?: boolean;
  /** Bundles: simulate only the first transaction, since later ones depend on its state changes. */
  simulateFirstOnly?: boolean;
  confirmTimeoutMs?: number;
}

function sigOf(tx: VersionedTransaction): string {
  return bs58.encode(tx.signatures[0]!);
}

function errText(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
}

/** Signs, simulates, sends and confirms drafts. Nothing is sent if any required simulation fails. */
export class SolanaExecutor {
  constructor(private readonly conn: Connection, private readonly jito: JitoClient | null) {}

  get bundlesAvailable(): boolean {
    return this.jito !== null;
  }

  async run(drafts: TxDraft[], opts: ExecOptions): Promise<ExecResult> {
    if (!drafts.length) return { mode: opts.mode, txs: [] };
    let mode = opts.mode;
    let note: string | undefined;
    if (mode === "bundle" && !this.jito) {
      mode = "sequential";
      note = "Jito bundles are mainnet-only; transactions were sent one after another (not atomic).";
    }
    if (mode === "bundle" && drafts.length > MAX_BUNDLE_TXS) {
      throw new Error(`Plan needs ${drafts.length} transactions; a Jito bundle holds at most ${MAX_BUNDLE_TXS}. Use fewer wallets.`);
    }

    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    const signed = drafts.map((d) => signDraft(compileDraft(d, blockhash, opts.microLamports), d));
    const results: TxResult[] = signed.map((tx, i) => ({ label: drafts[i]!.label, signature: sigOf(tx), status: "simulated" }));

    const simulateAll = !(opts.simulateFirstOnly || mode === "sequential" || mode === "bundle");
    const toSimulate = simulateAll ? signed : signed.slice(0, 1);
    const sims = await Promise.all(toSimulate.map((tx) => this.conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" })));
    let simFailed = false;
    sims.forEach((sim, i) => {
      const r = results[i]!;
      r.logs = sim.value.logs ?? undefined;
      r.unitsConsumed = sim.value.unitsConsumed ?? undefined;
      if (sim.value.err) {
        r.status = "failed";
        r.error = `Simulation failed: ${errText(sim.value.err)}`;
        simFailed = true;
      }
    });
    if (simFailed || opts.dryRun) {
      if (simFailed) for (const r of results) if (r.status === "simulated") r.status = "skipped";
      return { mode, note, txs: results };
    }

    if (mode === "bundle") {
      const bundleId = await this.jito!.sendBundle(signed.map((tx) => Buffer.from(tx.serialize()).toString("base64")));
      await this.confirm(results, lastValidBlockHeight, opts.confirmTimeoutMs);
      return { mode, bundleId, note, txs: results };
    }

    if (mode === "parallel") {
      await Promise.all(
        signed.map(async (tx, i) => {
          try {
            await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
          } catch (err) {
            results[i]!.status = "failed";
            results[i]!.error = errText(err);
          }
        }),
      );
      await this.confirm(results, lastValidBlockHeight, opts.confirmTimeoutMs);
      return { mode, note, txs: results };
    }

    for (let i = 0; i < signed.length; i++) {
      const r = results[i]!;
      try {
        await this.conn.sendRawTransaction(signed[i]!.serialize(), { skipPreflight: i === 0, maxRetries: 3, preflightCommitment: "confirmed" });
        await this.confirm([r], lastValidBlockHeight, opts.confirmTimeoutMs);
      } catch (err) {
        r.status = "failed";
        r.error = errText(err);
      }
      if (r.status !== "confirmed") {
        for (const rest of results.slice(i + 1)) rest.status = "skipped";
        break;
      }
    }
    return { mode, note, txs: results };
  }

  private async confirm(results: TxResult[], lastValidBlockHeight: number, timeoutMs = 90_000): Promise<void> {
    const pending = () => results.filter((r) => r.status === "simulated");
    const deadline = Date.now() + timeoutMs;
    while (pending().length && Date.now() < deadline) {
      const batch = pending();
      const statuses = await this.conn.getSignatureStatuses(batch.map((r) => r.signature));
      statuses.value.forEach((s, i) => {
        const r = batch[i]!;
        if (!s) return;
        if (s.err) {
          r.status = "failed";
          r.error = errText(s.err);
        } else if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") {
          r.status = "confirmed";
        }
      });
      if (!pending().length) break;
      const height = await this.conn.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    for (const r of pending()) {
      r.status = "failed";
      r.error = "Not confirmed before the blockhash expired";
    }
  }
}

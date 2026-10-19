import type { ActivityKind, ActivityLog } from "../activity.js";
import type { ChainInfo } from "../chains/registry.js";
import type { ExecResult } from "../chains/solana/executor.js";
import { InputError } from "../chains/solana/adapter.js";
import type { Config } from "../config.js";
import { sol } from "../util/amount.js";

export interface ActionResult extends ExecResult {
  dryRun: boolean;
  explorer: Record<string, string>;
}

export function enforceCap(config: Config, totalLamports: bigint, what: string): void {
  const cap = BigInt(Math.floor(config.maxSolPerAction * 1e9));
  if (totalLamports > cap) {
    throw new InputError(`${what} totals ${sol(totalLamports)} SOL, above TERMINAL_MAX_SOL_PER_ACTION (${config.maxSolPerAction} SOL)`);
  }
}

export function finish(
  activity: ActivityLog,
  chain: ChainInfo,
  kind: ActivityKind,
  result: ExecResult,
  dryRun: boolean,
  meta: { token?: string; summary: (label: string) => string; walletFor?: (label: string) => string | undefined },
): ActionResult {
  const explorer: Record<string, string> = {};
  for (const tx of result.txs) {
    if (tx.status === "confirmed") explorer[tx.signature] = chain.explorerTx(tx.signature);
    if (dryRun) continue;
    activity.record({
      kind,
      status: tx.status === "confirmed" ? "ok" : tx.status === "simulated" ? "simulated" : "failed",
      summary: meta.summary(tx.label),
      token: meta.token,
      walletAddress: meta.walletFor?.(tx.label),
      signature: tx.status === "skipped" ? undefined : tx.signature,
      detail: { mode: result.mode, bundleId: result.bundleId, error: tx.error, note: result.note },
    });
  }
  return { ...result, dryRun, explorer };
}

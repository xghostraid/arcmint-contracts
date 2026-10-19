import type { PublicKey } from "@solana/web3.js";
import type { ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import { InputError, parsePubkey, type SolanaAdapter } from "../chains/solana/adapter.js";
import { cuLimit, packGroups, type TxDraft } from "../chains/solana/pack.js";
import { BASE_FEE_LAMPORTS, RENT_EXEMPT_MIN, TRANSFER_CU, priorityFeeLamports, sweepAmount, transferGroup } from "../chains/solana/treasury.js";
import type { WalletStore } from "../wallets.js";
import { sol } from "../util/amount.js";
import { enforceCap, finish, type ActionResult } from "./common.js";

export interface TransferLeg {
  from: string;
  to: string;
  lamports: string;
}

export interface TreasuryResult extends ActionResult {
  legs: TransferLeg[];
}

/** Plain, visible SOL movements between the user's own wallets (and out to an address the user names). */
export class TreasuryService {
  constructor(
    private readonly config: Config,
    private readonly sol: SolanaAdapter,
    private readonly wallets: WalletStore,
    private readonly activity: ActivityLog,
  ) {}

  async distribute(req: { fromWalletId: number; toWalletIds: number[]; lamportsEach: bigint; microLamports: number; dryRun: boolean }): Promise<TreasuryResult> {
    const from = this.wallets.get(req.fromWalletId);
    const targets = this.wallets.getMany(req.toWalletIds).filter((w) => w.id !== from.id);
    if (!targets.length) throw new InputError("Pick at least one destination wallet other than the source");
    if (req.lamportsEach <= 0n) throw new InputError("Amount must be positive");
    const total = req.lamportsEach * BigInt(targets.length);
    enforceCap(this.config, total, "Distribution");
    const balances = await this.sol.nativeBalances([from.address, ...targets.map((t) => t.address)]);
    const empty = targets.filter((t) => balances[t.address] === "0");
    if (empty.length && req.lamportsEach < RENT_EXEMPT_MIN) {
      throw new InputError(`Empty wallets need at least ${sol(RENT_EXEMPT_MIN)} SOL each (rent-exempt minimum)`);
    }

    const legs = targets.map((t) => ({ from: from.address, to: t.address, lamports: req.lamportsEach.toString() }));
    const result = await this.wallets.withSolanaSigners([from.id], async (signers) => {
      const kp = signers.get(from.id)!;
      const drafts = packGroups(
        targets.map((t) => transferGroup(kp, parsePubkey(t.address), req.lamportsEach, `fund ${t.label}`)),
        { maxPerTx: 20 },
      );
      const fees = drafts.reduce((n, d) => n + BASE_FEE_LAMPORTS + priorityFeeLamports(req.microLamports, cuLimit(d.computeUnits)), 0n);
      if (BigInt(balances[from.address]!) < total + fees) {
        throw new InputError(`${from.label} has ${sol(BigInt(balances[from.address]!))} SOL; needs ${sol(total + fees)} SOL including fees`);
      }
      return this.sol.executor.run(drafts, { mode: "parallel", microLamports: req.microLamports, dryRun: req.dryRun });
    });
    return {
      ...finish(this.activity, this.sol.chain, "distribute", result, req.dryRun, {
        summary: (label) => `${from.label} → ${label.split(" + ").length} wallet(s), ${sol(req.lamportsEach)} SOL each`,
        walletFor: () => from.address,
      }),
      legs,
    };
  }

  /**
   * Sends SOL from each source to one destination. Without `lamportsEach` it sends everything except the
   * fee and `reserveLamports`; with it, a fixed amount (a withdrawal).
   */
  async sweep(req: { fromWalletIds: number[]; toWalletId?: number; toAddress?: string; reserveLamports: bigint; lamportsEach?: bigint; microLamports: number; dryRun: boolean }): Promise<TreasuryResult> {
    let to: PublicKey;
    let toLabel: string;
    if (req.toWalletId !== undefined) {
      const w = this.wallets.get(req.toWalletId);
      to = parsePubkey(w.address);
      toLabel = w.label;
    } else if (req.toAddress) {
      to = parsePubkey(req.toAddress, "destination address");
      toLabel = this.wallets.findByAddress(to.toBase58())?.label ?? `${to.toBase58().slice(0, 4)}…${to.toBase58().slice(-4)}`;
    } else {
      throw new InputError("Pick a destination wallet or address");
    }
    const sources = this.wallets.getMany(req.fromWalletIds).filter((w) => w.address !== to.toBase58());
    if (!sources.length) throw new InputError("Pick at least one source wallet other than the destination");
    const balances = await this.sol.nativeBalances(sources.map((s) => s.address));
    const fee = BASE_FEE_LAMPORTS + priorityFeeLamports(req.microLamports, cuLimit(TRANSFER_CU));

    const legs: TransferLeg[] = [];
    const plan = sources.flatMap((s) => {
      const balance = BigInt(balances[s.address]!);
      let amount: bigint;
      if (req.lamportsEach !== undefined) {
        const left = balance - fee - req.lamportsEach;
        if (left < 0n || (left > 0n && left < RENT_EXEMPT_MIN)) {
          throw new InputError(`${s.label} cannot send ${sol(req.lamportsEach)} SOL (balance ${sol(balance)}); it must keep 0 or at least ${sol(RENT_EXEMPT_MIN)} SOL`);
        }
        amount = req.lamportsEach;
      } else {
        amount = sweepAmount(balance, req.reserveLamports, fee).amount;
      }
      if (amount <= 0n) return [];
      legs.push({ from: s.address, to: to.toBase58(), lamports: amount.toString() });
      return [{ wallet: s, amount }];
    });
    if (!plan.length) throw new InputError("Nothing to sweep: every source is at or below the reserve plus fee");
    enforceCap(this.config, req.lamportsEach !== undefined ? req.lamportsEach * BigInt(plan.length) : 0n, "Withdrawal");

    const result = await this.wallets.withSolanaSigners(plan.map((p) => p.wallet.id), async (signers) => {
      const drafts: TxDraft[] = plan.map((p) => packGroups([transferGroup(signers.get(p.wallet.id)!, to, p.amount, `${p.wallet.label} → ${toLabel}`)])[0]!);
      return this.sol.executor.run(drafts, { mode: "parallel", microLamports: req.microLamports, dryRun: req.dryRun });
    });
    const byLabel = new Map(plan.map((p) => [`${p.wallet.label} → ${toLabel}`, p]));
    return {
      ...finish(this.activity, this.sol.chain, "sweep", result, req.dryRun, {
        summary: (label) => `${label}: ${sol(byLabel.get(label)?.amount ?? 0n)} SOL`,
        walletFor: (label) => byLabel.get(label)?.wallet.address,
      }),
      legs,
    };
  }
}

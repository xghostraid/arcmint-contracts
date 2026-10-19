import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { InputError, type SolanaAdapter } from "../chains/solana/adapter.js";
import type { ExecMode } from "../chains/solana/executor.js";
import { MAX_BUNDLE_TXS, MIN_JITO_TIP_LAMPORTS, tipGroup } from "../chains/solana/jito.js";
import { appendTip, packGroups, type IxGroup } from "../chains/solana/pack.js";
import { PUMP_TOTAL_SUPPLY, applyBuy, buyGroup, createAndBuyGroup, freshCurve, lamportsWithSlippage, marketCapLamports, quoteBuy } from "../chains/solana/pumpfun.js";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import type { Vault } from "../vault.js";
import type { WalletStore } from "../wallets.js";
import { sol } from "../util/amount.js";
import { enforceCap, finish, type ActionResult } from "./common.js";
import { BUY_OVERHEAD_LAMPORTS } from "./trade.js";

export const MAX_BUNDLE_WALLETS = 15;
/** create_v2 rent (mint, curve, metadata) plus fees, on top of the dev buy. */
export const CREATE_OVERHEAD_LAMPORTS = 25_000_000n;

export interface LaunchRequest {
  name: string;
  symbol: string;
  uri: string;
  devWalletId: number;
  devBuyLamports: bigint;
  buyers: { walletId: number; lamports: bigint }[];
  slippageBps: number;
  microLamports: number;
  jitoTipLamports: number;
  mode: ExecMode;
  dryRun: boolean;
}

export interface LaunchAllocation {
  walletId: number;
  address: string;
  label: string;
  role: "dev" | "bundle";
  lamports: string;
  tokens: string;
  supplyPct: number;
  balance: string;
  enough: boolean;
}

export interface LaunchPlan {
  mint: string;
  allocations: LaunchAllocation[];
  totalLamports: string;
  totalSupplyPct: number;
  marketCapAfterLamports: string;
  txCount: number;
  txLabels: string[];
  willBundle: boolean;
  warnings: string[];
}

export interface LaunchResult extends ActionResult {
  launchId: number | null;
  plan: LaunchPlan;
}

export interface LaunchRecord {
  id: number;
  network: string;
  mint: string;
  name: string;
  symbol: string;
  status: string;
  plan: LaunchPlan;
  result: unknown;
  createdAt: string;
}

function pct(tokens: bigint): number {
  return Number((tokens * 1_000_000n) / PUMP_TOTAL_SUPPLY) / 10_000;
}

/**
 * Pump.fun create_v2 + dev buy + buys from the user's own bundle wallets, landing in the same block when
 * sent as a Jito bundle. Every allocation is shown in the plan and stays labeled as the user's own.
 */
export class LaunchService {
  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly sol: SolanaAdapter,
    private readonly wallets: WalletStore,
    private readonly vault: Vault,
    private readonly activity: ActivityLog,
  ) {}

  private validate(req: LaunchRequest): void {
    if (!req.name.trim() || req.name.length > 32) throw new InputError("Name must be 1–32 characters");
    if (!/^[A-Za-z0-9$_.-]{1,10}$/.test(req.symbol)) throw new InputError("Symbol must be 1–10 letters or digits");
    if (!/^(https?|ipfs):\/\//.test(req.uri)) throw new InputError("Metadata URI must be an https:// or ipfs:// link");
    if (req.buyers.length > MAX_BUNDLE_WALLETS) throw new InputError(`At most ${MAX_BUNDLE_WALLETS} bundle wallets`);
    const ids = [req.devWalletId, ...req.buyers.map((b) => b.walletId)];
    if (new Set(ids).size !== ids.length) throw new InputError("Each wallet can appear once (dev wallet included)");
    if (req.buyers.some((b) => b.lamports <= 0n)) throw new InputError("Every bundle buy needs a positive SOL amount");
    if (req.devBuyLamports < 0n) throw new InputError("Dev buy cannot be negative");
    if (req.mode === "bundle" && this.sol.executor.bundlesAvailable && req.jitoTipLamports < MIN_JITO_TIP_LAMPORTS) {
      throw new InputError(`Jito tip must be at least ${MIN_JITO_TIP_LAMPORTS} lamports`);
    }
  }

  async run(req: LaunchRequest): Promise<LaunchResult> {
    this.validate(req);
    const total = req.devBuyLamports + req.buyers.reduce((n, b) => n + b.lamports, 0n);
    enforceCap(this.config, total, "Launch buys");
    const dev = this.wallets.get(req.devWalletId);
    const buyerWallets = req.buyers.map((b) => ({ wallet: this.wallets.get(b.walletId), lamports: b.lamports }));
    for (const w of [dev, ...buyerWallets.map((b) => b.wallet)]) {
      if (w.family !== "solana" || w.status !== "active") throw new InputError(`${w.label} is not an active Solana wallet`);
    }
    const balances = await this.sol.nativeBalances([dev.address, ...buyerWallets.map((b) => b.wallet.address)]);
    const p = await this.sol.pump.protocol();
    if (!p.global.createV2Enabled) throw new InputError("Pump.fun create_v2 is disabled on this network");
    const mint = Keypair.generate();

    const allocations: LaunchAllocation[] = [];
    let curve = freshCurve(p, new PublicKey(dev.address));
    const devTokens = req.devBuyLamports > 0n ? quoteBuy(p, null, req.devBuyLamports) : 0n;
    if (devTokens > 0n) curve = applyBuy(curve, devTokens);
    const devNeed = lamportsWithSlippage(req.devBuyLamports, 100) + CREATE_OVERHEAD_LAMPORTS;
    allocations.push({ walletId: dev.id, address: dev.address, label: dev.label, role: "dev", lamports: req.devBuyLamports.toString(), tokens: devTokens.toString(), supplyPct: pct(devTokens), balance: balances[dev.address]!, enough: BigInt(balances[dev.address]!) >= devNeed });
    const buyerTokens: bigint[] = [];
    const curveBefore: BondingCurve[] = [];
    for (const b of buyerWallets) {
      // Bundle buys execute in order, so each is quoted against the curve the previous buys leave behind.
      const tokens = quoteBuy(p, curve, b.lamports);
      curveBefore.push(curve);
      curve = applyBuy(curve, tokens);
      buyerTokens.push(tokens);
      const need = lamportsWithSlippage(b.lamports, req.slippageBps) + BUY_OVERHEAD_LAMPORTS;
      allocations.push({ walletId: b.wallet.id, address: b.wallet.address, label: b.wallet.label, role: "bundle", lamports: b.lamports.toString(), tokens: tokens.toString(), supplyPct: pct(tokens), balance: balances[b.wallet.address]!, enough: BigInt(balances[b.wallet.address]!) >= need });
    }

    const warnings: string[] = [];
    for (const a of allocations) if (!a.enough) warnings.push(`${a.label} needs more SOL (has ${sol(BigInt(a.balance))})`);
    const willBundle = req.mode === "bundle" && this.sol.executor.bundlesAvailable;
    if (req.mode === "bundle" && !willBundle) warnings.push("Jito bundles are mainnet-only: on this network the transactions go out one after another, so other traders could land between them.");

    const ids = [dev.id, ...buyerWallets.map((b) => b.wallet.id)];
    const outcome = await this.wallets.withSolanaSigners(ids, async (signers) => {
      const devKp = signers.get(dev.id)!;
      const head = await createAndBuyGroup({ p, mint, name: req.name.trim(), symbol: req.symbol, uri: req.uri, dev: devKp, lamports: req.devBuyLamports, tokens: devTokens });
      const groups: IxGroup[] = [];
      for (const [i, b] of buyerWallets.entries()) {
        groups.push(await buyGroup({ p, mint: mint.publicKey, curve: curveBefore[i]!, curveInfo: null, tokenProgram: TOKEN_2022_PROGRAM_ID, user: signers.get(b.wallet.id)!, ataExists: false, lamports: b.lamports, tokens: buyerTokens[i]!, slippageBps: req.slippageBps, label: `bundle buy ${b.wallet.label}` }));
      }
      // The create transaction is nearly full (≈1.19 KB), so bundle buys start in the second transaction.
      let drafts = [...packGroups([head]), ...(groups.length ? packGroups(groups) : [])];
      if (willBundle) drafts = appendTip(drafts, tipGroup(devKp, req.jitoTipLamports));
      const plan: LaunchPlan = {
        mint: mint.publicKey.toBase58(),
        allocations,
        totalLamports: total.toString(),
        totalSupplyPct: allocations.reduce((n, a) => n + a.supplyPct, 0),
        marketCapAfterLamports: marketCapLamports(curve).toString(),
        txCount: drafts.length,
        txLabels: drafts.map((d) => d.label),
        willBundle,
        warnings,
      };
      if (willBundle && drafts.length > MAX_BUNDLE_TXS) {
        warnings.push(`Needs ${drafts.length} transactions but a Jito bundle holds ${MAX_BUNDLE_TXS}; use fewer bundle wallets.`);
      }
      if (!req.dryRun && warnings.some((w) => !w.startsWith("Jito bundles are mainnet-only"))) {
        throw new InputError(`Launch blocked: ${warnings.join(" ")}`);
      }
      const exec = await this.sol.executor.run(drafts, { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun, simulateFirstOnly: true });
      return { plan, exec };
    });

    let launchId: number | null = null;
    if (!req.dryRun) {
      const status = outcome.exec.txs.every((t) => t.status === "confirmed") ? "confirmed" : outcome.exec.txs[0]?.status === "confirmed" ? "partial" : "failed";
      const r = this.db
        .prepare("INSERT INTO launches (network, mint, name, symbol, status, plan, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(this.config.network, outcome.plan.mint, req.name.trim(), req.symbol, status, JSON.stringify({ ...outcome.plan, sealedMintSecret: this.vault.sealSecret(outcome.plan.mint, mint.secretKey) }), JSON.stringify(outcome.exec), now());
      launchId = Number(r.lastInsertRowid);
    }
    return {
      ...finish(this.activity, this.sol.chain, "launch", outcome.exec, req.dryRun, { token: outcome.plan.mint, summary: (label) => `${req.symbol} launch: ${label}`, walletFor: () => dev.address }),
      launchId,
      plan: outcome.plan,
    };
  }

  list(): LaunchRecord[] {
    const rows = this.db.prepare("SELECT * FROM launches ORDER BY id DESC").all() as unknown as { id: number; network: string; mint: string; name: string; symbol: string; status: string; plan: string; result: string | null; created_at: string }[];
    return rows.map((r) => {
      const { sealedMintSecret: _omit, ...plan } = JSON.parse(r.plan) as LaunchPlan & { sealedMintSecret?: string };
      return { id: r.id, network: r.network, mint: r.mint, name: r.name, symbol: r.symbol, status: r.status, plan, result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at };
    });
  }

  async uploadMetadata(m: { name: string; symbol: string; description: string; image: { base64: string; type: string; filename: string }; twitter?: string; telegram?: string; website?: string }): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(m.image.base64, "base64")], { type: m.image.type }), m.image.filename);
    form.append("name", m.name);
    form.append("symbol", m.symbol);
    form.append("description", m.description);
    if (m.twitter) form.append("twitter", m.twitter);
    if (m.telegram) form.append("telegram", m.telegram);
    if (m.website) form.append("website", m.website);
    form.append("showName", "true");
    const res = await fetch(this.config.pumpIpfsUrl, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { metadataUri?: string };
    if (!res.ok || !body.metadataUri) throw new InputError(`Metadata upload failed (${res.status})`);
    return body.metadataUri;
  }
}

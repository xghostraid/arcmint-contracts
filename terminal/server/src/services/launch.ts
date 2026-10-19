import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { InputError, type SolanaAdapter } from "../chains/solana/adapter.js";
import type { ExecMode } from "../chains/solana/executor.js";
import { MAX_BUNDLE_TXS, MIN_JITO_TIP_LAMPORTS, tipGroup } from "../chains/solana/jito.js";
import { appendTip, packGroups, type IxGroup, type TxDraft } from "../chains/solana/pack.js";
import { LookupTables, syntheticTable, tableAddresses } from "../chains/solana/alt.js";
import type { ExecResult } from "../chains/solana/executor.js";
import { PUMP_TOTAL_SUPPLY, applyBuy, buyGroup, createAndBuyGroup, freshCurve, lamportsWithSlippage, marketCapLamports, quoteBuy } from "../chains/solana/pumpfun.js";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import type { Vault } from "../vault.js";
import type { WalletStore } from "../wallets.js";
import { sol } from "../util/amount.js";
import { enforceCap, finish, type ActionResult } from "./common.js";
import { BUY_OVERHEAD_LAMPORTS } from "./trade.js";

/**
 * What one 5-transaction Jito bundle holds with a lookup table: the 64-instruction trace limit allows create + dev
 * buy + 2 buys in the first transaction and 4 buys in each of the others (size alone would allow ~27).
 */
export const MAX_BUNDLE_WALLETS = 18;
/** Lamports of rent per byte of account data (two years' worth, the rent-exempt minimum). */
const RENT_PER_BYTE = 6_960n;
const LOOKUP_TABLE_META_BYTES = 56n;
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
  /** "auto" uses a table only when the plan would not otherwise fit in one Jito bundle. */
  lookupTable?: "auto" | "on" | "off";
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
  lookupTable: { used: boolean; addresses: number; address: string | null; txCountWithout: number };
  warnings: string[];
}

export interface LaunchResult extends ActionResult {
  launchId: number | null;
  plan: LaunchPlan;
}

interface LaunchRow {
  id: number;
  network: string;
  mint: string;
  name: string;
  symbol: string;
  status: string;
  plan: string;
  result: string | null;
  lookup_table: string | null;
  lookup_table_status: string | null;
  created_at: string;
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
  lookupTable: string | null;
  lookupTableStatus: string | null;
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
  ) {
    this.tables = new LookupTables(sol.conn, sol.executor);
  }

  private readonly tables: LookupTables;

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
      const tip = willBundle ? tipGroup(devKp, req.jitoTipLamports) : null;
      const withTip = (d: TxDraft[]) => (tip ? appendTip(d, tip) : d);
      // Without a table the create transaction is nearly full (≈1.19 KB), so bundle buys start in the second one.
      const plain = withTip([...packGroups([head]), ...(groups.length ? packGroups(groups) : [])]);
      const addresses = tableAddresses([head, ...groups, ...(tip ? [tip] : [])]);
      const packed = groups.length ? withTip(packGroups(groups, { head, lookupTables: [syntheticTable(addresses)] })) : plain;
      const tableMode = req.lookupTable ?? "auto";
      const useTable = groups.length > 0 && (tableMode === "on" || (tableMode === "auto" && plain.length > MAX_BUNDLE_TXS && packed.length < plain.length));
      const tableRent = useTable ? (LOOKUP_TABLE_META_BYTES + 32n * BigInt(addresses.length) + 128n) * RENT_PER_BYTE : 0n;
      const devAlloc = allocations[0]!;
      if (useTable && BigInt(devAlloc.balance) < devNeed + tableRent) devAlloc.enough = false;
      for (const a of allocations) if (!a.enough) warnings.push(`${a.label} needs more SOL (has ${sol(BigInt(a.balance))})`);
      let drafts = useTable ? packed : plain;
      const plan: LaunchPlan = {
        mint: mint.publicKey.toBase58(),
        allocations,
        totalLamports: total.toString(),
        totalSupplyPct: allocations.reduce((n, a) => n + a.supplyPct, 0),
        marketCapAfterLamports: marketCapLamports(curve).toString(),
        txCount: drafts.length,
        txLabels: drafts.map((d) => d.label),
        willBundle,
        lookupTable: { used: useTable, addresses: addresses.length, address: null, txCountWithout: plain.length },
        warnings,
      };
      if (willBundle && drafts.length > MAX_BUNDLE_TXS) {
        warnings.push(`Needs ${drafts.length} transactions but a Jito bundle holds ${MAX_BUNDLE_TXS}; use fewer bundle wallets${useTable ? "" : " or a lookup table"}.`);
      }
      if (!req.dryRun && warnings.some((w) => !w.startsWith("Jito bundles are mainnet-only"))) {
        throw new InputError(`Launch blocked: ${warnings.join(" ")}`);
      }
      const execOpts = { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun, simulateFirstOnly: true };
      if (!useTable) return { plan, exec: await this.sol.executor.run(drafts, execOpts) };
      if (req.dryRun) {
        // The table does not exist yet, so only the create transaction (compiled without it) can be simulated.
        const exec = await this.sol.executor.run(packGroups([head]), execOpts);
        return { plan, exec: { ...exec, note: `Dry run simulated the create transaction alone; the ${addresses.length}-address lookup table is created at launch time.` } };
      }
      const created = await this.tables.create(devKp, addresses, req.microLamports);
      plan.lookupTable.address = created.address;
      drafts = withTip(packGroups(groups, { head, lookupTables: [created.table] }));
      plan.txCount = drafts.length;
      plan.txLabels = drafts.map((d) => d.label);
      const exec: ExecResult = await this.sol.executor.run(drafts, execOpts);
      // Every launch transaction has landed or failed by now; deactivation starts the cool-down before the rent can be reclaimed.
      const deactivated = await this.tables.deactivate(devKp, new PublicKey(created.address), req.microLamports).catch((err: Error) => ({ status: "failed", error: err.message }));
      return { plan, exec, tableSetup: created.txs, tableDeactivated: deactivated.status === "confirmed" };
    });

    let launchId: number | null = null;
    if (!req.dryRun) {
      const status = outcome.exec.txs.every((t) => t.status === "confirmed") ? "confirmed" : outcome.exec.txs[0]?.status === "confirmed" ? "partial" : "failed";
      const r = this.db
        .prepare("INSERT INTO launches (network, mint, name, symbol, status, plan, result, lookup_table, lookup_table_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          this.config.network,
          outcome.plan.mint,
          req.name.trim(),
          req.symbol,
          status,
          JSON.stringify({ ...outcome.plan, sealedMintSecret: this.vault.sealSecret(outcome.plan.mint, mint.secretKey) }),
          JSON.stringify({ ...outcome.exec, tableSetup: "tableSetup" in outcome ? outcome.tableSetup : undefined }),
          outcome.plan.lookupTable.address,
          outcome.plan.lookupTable.address ? ("tableDeactivated" in outcome && outcome.tableDeactivated ? "deactivated" : "active") : null,
          now(),
        );
      launchId = Number(r.lastInsertRowid);
      if ("tableSetup" in outcome && outcome.tableSetup) {
        this.activity.record({
          kind: "launch",
          status: "ok",
          summary: `${req.symbol} launch: lookup table ${outcome.plan.lookupTable.address?.slice(0, 6)}… (${outcome.plan.lookupTable.addresses} addresses) created${outcome.tableDeactivated ? " and deactivated after the launch" : ""}`,
          walletAddress: dev.address,
          token: outcome.plan.mint,
          signature: outcome.tableSetup[0]?.signature,
        });
      }
    }
    return {
      ...finish(this.activity, this.sol.chain, "launch", outcome.exec, req.dryRun, { token: outcome.plan.mint, summary: (label) => `${req.symbol} launch: ${label}`, walletFor: () => dev.address }),
      launchId,
      plan: outcome.plan,
    };
  }

  list(): LaunchRecord[] {
    const rows = this.db.prepare("SELECT * FROM launches ORDER BY id DESC").all() as unknown as LaunchRow[];
    return rows.map((r) => {
      const { sealedMintSecret: _omit, ...plan } = JSON.parse(r.plan) as LaunchPlan & { sealedMintSecret?: string };
      return { id: r.id, network: r.network, mint: r.mint, name: r.name, symbol: r.symbol, status: r.status, plan, result: r.result ? JSON.parse(r.result) : null, lookupTable: r.lookup_table, lookupTableStatus: r.lookup_table_status, createdAt: r.created_at };
    });
  }

  /** Mints of launches on this network, for "own launch" checks. */
  ownMints(): Set<string> {
    const rows = this.db.prepare("SELECT mint FROM launches WHERE network = ? AND status != 'failed'").all(this.config.network) as { mint: string }[];
    return new Set(rows.map((r) => r.mint));
  }

  /** Deactivates the launch's lookup table, or closes it (refunding the rent to the dev wallet) once cooled down. */
  async reclaimTable(id: number, microLamports: number): Promise<{ status: string; signature?: string; error?: string }> {
    const row = this.db.prepare("SELECT * FROM launches WHERE id = ?").get(id) as LaunchRow | undefined;
    if (!row) throw new InputError(`Launch ${id} not found`);
    if (!row.lookup_table) throw new InputError("This launch did not use a lookup table");
    if (row.lookup_table_status === "closed") return { status: "closed" };
    const plan = JSON.parse(row.plan) as LaunchPlan;
    const devId = plan.allocations.find((a) => a.role === "dev")!.walletId;
    const table = new PublicKey(row.lookup_table);
    return this.wallets.withSolanaSigners([devId], async (signers) => {
      const dev = signers.get(devId)!;
      if (row.lookup_table_status !== "deactivated") {
        const r = await this.tables.deactivate(dev, table, microLamports);
        if (r.status === "confirmed") this.db.prepare("UPDATE launches SET lookup_table_status = 'deactivated' WHERE id = ?").run(id);
        return { status: r.status === "confirmed" ? "deactivated" : "failed", signature: r.signature, error: r.error };
      }
      const r = await this.tables.close(dev, table, microLamports);
      if (r.status === "confirmed") {
        this.db.prepare("UPDATE launches SET lookup_table_status = 'closed' WHERE id = ?").run(id);
        this.activity.record({ kind: "launch", status: "ok", summary: `${row.symbol}: lookup table closed, rent refunded`, walletAddress: dev.publicKey.toBase58(), signature: r.signature, token: row.mint });
        return { status: "closed", signature: r.signature };
      }
      return { status: "cooling_down", error: "The table is still cooling down (about 512 slots, ~4 minutes after deactivation); try again shortly." };
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

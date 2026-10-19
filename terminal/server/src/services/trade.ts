import type { Keypair, PublicKey } from "@solana/web3.js";
import type { ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import { InputError, parsePubkey, type SolanaAdapter } from "../chains/solana/adapter.js";
import type { ExecMode } from "../chains/solana/executor.js";
import { MIN_JITO_TIP_LAMPORTS, tipGroup } from "../chains/solana/jito.js";
import { WSOL_MINT } from "../chains/solana/jupiter.js";
import { appendTip, packGroups, type IxGroup, type TxDraft } from "../chains/solana/pack.js";
import { applyBuy, applySell, buyGroup, lamportsWithSlippage, quoteBuy, quoteSell, sellGroup } from "../chains/solana/pumpfun.js";
import { BASE_FEE_LAMPORTS } from "../chains/solana/treasury.js";
import type { Wallet, WalletStore } from "../wallets.js";
import { sol } from "../util/amount.js";
import { enforceCap, finish, type ActionResult } from "./common.js";

export interface ExecParams {
  slippageBps: number;
  microLamports: number;
  mode: ExecMode;
  jitoTipLamports: number;
  dryRun: boolean;
}

export interface Leg {
  walletId: number;
  address: string;
  label: string;
  lamports: string;
  tokens: string;
}

export interface TradeResult extends ActionResult {
  venue: string;
  legs: Leg[];
}

/** Rough per-buy overhead: token account rent, pump volume-accumulator rent, fees. */
export const BUY_OVERHEAD_LAMPORTS = 4_000_000n;

/**
 * The curve state each leg of a batch is quoted against. Ordered sends (sequential, bundle) chain, so each leg
 * sees what the previous ones leave. Parallel sends can land in any order, so each leg is quoted as if every
 * other leg of the batch landed first; otherwise an early leg that lands last fails its slippage bound.
 */
export function legStates<S, L>(start: S, items: L[], step: (s: S, item: L) => S, parallel: boolean): S[] {
  if (parallel && items.length > 1) return items.map((_, i) => items.reduce((s, it, j) => (j === i ? s : step(s, it)), start));
  const out: S[] = [];
  let s = start;
  for (const it of items) {
    out.push(s);
    s = step(s, it);
  }
  return out;
}

export class TradeService {
  constructor(
    private readonly config: Config,
    private readonly sol: SolanaAdapter,
    private readonly wallets: WalletStore,
    private readonly activity: ActivityLog,
  ) {}

  private activeSolanaWallets(ids: number[]): Wallet[] {
    if (!ids.length) throw new InputError("Select at least one wallet");
    const ws = this.wallets.getMany(ids);
    for (const w of ws) {
      if (w.family !== "solana") throw new InputError(`${w.label} is not a Solana wallet`);
      if (w.status !== "active") throw new InputError(`${w.label} is archived`);
    }
    return ws;
  }

  private draftsFor(groups: IxGroup[], params: ExecParams, tipPayer: Keypair): TxDraft[] {
    if (params.mode !== "bundle") return groups.map((g) => packGroups([g])[0]!);
    if (params.jitoTipLamports < MIN_JITO_TIP_LAMPORTS) throw new InputError(`Jito tip must be at least ${MIN_JITO_TIP_LAMPORTS} lamports`);
    const drafts = packGroups(groups);
    return this.sol.executor.bundlesAvailable ? appendTip(drafts, tipGroup(tipPayer, params.jitoTipLamports)) : drafts;
  }

  async buy(req: { mint: string; walletIds: number[]; lamportsPerWallet: bigint } & ExecParams): Promise<TradeResult> {
    const mint = parsePubkey(req.mint, "mint");
    const ws = this.activeSolanaWallets(req.walletIds);
    if (req.lamportsPerWallet <= 0n) throw new InputError("Buy amount must be positive");
    enforceCap(this.config, req.lamportsPerWallet * BigInt(ws.length), "Buy");
    const info = await this.sol.tokenInfo(mint.toBase58());
    if (!info.venue) throw new InputError(info.venueNote);

    const balances = await this.sol.nativeBalances(ws.map((w) => w.address));
    const short = ws.filter((w) => BigInt(balances[w.address]!) < lamportsWithSlippage(req.lamportsPerWallet, req.slippageBps) + BUY_OVERHEAD_LAMPORTS);
    if (short.length) {
      throw new InputError(`Not enough SOL for this buy in: ${short.map((w) => `${w.label} (${sol(BigInt(balances[w.address]!))} SOL)`).join(", ")}`);
    }

    const legs: Leg[] = [];
    const result = await this.wallets.withSolanaSigners(ws.map((w) => w.id), async (signers) => {
      let drafts: TxDraft[];
      if (info.venue === "pumpfun") {
        const p = await this.sol.pump.protocol();
        const state = (await this.sol.pump.curve(mint))!;
        const atas = await this.sol.pump.ataExists(mint, ws.map((w) => signers.get(w.id)!.publicKey), state.tokenProgram);
        const curves = legStates(state.curve, ws, (c) => applyBuy(c, quoteBuy(p, c, req.lamportsPerWallet)), req.mode === "parallel");
        const groups: IxGroup[] = [];
        for (const [i, w] of ws.entries()) {
          const curve = curves[i]!;
          const tokens = quoteBuy(p, curve, req.lamportsPerWallet);
          groups.push(await buyGroup({ p, mint, curve, curveInfo: state.accountInfo, tokenProgram: state.tokenProgram, user: signers.get(w.id)!, ataExists: atas[i]!, lamports: req.lamportsPerWallet, tokens, slippageBps: req.slippageBps, label: `buy ${w.label}` }));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: req.lamportsPerWallet.toString(), tokens: tokens.toString() });
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else {
        drafts = await this.jupiterDrafts(ws, signers, WSOL_MINT, mint.toBase58(), () => req.lamportsPerWallet, req, legs, "buy");
      }
      return this.sol.executor.run(drafts, { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun });
    });

    const byLabel = new Map(ws.map((w) => [`buy ${w.label}`, w.address]));
    return {
      ...finish(this.activity, this.sol.chain, "buy", result, req.dryRun, {
        token: mint.toBase58(),
        summary: (label) => `${label}: ${sol(req.lamportsPerWallet)} SOL of ${info.symbol ?? mint.toBase58().slice(0, 6)}`,
        walletFor: (label) => byLabel.get(label),
      }),
      venue: info.venue,
      legs,
    };
  }

  async sell(req: { mint: string; walletIds: number[]; percent: number } & ExecParams): Promise<TradeResult> {
    const mint = parsePubkey(req.mint, "mint");
    if (!(req.percent > 0 && req.percent <= 100)) throw new InputError("Sell percent must be in (0, 100]");
    const all = this.activeSolanaWallets(req.walletIds);
    const info = await this.sol.tokenInfo(mint.toBase58());
    if (!info.venue) throw new InputError(info.venueNote);
    const tokenProgram = parsePubkey(info.tokenProgram);
    const balances = await this.sol.tokenBalances(mint, all.map((w) => w.address), tokenProgram);
    const bps = BigInt(Math.round(req.percent * 100));
    const amounts = new Map(all.map((w) => [w.id, (BigInt(balances[w.address]!) * bps) / 10_000n]));
    const ws = all.filter((w) => amounts.get(w.id)! > 0n);
    if (!ws.length) throw new InputError("None of the selected wallets hold this token");
    const solBalances = await this.sol.nativeBalances(ws.map((w) => w.address));
    const noFee = ws.filter((w) => BigInt(solBalances[w.address]!) < BASE_FEE_LAMPORTS * 2n);
    if (noFee.length) throw new InputError(`No SOL for fees in: ${noFee.map((w) => w.label).join(", ")}`);

    const legs: Leg[] = [];
    const result = await this.wallets.withSolanaSigners(ws.map((w) => w.id), async (signers) => {
      let drafts: TxDraft[];
      if (info.venue === "pumpfun") {
        const p = await this.sol.pump.protocol();
        const state = (await this.sol.pump.curve(mint))!;
        const curves = legStates(state.curve, ws, (c, w) => applySell(c, amounts.get(w.id)!), req.mode === "parallel");
        const groups: IxGroup[] = [];
        for (const [i, w] of ws.entries()) {
          const tokens = amounts.get(w.id)!;
          const curve = curves[i]!;
          const expected = quoteSell(p, curve, tokens);
          groups.push(await sellGroup({ p, mint, state: { ...state, curve }, user: signers.get(w.id)!, tokens, expectedLamports: expected, slippageBps: req.slippageBps, label: `sell ${w.label}` }));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: expected.toString(), tokens: tokens.toString() });
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else {
        drafts = await this.jupiterDrafts(ws, signers, mint.toBase58(), WSOL_MINT, (w) => amounts.get(w.id)!, req, legs, "sell");
      }
      return this.sol.executor.run(drafts, { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun });
    });

    const byLabel = new Map(ws.map((w) => [`sell ${w.label}`, w.address]));
    return {
      ...finish(this.activity, this.sol.chain, "sell", result, req.dryRun, {
        token: mint.toBase58(),
        summary: (label) => `${label}: ${req.percent}% of ${info.symbol ?? mint.toBase58().slice(0, 6)}`,
        walletFor: (label) => byLabel.get(label),
      }),
      venue: info.venue,
      legs,
    };
  }

  private async jupiterDrafts(
    ws: Wallet[],
    signers: Map<number, Keypair>,
    inputMint: string,
    outputMint: string,
    amountOf: (w: Wallet) => bigint,
    params: ExecParams,
    legs: Leg[],
    side: "buy" | "sell",
  ): Promise<TxDraft[]> {
    const jup = this.sol.jupiter!;
    const priorityLamports = Math.ceil((params.microLamports * 300_000) / 1e6);
    const drafts: TxDraft[] = [];
    for (const w of ws) {
      const kp = signers.get(w.id)!;
      const quote = await jup.quote(inputMint, outputMint, amountOf(w), params.slippageBps);
      const tx = await jup.swapTransaction(quote, kp.publicKey as PublicKey, priorityLamports);
      drafts.push({ label: `${side} ${w.label}`, feePayer: kp, signers: [kp], instructions: [], computeUnits: 0, prebuilt: tx });
      legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: side === "buy" ? quote.inAmount : quote.outAmount, tokens: side === "buy" ? quote.outAmount : quote.inAmount });
    }
    if (params.mode === "bundle" && this.sol.executor.bundlesAvailable) {
      if (drafts.length > 4) throw new InputError("Jupiter bundles hold at most 4 swaps plus the tip transaction; select fewer wallets or use parallel mode");
      return appendTip(drafts, tipGroup(signers.get(ws[0]!.id)!, params.jitoTipLamports));
    }
    return drafts;
  }
}

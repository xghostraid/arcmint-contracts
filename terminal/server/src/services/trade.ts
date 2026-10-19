import type { Keypair, PublicKey } from "@solana/web3.js";
import type { ActivityKind, ActivityLog } from "../activity.js";
import type { Config } from "../config.js";
import { InputError, parsePubkey, type SolanaAdapter, type TokenInfo } from "../chains/solana/adapter.js";
import type { ExecMode } from "../chains/solana/executor.js";
import { MIN_JITO_TIP_LAMPORTS, tipGroup } from "../chains/solana/jito.js";
import { WSOL_MINT } from "../chains/solana/jupiter.js";
import { appendTip, packGroups, type IxGroup, type TxDraft } from "../chains/solana/pack.js";
import { applyBuy, applySell, buyGroup, lamportsWithSlippage, quoteBuy, quoteSell, sellGroup } from "../chains/solana/pumpfun.js";
import { applySwap, reservesOf, swapBuyGroup, swapQuoteBuy, swapQuoteSell, swapSellGroup } from "../chains/solana/pumpswap.js";
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

export interface BuyLeg {
  walletId: number;
  lamports: bigint;
}

export interface SellLeg {
  walletId: number;
  tokens: bigint;
}

/** Who asked for the trade; bot trades are labeled in the activity log. */
export interface TradeOrigin {
  kind?: ActivityKind;
  prefix?: string;
}

/** Rough per-buy overhead: token account rent, pump volume-accumulator rent, fees. */
export const BUY_OVERHEAD_LAMPORTS = 4_000_000n;

export class TradeService {
  constructor(
    private readonly config: Config,
    private readonly sol: SolanaAdapter,
    private readonly wallets: WalletStore,
    private readonly activity: ActivityLog,
  ) {}

  private activeSolanaWallets(ids: number[]): Wallet[] {
    if (!ids.length) throw new InputError("Select at least one wallet");
    if (new Set(ids).size !== ids.length) throw new InputError("Each wallet can appear once per trade");
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

  /** The same SOL amount from every wallet. */
  async buy(req: { mint: string; walletIds: number[]; lamportsPerWallet: bigint } & ExecParams, origin: TradeOrigin = {}): Promise<TradeResult> {
    return this.buyLegs({ ...req, legs: req.walletIds.map((walletId) => ({ walletId, lamports: req.lamportsPerWallet })) }, origin);
  }

  /** A percentage of each wallet's token balance; wallets holding none are skipped. */
  async sell(req: { mint: string; walletIds: number[]; percent: number } & ExecParams, origin: TradeOrigin = {}): Promise<TradeResult> {
    if (!(req.percent > 0 && req.percent <= 100)) throw new InputError("Sell percent must be in (0, 100]");
    const mint = parsePubkey(req.mint, "mint");
    const all = this.activeSolanaWallets(req.walletIds);
    const balances = await this.sol.tokenBalances(mint, all.map((w) => w.address));
    const bps = BigInt(Math.round(req.percent * 100));
    const legs = all.map((w) => ({ walletId: w.id, tokens: (BigInt(balances[w.address]!) * bps) / 10_000n })).filter((l) => l.tokens > 0n);
    if (!legs.length) throw new InputError("None of the selected wallets hold this token");
    return this.sellLegs({ ...req, legs }, { prefix: origin.prefix, kind: origin.kind });
  }

  async buyLegs(req: { mint: string; legs: BuyLeg[]; info?: TokenInfo } & ExecParams, origin: TradeOrigin = {}): Promise<TradeResult> {
    const mint = parsePubkey(req.mint, "mint");
    const ws = this.activeSolanaWallets(req.legs.map((l) => l.walletId));
    const amount = new Map(req.legs.map((l) => [l.walletId, l.lamports]));
    if (req.legs.some((l) => l.lamports <= 0n)) throw new InputError("Buy amount must be positive");
    const total = req.legs.reduce((n, l) => n + l.lamports, 0n);
    enforceCap(this.config, total, "Buy");
    const info = req.info ?? (await this.sol.tokenInfo(mint.toBase58()));
    if (!info.venue) throw new InputError(info.venueNote);

    const balances = await this.sol.nativeBalances(ws.map((w) => w.address));
    const short = ws.filter((w) => BigInt(balances[w.address]!) < lamportsWithSlippage(amount.get(w.id)!, req.slippageBps) + BUY_OVERHEAD_LAMPORTS);
    if (short.length) {
      throw new InputError(`Not enough SOL for this buy in: ${short.map((w) => `${w.label} (${sol(BigInt(balances[w.address]!))} SOL)`).join(", ")}`);
    }

    const legs: Leg[] = [];
    const result = await this.wallets.withSolanaSigners(ws.map((w) => w.id), async (signers) => {
      let drafts: TxDraft[];
      if (info.venue === "pumpfun") {
        const p = await this.sol.pump.protocol();
        const state = await this.sol.pump.curve(mint);
        if (!state) throw new InputError("Bonding curve not found");
        const atas = await this.sol.pump.ataExists(mint, ws.map((w) => signers.get(w.id)!.publicKey), state.tokenProgram);
        let curve = state.curve;
        const groups: IxGroup[] = [];
        for (const [i, w] of ws.entries()) {
          const lamports = amount.get(w.id)!;
          // Each buy is quoted against the curve left by the ones before it, so later buys in a batch don't overshoot.
          const tokens = quoteBuy(p, curve, lamports);
          groups.push(await buyGroup({ p, mint, curve, curveInfo: state.accountInfo, tokenProgram: state.tokenProgram, user: signers.get(w.id)!, ataExists: atas[i]!, lamports, tokens, slippageBps: req.slippageBps, label: `buy ${w.label}` }));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: lamports.toString(), tokens: tokens.toString() });
          curve = applyBuy(curve, tokens);
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else if (info.venue === "pumpswap") {
        const base = await this.sol.pumpswap.state(parsePubkey(info.pool!.address, "pool"));
        const states = await this.sol.pumpswap.forUsers(base, ws.map((w) => signers.get(w.id)!.publicKey));
        let reserves = reservesOf(base);
        const groups: IxGroup[] = [];
        for (const [i, w] of ws.entries()) {
          const lamports = amount.get(w.id)!;
          const q = swapQuoteBuy(base, reserves, lamports, req.slippageBps);
          groups.push(await swapBuyGroup(states[i]!, signers.get(w.id)!, q.tokens, q.maxLamports, `buy ${w.label}`));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: lamports.toString(), tokens: q.tokens.toString() });
          reserves = applySwap(reserves, "buy", q.tokens, q.poolQuoteIn);
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else {
        drafts = await this.jupiterDrafts(ws, signers, WSOL_MINT, mint.toBase58(), (w) => amount.get(w.id)!, req, legs, "buy");
      }
      return this.sol.executor.run(drafts, { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun });
    });

    const byLabel = new Map(ws.map((w) => [`buy ${w.label}`, w]));
    return {
      ...finish(this.activity, this.sol.chain, origin.kind ?? "buy", result, req.dryRun, {
        token: mint.toBase58(),
        summary: (label) => `${origin.prefix ?? ""}${label}: ${sol(amount.get(byLabel.get(label)?.id ?? -1) ?? 0n)} SOL of ${info.symbol ?? mint.toBase58().slice(0, 6)}`,
        walletFor: (label) => byLabel.get(label)?.address,
      }),
      venue: info.venue,
      legs,
    };
  }

  async sellLegs(req: { mint: string; legs: SellLeg[]; info?: TokenInfo } & ExecParams, origin: TradeOrigin = {}): Promise<TradeResult> {
    const mint = parsePubkey(req.mint, "mint");
    const ws = this.activeSolanaWallets(req.legs.map((l) => l.walletId));
    const amounts = new Map(req.legs.map((l) => [l.walletId, l.tokens]));
    if (req.legs.some((l) => l.tokens <= 0n)) throw new InputError("Sell amount must be positive");
    const info = req.info ?? (await this.sol.tokenInfo(mint.toBase58()));
    if (!info.venue) throw new InputError(info.venueNote);
    const held = await this.sol.tokenBalances(mint, ws.map((w) => w.address), parsePubkey(info.tokenProgram));
    const over = ws.filter((w) => BigInt(held[w.address]!) < amounts.get(w.id)!);
    if (over.length) throw new InputError(`Not enough tokens in: ${over.map((w) => w.label).join(", ")}`);
    const solBalances = await this.sol.nativeBalances(ws.map((w) => w.address));
    const noFee = ws.filter((w) => BigInt(solBalances[w.address]!) < BASE_FEE_LAMPORTS * 2n);
    if (noFee.length) throw new InputError(`No SOL for fees in: ${noFee.map((w) => w.label).join(", ")}`);

    const legs: Leg[] = [];
    const result = await this.wallets.withSolanaSigners(ws.map((w) => w.id), async (signers) => {
      let drafts: TxDraft[];
      if (info.venue === "pumpfun") {
        const p = await this.sol.pump.protocol();
        const state = await this.sol.pump.curve(mint);
        if (!state) throw new InputError("Bonding curve not found");
        let curve = state.curve;
        const groups: IxGroup[] = [];
        for (const w of ws) {
          const tokens = amounts.get(w.id)!;
          const expected = quoteSell(p, curve, tokens);
          groups.push(await sellGroup({ p, mint, state: { ...state, curve }, user: signers.get(w.id)!, tokens, expectedLamports: expected, slippageBps: req.slippageBps, label: `sell ${w.label}` }));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: expected.toString(), tokens: tokens.toString() });
          curve = applySell(curve, tokens);
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else if (info.venue === "pumpswap") {
        const base = await this.sol.pumpswap.state(parsePubkey(info.pool!.address, "pool"));
        const states = await this.sol.pumpswap.forUsers(base, ws.map((w) => signers.get(w.id)!.publicKey));
        let reserves = reservesOf(base);
        const groups: IxGroup[] = [];
        for (const [i, w] of ws.entries()) {
          const tokens = amounts.get(w.id)!;
          const q = swapQuoteSell(base, reserves, tokens, req.slippageBps);
          groups.push(await swapSellGroup(states[i]!, signers.get(w.id)!, tokens, q.minLamports, `sell ${w.label}`));
          legs.push({ walletId: w.id, address: w.address, label: w.label, lamports: q.lamports.toString(), tokens: tokens.toString() });
          reserves = applySwap(reserves, "sell", tokens, q.poolQuoteOut);
        }
        drafts = this.draftsFor(groups, req, signers.get(ws[0]!.id)!);
      } else {
        drafts = await this.jupiterDrafts(ws, signers, mint.toBase58(), WSOL_MINT, (w) => amounts.get(w.id)!, req, legs, "sell");
      }
      return this.sol.executor.run(drafts, { mode: req.mode, microLamports: req.microLamports, dryRun: req.dryRun });
    });

    const byLabel = new Map(ws.map((w) => [`sell ${w.label}`, w.address]));
    const decimals = 10 ** info.decimals;
    return {
      ...finish(this.activity, this.sol.chain, origin.kind ?? "sell", result, req.dryRun, {
        token: mint.toBase58(),
        summary: (label) => {
          const leg = legs.find((l) => `sell ${l.label}` === label);
          const qty = leg ? (Number(leg.tokens) / decimals).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "?";
          return `${origin.prefix ?? ""}${label}: ${qty} ${info.symbol ?? mint.toBase58().slice(0, 6)}`;
        },
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

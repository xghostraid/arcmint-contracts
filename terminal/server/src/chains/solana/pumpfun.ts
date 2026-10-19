import { createRequire } from "node:module";
import { PublicKey, type AccountInfo, type Connection, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import type { BondingCurve, FeeConfig, Global } from "@pump-fun/pump-sdk";
import type { IxGroup } from "./pack.js";
import { InputError } from "../../errors.js";

type PumpSdk = typeof import("@pump-fun/pump-sdk");
let mod: PumpSdk | null = null;
/** The SDK's ESM build fails to link one of its dependencies; the CJS build works. */
export function pumpSdk(): PumpSdk {
  mod ??= createRequire(import.meta.url)("@pump-fun/pump-sdk") as PumpSdk;
  return mod;
}

export const PUMP_DECIMALS = 6;
export const PUMP_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 6n;
export const CREATE_AND_BUY_CU = 350_000;
export const BUY_CU = 110_000;
export const SELL_CU = 90_000;

export interface PumpProtocol {
  global: Global;
  feeConfig: FeeConfig | null;
}

export interface CurveState {
  curve: BondingCurve;
  accountInfo: AccountInfo<Buffer>;
  tokenProgram: PublicKey;
}

const SOL_QUOTE = PublicKey.default;

export class PumpFun {
  private cache: { at: number; value: PumpProtocol } | null = null;

  constructor(private readonly conn: Connection) {}

  async protocol(): Promise<PumpProtocol> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.value;
    const online = new (pumpSdk().OnlinePumpSdk)(this.conn);
    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
    const value = { global, feeConfig };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async curve(mint: PublicKey): Promise<CurveState | null> {
    const sdk = pumpSdk();
    const [curveInfo, mintInfo] = await this.conn.getMultipleAccountsInfo([sdk.bondingCurvePda(mint), mint], "confirmed");
    if (!curveInfo || !mintInfo) return null;
    return {
      curve: sdk.PUMP_SDK.decodeBondingCurve(curveInfo),
      accountInfo: curveInfo,
      tokenProgram: mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    };
  }

  async ataExists(mint: PublicKey, owners: PublicKey[], tokenProgram: PublicKey): Promise<boolean[]> {
    const atas = owners.map((o) => getAssociatedTokenAddressSync(mint, o, true, tokenProgram));
    const infos = await this.conn.getMultipleAccountsInfo(atas, "confirmed");
    return infos.map((i) => i !== null);
  }
}

export function quoteBuy(p: PumpProtocol, curve: BondingCurve | null, lamports: bigint): bigint {
  const out = pumpSdk().getBuyTokenAmountFromSolAmount({
    global: p.global,
    feeConfig: p.feeConfig,
    mintSupply: curve ? curve.tokenTotalSupply : p.global.tokenTotalSupply,
    bondingCurve: curve,
    amount: new BN(lamports.toString()),
    quoteMint: SOL_QUOTE,
  });
  return BigInt(out.toString());
}

export function quoteSell(p: PumpProtocol, curve: BondingCurve, tokens: bigint): bigint {
  const out = pumpSdk().getSellSolAmountFromTokenAmount({
    global: p.global,
    feeConfig: p.feeConfig,
    mintSupply: curve.tokenTotalSupply,
    bondingCurve: curve,
    amount: new BN(tokens.toString()),
  });
  return BigInt(out.toString());
}

/** The curve as it will look after a buy of exactly `tokens`, using the program's constant-product rule. */
export function applyBuy(curve: BondingCurve, tokens: bigint): BondingCurve {
  const vT = BigInt(curve.virtualTokenReserves.toString());
  const vS = BigInt(curve.virtualQuoteReserves.toString());
  const left = BigInt(curve.realTokenReserves.toString());
  if (tokens >= left) throw new InputError(`Buys exceed the ${Number(left / 10n ** 6n).toLocaleString("en-US")} tokens left on the bonding curve; lower the amounts`);
  const solIn = (tokens * vS) / (vT - tokens) + 1n;
  return {
    ...curve,
    virtualTokenReserves: new BN((vT - tokens).toString()),
    virtualQuoteReserves: new BN((vS + solIn).toString()),
    realTokenReserves: new BN((BigInt(curve.realTokenReserves.toString()) - tokens).toString()),
    realQuoteReserves: new BN((BigInt(curve.realQuoteReserves.toString()) + solIn).toString()),
  };
}

export function applySell(curve: BondingCurve, tokens: bigint): BondingCurve {
  const vT = BigInt(curve.virtualTokenReserves.toString());
  const vS = BigInt(curve.virtualQuoteReserves.toString());
  const solOut = (tokens * vS) / (vT + tokens);
  return {
    ...curve,
    virtualTokenReserves: new BN((vT + tokens).toString()),
    virtualQuoteReserves: new BN((vS - solOut).toString()),
    realTokenReserves: new BN((BigInt(curve.realTokenReserves.toString()) + tokens).toString()),
    realQuoteReserves: new BN((BigInt(curve.realQuoteReserves.toString()) - solOut).toString()),
  };
}

/**
 * A curve for a mint that `create_v2` has not created yet, seeded from the global config.
 * newBondingCurve copies `global.mayhemModeEnabled`, but launches here always pass mayhemMode=false,
 * and a mismatch routes buys to the wrong fee recipients (NotAuthorized).
 */
export function freshCurve(p: PumpProtocol, creator: PublicKey): BondingCurve {
  return { ...pumpSdk().newBondingCurve(p.global), creator, isMayhemMode: false };
}

export function curveProgress(p: PumpProtocol, curve: BondingCurve): number {
  const initial = BigInt(p.global.initialRealTokenReserves.toString());
  const left = BigInt(curve.realTokenReserves.toString());
  if (initial === 0n) return 0;
  return Number(((initial - left) * 10_000n) / initial) / 100;
}

export function marketCapLamports(curve: BondingCurve): bigint {
  const mc = pumpSdk().bondingCurveMarketCap({
    mintSupply: curve.tokenTotalSupply,
    virtualQuoteReserves: curve.virtualQuoteReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });
  return BigInt(mc.toString());
}

export async function buyGroup(args: {
  p: PumpProtocol;
  mint: PublicKey;
  curve: BondingCurve;
  curveInfo: AccountInfo<Buffer> | null;
  tokenProgram: PublicKey;
  user: Keypair;
  ataExists: boolean;
  lamports: bigint;
  tokens: bigint;
  slippageBps: number;
  label: string;
}): Promise<IxGroup> {
  const instructions: TransactionInstruction[] = await pumpSdk().PUMP_SDK.buyInstructions({
    global: args.p.global,
    // buyInstructions reads only `creator` and `isMayhemMode` from the curve, so a projected curve works
    // for buys that land in the same bundle as the create.
    bondingCurveAccountInfo: args.curveInfo as AccountInfo<Buffer>,
    bondingCurve: args.curve,
    associatedUserAccountInfo: args.ataExists ? ({} as AccountInfo<Buffer>) : null,
    mint: args.mint,
    user: args.user.publicKey,
    amount: new BN(args.tokens.toString()),
    solAmount: new BN(args.lamports.toString()),
    slippage: args.slippageBps / 100,
    tokenProgram: args.tokenProgram,
  });
  return { label: args.label, instructions, signers: [args.user], computeUnits: BUY_CU };
}

export async function sellGroup(args: {
  p: PumpProtocol;
  mint: PublicKey;
  state: CurveState;
  user: Keypair;
  tokens: bigint;
  expectedLamports: bigint;
  slippageBps: number;
  label: string;
}): Promise<IxGroup> {
  const instructions = await pumpSdk().PUMP_SDK.sellInstructions({
    global: args.p.global,
    bondingCurveAccountInfo: args.state.accountInfo,
    bondingCurve: args.state.curve,
    mint: args.mint,
    user: args.user.publicKey,
    amount: new BN(args.tokens.toString()),
    solAmount: new BN(args.expectedLamports.toString()),
    slippage: args.slippageBps / 100,
    tokenProgram: args.state.tokenProgram,
    mayhemMode: args.state.curve.isMayhemMode,
  });
  return { label: args.label, instructions, signers: [args.user], computeUnits: SELL_CU };
}

export async function createAndBuyGroup(args: {
  p: PumpProtocol;
  mint: Keypair;
  name: string;
  symbol: string;
  uri: string;
  dev: Keypair;
  lamports: bigint;
  tokens: bigint;
}): Promise<IxGroup> {
  const sdk = pumpSdk();
  const instructions =
    args.lamports > 0n
      ? await sdk.PUMP_SDK.createV2AndBuyInstructions({
          global: args.p.global,
          mint: args.mint.publicKey,
          name: args.name,
          symbol: args.symbol,
          uri: args.uri,
          creator: args.dev.publicKey,
          user: args.dev.publicKey,
          amount: new BN(args.tokens.toString()),
          solAmount: new BN(args.lamports.toString()),
          mayhemMode: false,
        })
      : [
          await sdk.PUMP_SDK.createV2Instruction({
            mint: args.mint.publicKey,
            name: args.name,
            symbol: args.symbol,
            uri: args.uri,
            creator: args.dev.publicKey,
            user: args.dev.publicKey,
            mayhemMode: false,
          }),
        ];
  return { label: `create ${args.symbol} + dev buy`, instructions, signers: [args.dev, args.mint], computeUnits: CREATE_AND_BUY_CU };
}

export function lamportsWithSlippage(lamports: bigint, slippageBps: number): bigint {
  return lamports + (lamports * BigInt(Math.floor(slippageBps))) / 10_000n;
}

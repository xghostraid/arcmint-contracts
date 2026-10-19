import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getTokenMetadata } from "@solana/spl-token";
import type { Config } from "../../config.js";
import { InputError } from "../../errors.js";
import type { ChainInfo } from "../registry.js";
import { solanaChainFor } from "../registry.js";
import { SolanaExecutor } from "./executor.js";
import { JitoClient } from "./jito.js";
import { JupiterClient } from "./jupiter.js";
import { PumpFun, curveProgress, marketCapLamports, PUMP_TOTAL_SUPPLY } from "./pumpfun.js";
import { PumpSwap, poolPrice } from "./pumpswap.js";

export type VenueId = "pumpfun" | "pumpswap" | "jupiter";

export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  tokenProgram: string;
  venue: VenueId | null;
  venueNote: string;
  curve: null | {
    complete: boolean;
    creator: string;
    progressPct: number;
    marketCapLamports: string;
    priceLamportsPerToken: number;
  };
  pool: null | {
    address: string;
    canonical: boolean;
    baseReserve: string;
    quoteReserve: string;
  };
  /** Spot price and size from whichever venue is live; null when there is none on this network. */
  market: null | {
    priceLamportsPerToken: number;
    marketCapLamports: string;
    liquidityLamports: string;
  };
}

export { InputError };

export function parsePubkey(value: string, what = "address"): PublicKey {
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new InputError(`Invalid ${what}: ${value}`);
  }
}

/** Everything the Solana services need for one network: RPC, venues, executor. */
export class SolanaAdapter {
  readonly conn: Connection;
  readonly chain: ChainInfo;
  readonly pump: PumpFun;
  readonly pumpswap: PumpSwap;
  readonly jupiter: JupiterClient | null;
  readonly executor: SolanaExecutor;

  constructor(readonly config: Config, conn?: Connection) {
    this.chain = solanaChainFor(config.network);
    this.conn = conn ?? new Connection(config.rpcUrl, { commitment: "confirmed", wsEndpoint: config.wsUrl });
    this.pump = new PumpFun(this.conn);
    this.pumpswap = new PumpSwap(this.conn);
    const mainnet = config.network === "mainnet";
    this.jupiter = mainnet ? new JupiterClient(config.jupiterUrl) : null;
    this.executor = new SolanaExecutor(this.conn, mainnet ? new JitoClient(config.jitoUrl) : null);
  }

  async nativeBalances(addresses: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const infos = await this.conn.getMultipleAccountsInfo(chunk.map((a) => new PublicKey(a)), "confirmed");
      chunk.forEach((a, j) => (out[a] = String(infos[j]?.lamports ?? 0)));
    }
    return out;
  }

  async tokenProgramOf(mint: PublicKey): Promise<PublicKey> {
    const info = await this.conn.getAccountInfo(mint, "confirmed");
    if (!info) throw new InputError(`Mint ${mint.toBase58()} does not exist on ${this.chain.name}`);
    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
    throw new InputError(`${mint.toBase58()} is not an SPL token mint`);
  }

  /** Raw token balances (base units) of each owner's associated token account. */
  async tokenBalances(mint: PublicKey, owners: string[], tokenProgram?: PublicKey): Promise<Record<string, string>> {
    const program = tokenProgram ?? (await this.tokenProgramOf(mint));
    const out: Record<string, string> = {};
    for (let i = 0; i < owners.length; i += 100) {
      const chunk = owners.slice(i, i + 100);
      const atas = chunk.map((o) => getAssociatedTokenAddressSync(mint, new PublicKey(o), true, program));
      const infos = await this.conn.getMultipleAccountsInfo(atas, "confirmed");
      chunk.forEach((o, j) => {
        const data = infos[j]?.data;
        out[o] = data && data.length >= 72 ? data.readBigUInt64LE(64).toString() : "0";
      });
    }
    return out;
  }

  async tokenInfo(mintAddress: string): Promise<TokenInfo> {
    const mint = parsePubkey(mintAddress, "mint");
    const mintInfo = await this.conn.getAccountInfo(mint, "confirmed");
    if (!mintInfo) throw new InputError(`Mint ${mintAddress} does not exist on ${this.chain.name}`);
    const is2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    if (!is2022 && !mintInfo.owner.equals(TOKEN_PROGRAM_ID)) throw new InputError(`${mintAddress} is not an SPL token mint`);
    const supply = mintInfo.data.readBigUInt64LE(36);
    const decimals = mintInfo.data[44]!;
    let name: string | null = null;
    let symbol: string | null = null;
    if (is2022) {
      const md = await getTokenMetadata(this.conn, mint, "confirmed").catch(() => null);
      name = md?.name ?? null;
      symbol = md?.symbol ?? null;
    }
    const state = await this.pump.curve(mint).catch(() => null);
    let curve: TokenInfo["curve"] = null;
    let pool: TokenInfo["pool"] = null;
    let market: TokenInfo["market"] = null;
    let venue: VenueId | null = null;
    let venueNote: string;
    if (state) {
      const p = await this.pump.protocol();
      const vT = Number(state.curve.virtualTokenReserves.toString());
      const vS = Number(state.curve.virtualQuoteReserves.toString());
      curve = {
        complete: state.curve.complete,
        creator: state.curve.creator.toBase58(),
        progressPct: curveProgress(p, state.curve),
        marketCapLamports: marketCapLamports(state.curve).toString(),
        priceLamportsPerToken: vT > 0 ? vS / vT : 0,
      };
    }
    if (state && !state.curve.complete) {
      venue = "pumpfun";
      venueNote = "Pump.fun bonding curve (direct)";
      market = { priceLamportsPerToken: curve!.priceLamportsPerToken, marketCapLamports: curve!.marketCapLamports, liquidityLamports: state.curve.realQuoteReserves.toString() };
    } else {
      const found = await this.pumpswap.findPool(mint).catch(() => null);
      if (found) {
        const snap = this.pumpswap.snapshot(await this.pumpswap.state(found.pool), found.canonical);
        const price = poolPrice(snap);
        pool = { address: snap.pool, canonical: snap.canonical, baseReserve: snap.baseReserve.toString(), quoteReserve: snap.quoteReserve.toString() };
        market = { priceLamportsPerToken: price, marketCapLamports: BigInt(Math.floor(price * Number(supply))).toString(), liquidityLamports: (snap.quoteReserve * 2n).toString() };
        venue = "pumpswap";
        venueNote = found.canonical ? "Graduated to PumpSwap (direct)" : "PumpSwap pool (direct)";
      } else if (this.jupiter) {
        venue = "jupiter";
        venueNote = state ? "Graduated from Pump.fun; routed through Jupiter (Raydium, Meteora …)" : "Routed through Jupiter";
      } else {
        venueNote = state ? "Graduated from Pump.fun, but no PumpSwap pool was found on this network." : "No supported venue on this network (Jupiter routing is mainnet-only).";
      }
    }
    return { mint: mint.toBase58(), name, symbol, decimals, supply: supply.toString(), tokenProgram: mintInfo.owner.toBase58(), venue, venueNote, curve, pool, market };
  }
}

export { PUMP_TOTAL_SUPPLY };

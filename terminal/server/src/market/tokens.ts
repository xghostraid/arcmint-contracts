import type { Db } from "../db.js";
import { now } from "../db.js";
import type { SolanaAdapter, TokenInfo } from "../chains/solana/adapter.js";
import { InputError, parsePubkey } from "../chains/solana/adapter.js";
import { pumpSwapSdk } from "../chains/solana/pumpswap.js";

export interface TokenProfile {
  id: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  supply: string;
  venue: string | null;
  pool: string | null;
  tracked: boolean;
  newestSignature: string | null;
  addedAt: string;
}

interface Row {
  id: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  supply: string;
  venue: string | null;
  pool: string | null;
  tracked: number;
  newest_signature: string | null;
  added_at: string;
}

const toProfile = (r: Row): TokenProfile => ({
  id: r.id,
  mint: r.mint,
  symbol: r.symbol,
  name: r.name,
  decimals: r.decimals,
  supply: r.supply,
  venue: r.venue,
  pool: r.pool,
  tracked: r.tracked === 1,
  newestSignature: r.newest_signature,
  addedAt: r.added_at,
});

/** Tokens the user follows on the dashboard; ingestion runs for every tracked one. */
export class TokenRegistry {
  constructor(
    private readonly db: Db,
    private readonly network: string,
    private readonly sol: SolanaAdapter,
  ) {}

  list(includeUntracked = false): TokenProfile[] {
    const rows = this.db.prepare(`SELECT * FROM tokens WHERE network = ? ${includeUntracked ? "" : "AND tracked = 1"} ORDER BY id DESC`).all(this.network) as unknown as Row[];
    return rows.map(toProfile);
  }

  get(mint: string): TokenProfile | null {
    const r = this.db.prepare("SELECT * FROM tokens WHERE network = ? AND mint = ?").get(this.network, mint) as Row | undefined;
    return r ? toProfile(r) : null;
  }

  /** Adds (or re-enables) a token and records its venue; returns the fresh on-chain info too. */
  async track(address: string): Promise<{ profile: TokenProfile; info: TokenInfo }> {
    const mint = await this.resolveMint(address);
    const info = await this.sol.tokenInfo(mint);
    this.save(info, true);
    return { profile: this.get(mint)!, info };
  }

  /** Accepts a mint or a PumpSwap pool address (the pool's base mint is tracked). */
  private async resolveMint(address: string): Promise<string> {
    const key = parsePubkey(address, "address");
    const acct = await this.sol.conn.getAccountInfo(key, "confirmed");
    if (acct && acct.owner.equals(pumpSwapSdk().PUMP_AMM_PROGRAM_ID)) {
      const pool = pumpSwapSdk().PUMP_AMM_SDK.decodePoolNullable(acct);
      if (!pool) throw new InputError(`${address} is a PumpSwap account but not a pool`);
      return pool.baseMint.toBase58();
    }
    return key.toBase58();
  }

  /** Re-reads venue and supply, for example after a coin graduates to PumpSwap. */
  async refresh(mint: string): Promise<TokenInfo> {
    const info = await this.sol.tokenInfo(mint);
    if (this.get(mint)) this.save(info, this.get(mint)!.tracked);
    return info;
  }

  private save(info: TokenInfo, tracked: boolean): void {
    this.db
      .prepare(
        `INSERT INTO tokens (network, mint, symbol, name, decimals, supply, venue, pool, tracked, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (network, mint) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, decimals = excluded.decimals, supply = excluded.supply, venue = excluded.venue, pool = excluded.pool, tracked = excluded.tracked`,
      )
      .run(this.network, info.mint, info.symbol, info.name, info.decimals, info.supply, info.venue, info.pool?.address ?? null, tracked ? 1 : 0, now());
  }

  untrack(mint: string): void {
    const r = this.db.prepare("UPDATE tokens SET tracked = 0 WHERE network = ? AND mint = ?").run(this.network, mint);
    if (!r.changes) throw new InputError("Token is not tracked");
  }

  setNewestSignature(mint: string, signature: string): void {
    this.db.prepare("UPDATE tokens SET newest_signature = ? WHERE network = ? AND mint = ?").run(signature, this.network, mint);
  }

  /** PumpSwap pool → base mint, for attributing AMM events. */
  poolMap(): Map<string, string> {
    const rows = this.db.prepare("SELECT mint, pool FROM tokens WHERE network = ? AND pool IS NOT NULL").all(this.network) as { mint: string; pool: string }[];
    return new Map(rows.map((r) => [r.pool, r.mint]));
  }
}

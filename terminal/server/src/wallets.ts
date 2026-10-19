import { Keypair } from "@solana/web3.js";
import type { Db } from "./db.js";
import { now, tx } from "./db.js";
import type { Vault } from "./vault.js";
import { keyFamilies, type ChainFamily, type DerivedKey } from "./chains/families.js";

export type WalletStatus = "active" | "archived";

export interface Wallet {
  id: number;
  family: ChainFamily;
  address: string;
  label: string;
  groupId: number | null;
  source: "hd" | "imported";
  hdIndex: number | null;
  status: WalletStatus;
  createdAt: string;
}

export interface WalletGroup {
  id: number;
  name: string;
  walletCount: number;
}

interface WalletRow {
  id: number;
  family: ChainFamily;
  address: string;
  label: string;
  group_id: number | null;
  source: "hd" | "imported";
  hd_index: number | null;
  status: WalletStatus;
  created_at: string;
}

function toWallet(r: WalletRow): Wallet {
  return {
    id: r.id,
    family: r.family,
    address: r.address,
    label: r.label,
    groupId: r.group_id,
    source: r.source,
    hdIndex: r.hd_index,
    status: r.status,
    createdAt: r.created_at,
  };
}

export class WalletError extends Error {}

const COLS = "id, family, address, label, group_id, source, hd_index, status, created_at";
export const MAX_GENERATE = 500;

export class WalletStore {
  constructor(private readonly db: Db, private readonly vault: Vault) {}

  listGroups(): WalletGroup[] {
    return this.db
      .prepare("SELECT g.id, g.name, COUNT(w.id) AS walletCount FROM wallet_groups g LEFT JOIN wallets w ON w.group_id = g.id AND w.status = 'active' GROUP BY g.id ORDER BY g.id")
      .all() as unknown as WalletGroup[];
  }

  createGroup(name: string): WalletGroup {
    const clean = name.trim();
    if (!clean) throw new WalletError("Group name is required");
    try {
      const r = this.db.prepare("INSERT INTO wallet_groups (name, created_at) VALUES (?, ?)").run(clean, now());
      return { id: Number(r.lastInsertRowid), name: clean, walletCount: 0 };
    } catch {
      throw new WalletError(`Group "${clean}" already exists`);
    }
  }

  renameGroup(id: number, name: string): void {
    const r = this.db.prepare("UPDATE wallet_groups SET name = ? WHERE id = ?").run(name.trim(), id);
    if (r.changes === 0) throw new WalletError("Group not found");
  }

  deleteGroup(id: number): void {
    this.db.prepare("DELETE FROM wallet_groups WHERE id = ?").run(id);
  }

  list(opts: { includeArchived?: boolean; groupId?: number; family?: ChainFamily } = {}): Wallet[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (!opts.includeArchived) where.push("status = 'active'");
    if (opts.groupId !== undefined) {
      where.push("group_id = ?");
      args.push(opts.groupId);
    }
    if (opts.family) {
      where.push("family = ?");
      args.push(opts.family);
    }
    const sql = `SELECT ${COLS} FROM wallets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
    return (this.db.prepare(sql).all(...args) as unknown as WalletRow[]).map(toWallet);
  }

  get(id: number): Wallet {
    const r = this.db.prepare(`SELECT ${COLS} FROM wallets WHERE id = ?`).get(id) as WalletRow | undefined;
    if (!r) throw new WalletError(`Wallet ${id} not found`);
    return toWallet(r);
  }

  getMany(ids: number[]): Wallet[] {
    const unique = [...new Set(ids)];
    return unique.map((id) => this.get(id));
  }

  findByAddress(address: string): Wallet | undefined {
    const r = this.db.prepare(`SELECT ${COLS} FROM wallets WHERE address = ?`).get(address) as WalletRow | undefined;
    return r ? toWallet(r) : undefined;
  }

  /** Every address the user controls, archived ones included; used to label own-wallet activity. */
  ownAddresses(): Set<string> {
    return new Set((this.db.prepare("SELECT address FROM wallets").all() as { address: string }[]).map((r) => r.address));
  }

  private insert(family: ChainFamily, keys: DerivedKey[], source: "hd" | "imported", groupId: number | null, labelPrefix: string): { created: Wallet[]; skipped: string[] } {
    const created: Wallet[] = [];
    const skipped: string[] = [];
    const startCount = (this.db.prepare("SELECT COUNT(*) AS n FROM wallets").get() as { n: number }).n;
    tx(this.db, () => {
      const stmt = this.db.prepare(
        "INSERT INTO wallets (family, address, label, group_id, source, hd_index, status, encrypted_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT (family, address) DO NOTHING",
      );
      for (const key of keys) {
        const label = `${labelPrefix} ${startCount + created.length + 1}`.trim();
        const r = stmt.run(family, key.address, label, groupId, source, key.hdIndex ?? null, this.vault.sealSecret(key.address, key.secret), now());
        key.secret.fill(0);
        if (r.changes === 0) skipped.push(key.address);
        else created.push(this.get(Number(r.lastInsertRowid)));
      }
    });
    return { created, skipped };
  }

  generate(opts: { count: number; groupId?: number | null; labelPrefix?: string; family?: ChainFamily }): Wallet[] {
    const count = Math.floor(opts.count);
    if (count < 1 || count > MAX_GENERATE) throw new WalletError(`Count must be 1–${MAX_GENERATE}`);
    const family = keyFamilies[opts.family ?? "solana"];
    if (!family) throw new WalletError(`Unsupported chain family ${opts.family}`);
    const { seed, start } = this.vault.reserveHdIndexes(count);
    try {
      const keys = Array.from({ length: count }, (_, i) => family.deriveFromSeed(seed, start + i));
      return this.insert(family.family, keys, "hd", opts.groupId ?? null, opts.labelPrefix ?? "Wallet").created;
    } finally {
      seed.fill(0);
    }
  }

  import(opts: { text: string; groupId?: number | null; labelPrefix?: string; mnemonicAccounts?: number; family?: ChainFamily }) {
    const family = keyFamilies[opts.family ?? "solana"];
    if (!family) throw new WalletError(`Unsupported chain family ${opts.family}`);
    const keys = family.parseImport(opts.text, opts.mnemonicAccounts ?? 1);
    return this.insert(family.family, keys, "imported", opts.groupId ?? null, opts.labelPrefix ?? "Imported");
  }

  update(ids: number[], patch: { label?: string; groupId?: number | null; status?: WalletStatus }): void {
    tx(this.db, () => {
      for (const id of ids) {
        this.get(id);
        if (patch.label !== undefined) this.db.prepare("UPDATE wallets SET label = ? WHERE id = ?").run(patch.label.trim(), id);
        if (patch.groupId !== undefined) this.db.prepare("UPDATE wallets SET group_id = ? WHERE id = ?").run(patch.groupId, id);
        if (patch.status !== undefined) this.db.prepare("UPDATE wallets SET status = ? WHERE id = ?").run(patch.status, id);
      }
    });
  }

  private secretOf(id: number): { wallet: Wallet; secret: Buffer } {
    const wallet = this.get(id);
    const row = this.db.prepare("SELECT encrypted_secret FROM wallets WHERE id = ?").get(id) as { encrypted_secret: string };
    return { wallet, secret: this.vault.openSecret(wallet.address, row.encrypted_secret) };
  }

  /** Decrypts Solana keypairs for one operation. Callers must not retain them past `fn`. */
  async withSolanaSigners<T>(ids: number[], fn: (signers: Map<number, Keypair>) => Promise<T>): Promise<T> {
    const signers = new Map<number, Keypair>();
    const buffers: Buffer[] = [];
    try {
      for (const id of new Set(ids)) {
        const { wallet, secret } = this.secretOf(id);
        if (wallet.family !== "solana") throw new WalletError(`Wallet ${id} is not a Solana wallet`);
        buffers.push(secret);
        signers.set(id, Keypair.fromSecretKey(secret));
      }
      return await fn(signers);
    } finally {
      // Keypair.fromSecretKey keeps a reference to the buffer it was given, so zeroing it wipes the signer.
      for (const b of buffers) b.fill(0);
    }
  }

  exportSecrets(ids: number[]): { id: number; address: string; label: string; family: ChainFamily; secretKey: string }[] {
    return ids.map((id) => {
      const { wallet, secret } = this.secretOf(id);
      try {
        return { id, address: wallet.address, label: wallet.label, family: wallet.family, secretKey: keyFamilies[wallet.family]!.exportSecret(secret) };
      } finally {
        secret.fill(0);
      }
    });
  }
}

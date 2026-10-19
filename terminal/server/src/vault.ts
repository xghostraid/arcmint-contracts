import { EventEmitter } from "node:events";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { DEFAULT_KDF, deriveKek, newKdfParams, open, seal, type KdfParams } from "./crypto/envelope.js";

export class VaultError extends Error {
  constructor(message: string, readonly code: "locked" | "not_initialized" | "already_initialized" | "bad_passphrase" | "weak_passphrase" | "bad_mnemonic") {
    super(message);
  }
}

interface VaultRow {
  version: number;
  kdf: string;
  wrapped_dek: string;
  encrypted_mnemonic: string;
  next_hd_index: number;
}

export const MIN_PASSPHRASE_LENGTH = 10;

/**
 * Envelope encryption: passphrase → scrypt → KEK, which wraps a random 32-byte data key (DEK).
 * The DEK encrypts the HD mnemonic and every wallet secret. Only the DEK lives in memory while unlocked.
 */
export class Vault extends EventEmitter {
  private dek: Buffer | null = null;
  private lastUsed = 0;
  private timer: NodeJS.Timeout | null = null;
  keepUnlocked = false;

  constructor(private readonly db: Db, private readonly opts: { autoLockMinutes: number; kdf?: Omit<KdfParams, "salt"> }) {
    super();
    if (opts.autoLockMinutes > 0) {
      this.timer = setInterval(() => this.checkIdle(), 15_000);
      this.timer.unref();
    }
  }

  private row(): VaultRow | undefined {
    return this.db.prepare("SELECT version, kdf, wrapped_dek, encrypted_mnemonic, next_hd_index FROM vault_meta WHERE id = 1").get() as VaultRow | undefined;
  }

  get initialized(): boolean {
    return this.row() !== undefined;
  }

  get unlocked(): boolean {
    return this.dek !== null;
  }

  async init(passphrase: string, mnemonic?: string): Promise<void> {
    if (this.initialized) throw new VaultError("Vault already exists", "already_initialized");
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new VaultError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`, "weak_passphrase");
    }
    const phrase = mnemonic?.trim().toLowerCase().split(/\s+/).join(" ") ?? generateMnemonic(wordlist, 256);
    if (!validateMnemonic(phrase, wordlist)) throw new VaultError("Recovery phrase is not a valid BIP-39 mnemonic", "bad_mnemonic");
    const kdf = newKdfParams(this.opts.kdf ?? DEFAULT_KDF);
    const kek = await deriveKek(passphrase, kdf);
    const dek = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
    this.db
      .prepare("INSERT INTO vault_meta (id, version, kdf, wrapped_dek, encrypted_mnemonic, next_hd_index, created_at) VALUES (1, 1, ?, ?, ?, 0, ?)")
      .run(JSON.stringify(kdf), seal(kek, dek, "dek"), seal(dek, Buffer.from(phrase, "utf8"), "mnemonic"), now());
    kek.fill(0);
    this.setDek(dek);
  }

  private async unwrap(passphrase: string): Promise<Buffer> {
    const row = this.row();
    if (!row) throw new VaultError("Vault not initialized", "not_initialized");
    const kek = await deriveKek(passphrase, JSON.parse(row.kdf) as KdfParams);
    try {
      return open(kek, row.wrapped_dek, "dek");
    } catch {
      throw new VaultError("Wrong passphrase", "bad_passphrase");
    } finally {
      kek.fill(0);
    }
  }

  async unlock(passphrase: string): Promise<void> {
    this.setDek(await this.unwrap(passphrase));
  }

  /** Re-checks the passphrase without changing lock state; used to gate exports. */
  async verify(passphrase: string): Promise<void> {
    (await this.unwrap(passphrase)).fill(0);
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    if (next.length < MIN_PASSPHRASE_LENGTH) {
      throw new VaultError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`, "weak_passphrase");
    }
    const dek = await this.unwrap(current);
    const kdf = newKdfParams(this.opts.kdf ?? DEFAULT_KDF);
    const kek = await deriveKek(next, kdf);
    this.db.prepare("UPDATE vault_meta SET kdf = ?, wrapped_dek = ? WHERE id = 1").run(JSON.stringify(kdf), seal(kek, dek, "dek"));
    kek.fill(0);
    dek.fill(0);
  }

  lock(): void {
    if (!this.dek) return;
    this.dek.fill(0);
    this.dek = null;
    this.emit("locked");
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  private setDek(dek: Buffer): void {
    this.dek?.fill(0);
    this.dek = dek;
    this.touch();
    this.emit("unlocked");
  }

  private checkIdle(): void {
    if (!this.dek || this.keepUnlocked) return;
    if (Date.now() - this.lastUsed > this.opts.autoLockMinutes * 60_000) this.lock();
  }

  private key(): Buffer {
    if (!this.dek) throw new VaultError("Vault is locked", "locked");
    this.touch();
    return this.dek;
  }

  sealSecret(aad: string, secret: Uint8Array): string {
    return seal(this.key(), secret, `wallet:${aad}`);
  }

  openSecret(aad: string, sealed: string): Buffer {
    return open(this.key(), sealed, `wallet:${aad}`);
  }

  mnemonic(): string {
    const row = this.row();
    if (!row) throw new VaultError("Vault not initialized", "not_initialized");
    return open(this.key(), row.encrypted_mnemonic, "mnemonic").toString("utf8");
  }

  /** Reserves `count` consecutive HD indexes and returns the seed; the caller zeroes it. */
  reserveHdIndexes(count: number): { seed: Uint8Array; start: number } {
    const row = this.row();
    if (!row) throw new VaultError("Vault not initialized", "not_initialized");
    const seed = mnemonicToSeedSync(this.mnemonic());
    this.db.prepare("UPDATE vault_meta SET next_hd_index = next_hd_index + ? WHERE id = 1").run(count);
    return { seed, start: row.next_hd_index };
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.lock();
  }
}

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { deriveEd25519, solanaPath } from "../crypto/slip10.js";

export type ChainFamily = "solana" | "evm";

export interface DerivedKey {
  address: string;
  secret: Uint8Array;
  hdIndex?: number;
}

/** Key handling per chain family. EVM (secp256k1, m/44'/60'/0'/0/i) slots in here in Phase 4. */
export interface KeyFamily {
  family: ChainFamily;
  deriveFromSeed(seed: Uint8Array, index: number): DerivedKey;
  /** Accepts one key per line (base58 / JSON byte array) or a whole mnemonic phrase. */
  parseImport(text: string, mnemonicAccounts: number): DerivedKey[];
  exportSecret(secret: Uint8Array): string;
}

export class ImportError extends Error {}

export const solanaKeys: KeyFamily = {
  family: "solana",
  deriveFromSeed(seed, index) {
    const kp = Keypair.fromSeed(deriveEd25519(seed, solanaPath(index)));
    return { address: kp.publicKey.toBase58(), secret: kp.secretKey, hdIndex: index };
  },
  parseImport(text, mnemonicAccounts) {
    const trimmed = text.trim();
    if (!trimmed) throw new ImportError("Nothing to import");
    const words = trimmed.split(/\s+/);
    if (words.length >= 12 && words.every((w) => /^[a-z]+$/i.test(w))) {
      const phrase = words.join(" ").toLowerCase();
      if (!validateMnemonic(phrase, wordlist)) throw new ImportError("Invalid recovery phrase");
      const seed = mnemonicToSeedSync(phrase);
      const count = Math.max(1, Math.min(100, Math.floor(mnemonicAccounts)));
      const out = Array.from({ length: count }, (_, i) => {
        const kp = Keypair.fromSeed(deriveEd25519(seed, solanaPath(i)));
        return { address: kp.publicKey.toBase58(), secret: kp.secretKey };
      });
      seed.fill(0);
      return out;
    }
    const lines = trimmed.startsWith("[") && !trimmed.includes("\n") ? [trimmed] : trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.map((line, i) => {
      let bytes: Uint8Array;
      try {
        bytes = line.startsWith("[") ? Uint8Array.from(JSON.parse(line) as number[]) : bs58.decode(line);
      } catch {
        throw new ImportError(`Line ${i + 1}: not a base58 secret key or JSON byte array`);
      }
      if (bytes.length !== 64) throw new ImportError(`Line ${i + 1}: expected a 64-byte secret key, got ${bytes.length} bytes`);
      let kp: Keypair;
      try {
        kp = Keypair.fromSecretKey(bytes);
      } catch {
        throw new ImportError(`Line ${i + 1}: secret key does not match its public key`);
      }
      return { address: kp.publicKey.toBase58(), secret: kp.secretKey };
    });
  },
  exportSecret(secret) {
    return bs58.encode(secret);
  },
};

export const keyFamilies: Record<string, KeyFamily> = { solana: solanaKeys };

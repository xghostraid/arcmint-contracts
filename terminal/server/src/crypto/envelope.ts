import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

export interface KdfParams {
  name: "scrypt";
  salt: string;
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_KDF: Omit<KdfParams, "salt"> = { name: "scrypt", N: 2 ** 17, r: 8, p: 1 };

export function newKdfParams(base: Omit<KdfParams, "salt"> = DEFAULT_KDF): KdfParams {
  return { ...base, salt: randomBytes(16).toString("base64") };
}

export function deriveKek(passphrase: string, kdf: KdfParams): Promise<Buffer> {
  if (kdf.name !== "scrypt") throw new Error(`Unsupported KDF ${kdf.name}`);
  return new Promise((resolve, reject) => {
    scryptCb(
      passphrase.normalize("NFKC"),
      Buffer.from(kdf.salt, "base64"),
      32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64; `aad` binds the ciphertext to its row (for example the wallet address). */
export function seal(key: Buffer, plaintext: Uint8Array, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function open(key: Buffer, sealed: string, aad: string): Buffer {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

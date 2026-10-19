import { createHmac } from "node:crypto";

const HARDENED = 0x80000000;

/** SLIP-10 ed25519 derivation (hardened only), as used by Phantom/Solflare for m/44'/501'/i'/0'. */
export function deriveEd25519(seed: Uint8Array, path: string): Buffer {
  const segments = path.split("/");
  if (segments[0] !== "m") throw new Error(`Invalid derivation path ${path}`);
  let I = createHmac("sha512", "ed25519 seed").update(seed).digest();
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);
  for (const segment of segments.slice(1)) {
    if (!segment.endsWith("'")) throw new Error(`ed25519 supports hardened segments only (${path})`);
    const index = Number(segment.slice(0, -1));
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error(`Invalid segment ${segment}`);
    const data = Buffer.alloc(37);
    key.copy(data, 1);
    data.writeUInt32BE(index + HARDENED, 33);
    I = createHmac("sha512", chainCode).update(data).digest();
    key = I.subarray(0, 32);
    chainCode = I.subarray(32);
  }
  return Buffer.from(key);
}

export function solanaPath(index: number): string {
  return `m/44'/501'/${index}'/0'`;
}

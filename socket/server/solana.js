import { createPublicKey, verify } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes) {
  const raw = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < raw.length && raw[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < raw.length; i += 1) {
    let carry = raw[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

export function decodeBase58(text) {
  if (typeof text !== "string" || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) return null;
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes = [0];
  for (let i = zeros; i < text.length; i += 1) {
    let carry = ALPHABET.indexOf(text[i]);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = Buffer.alloc(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function walletFromPublicKey(publicKey) {
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  if (raw.length !== 32) throw new Error("bad key");
  return encodeBase58(raw);
}

export function verifyWalletSignature(wallet, message, signature) {
  try {
    const raw = decodeBase58(wallet);
    const sig = decodeBase58(signature);
    if (!raw || raw.length !== 32 || !sig || sig.length !== 64) return false;
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(String(message)), key, sig);
  } catch {
    return false;
  }
}

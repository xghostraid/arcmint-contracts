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

const P = 2n ** 255n - 19n;
const D = (P + (-121665n * modPow(121666n, P - 2n))) % P;

function modPow(base, exp) {
  let result = 1n;
  let b = ((base % P) + P) % P;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

// Program ids and mints are not fee wallets. Token accounts are program
// addresses and fail the curve check below. No network call.
const NOT_WALLETS = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "So11111111111111111111111111111111111111112",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "ComputeBudget111111111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
  "Stake11111111111111111111111111111111111111",
  "BPFLoaderUpgradeab1e11111111111111111111111",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
]);

export function isOnCurve(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 0; i < 32; i += 1) y += BigInt(bytes[i]) << (8n * BigInt(i));
  const sign = (y >> 255n) & 1n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  if (v === 0n) return false;
  const x2 = (u * modPow(v, P - 2n)) % P;
  let x = modPow(x2, (P + 3n) / 8n);
  if ((x * x - x2 + P) % P !== 0n) x = (x * modPow(2n, (P - 1n) / 4n)) % P;
  if ((x * x - x2 + P) % P !== 0n) return false;
  if (x === 0n && sign === 1n) return false;
  return true;
}

export function isOrdinaryWallet(address) {
  if (typeof address !== "string" || NOT_WALLETS.has(address)) return false;
  const raw = decodeBase58(address);
  return Boolean(raw && raw.length === 32 && isOnCurve(raw));
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

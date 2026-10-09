import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccessTokenClaims } from "./types.js";
const sig = (s: string, p: string) => createHmac("sha256", s).update(p).digest("base64url");
export function signAccessToken(secret: string, claims: AccessTokenClaims) {
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url"); return `${p}.${sig(secret, p)}`;
}
export function verifyAccessToken(secret: string, token: string): AccessTokenClaims | null {
  const i = token.indexOf("."); if (i <= 0) return null; const p = token.slice(0, i); const s = token.slice(i + 1);
  const e = sig(secret, p); if (s.length !== e.length || !timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as AccessTokenClaims;
    return c.exp * 1000 >= Date.now() ? c : null; } catch { return null; }
}
export function newAccessTokenClaims(sub: string, email: string, ttl = 86400): AccessTokenClaims {
  const iat = Math.floor(Date.now() / 1000); return { sub, email, iat, exp: iat + ttl };
}

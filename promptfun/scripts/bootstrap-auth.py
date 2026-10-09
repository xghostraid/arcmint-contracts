#!/usr/bin/env python3
from __future__ import annotations
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

def w(rel: str, body: str) -> None:
    p = SRC / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)

# --- modules (compact) ---
w("auth/token.ts", '''import { createHmac, timingSafeEqual } from "node:crypto";
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
''')

w("auth/metadata.ts", '''import type { Config } from "../config.js";
export function protectedResourceMetadata(c: Config) {
  return { resource: `${c.publicUrl}/mcp`, authorization_servers: [c.publicUrl] };
}
export function authorizationServerMetadata(c: Config) {
  const b = c.publicUrl;
  return { issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`, code_challenge_methods_supported: ["S256"] };
}
''')

w("auth/mcp.ts", '''import type http from "node:http";
import type { Config } from "../config.js";
import { verifyAccessToken } from "./token.js";
export function authenticateBearer(c: Config, req: http.IncomingMessage) {
  const h = req.headers.authorization; if (!h?.startsWith("Bearer ")) return null;
  const t = verifyAccessToken(c.oauthSigningSecret, h.slice(7).trim()); return t ? { sub: t.sub, email: t.email } : null;
}
export function mcpUnauthorizedHeaders(c: Config) {
  const u = `${c.publicUrl}/.well-known/oauth-protected-resource`;
  return { "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${u}"`, "Cache-Control": "no-store" };
}
''')

w("auth/oauth-server.ts", open(SRC / "auth/oauth-server.ts").read() if (SRC / "auth/oauth-server.ts").exists() else '''import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config.js";
import type { PlatformStore } from "../platform/store.js";
import { verifyPkce } from "./pkce.js";
import { newAccessTokenClaims, signAccessToken } from "./token.js";
export class OAuthServer {
  constructor(readonly config: Config, readonly store: PlatformStore) {}
  registerClient(redirectUris: string[]) {
    const clientId = `pf_${randomBytes(12).toString("hex")}`;
    const client = { clientId, redirectUris, createdAt: new Date().toISOString() };
    this.store.saveClient(client); return client;
  }
  validateRedirect(clientId: string, redirectUri: string) {
    return this.store.getClient(clientId)?.redirectUris.includes(redirectUri) ?? false;
  }
  createMagicLink(email: string) {
    const e = email.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) throw new Error("Invalid email.");
    const token = randomBytes(24).toString("base64url");
    this.store.saveMagicToken(token, e, Date.now() + 900000);
    return { magicUrl: `${this.config.publicUrl}/oauth/magic/verify?token=${encodeURIComponent(token)}`, exposeLink: this.config.oauthExposeMagicLink };
  }
  verifyMagicAndIssueCode(i: { token: string; clientId: string; redirectUri: string; state: string; codeChallenge: string; codeChallengeMethod: string }) {
    const email = this.store.consumeMagicToken(i.token); if (!email) throw new Error("expired");
    if (!this.validateRedirect(i.clientId, i.redirectUri)) throw new Error("client");
    const sub = createHash("sha256").update(`promptfun:${email}`).digest("hex").slice(0, 32);
    this.store.upsertUser(sub, email);
    const code = randomBytes(24).toString("base64url");
    this.store.saveAuthCode({ code, clientId: i.clientId, redirectUri: i.redirectUri, codeChallenge: i.codeChallenge, codeChallengeMethod: i.codeChallengeMethod, sub, email, expiresAt: Date.now() + 600000 });
    const u = new URL(i.redirectUri); u.searchParams.set("code", code); if (i.state) u.searchParams.set("state", i.state);
    return { redirectUrl: u.toString() };
  }
  exchangeToken(i: { code: string; redirectUri: string; clientId: string; codeVerifier: string }) {
    const r = this.store.consumeAuthCode(i.code); if (!r || r.clientId !== i.clientId || r.redirectUri !== i.redirectUri) throw new Error("code");
    if (!verifyPkce(r.codeChallenge, r.codeChallengeMethod, i.codeVerifier)) throw new Error("pkce");
    const claims = newAccessTokenClaims(r.sub, r.email);
    return { access_token: signAccessToken(this.config.oauthSigningSecret, claims), token_type: "Bearer", expires_in: claims.exp - claims.iat };
  }
}
''')

# NOTE: truncated bootstrap - run remaining writes via separate commit on coordinator machine

if __name__ == "__main__":
    print("partial bootstrap only")

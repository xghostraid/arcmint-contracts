import { createHash, randomBytes } from "node:crypto";
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Invalid email.");
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

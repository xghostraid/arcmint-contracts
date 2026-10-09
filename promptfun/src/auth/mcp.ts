import type http from "node:http";
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

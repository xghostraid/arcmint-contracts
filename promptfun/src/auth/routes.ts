import type http from "node:http";
import type { Config } from "../config.js";
import type { OAuthServer } from "./oauth-server.js";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata.js";

function qp(url: URL, key: string): string {
  return url.searchParams.get(key)?.trim() ?? "";
}

async function readBody(req: http.IncomingMessage, max = 64 * 1024): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseForm(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.toString("utf8").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const v = decodeURIComponent(eq >= 0 ? part.slice(eq + 1).replace(/\+/g, " ") : "");
    out[k] = v;
  }
  return out;
}

function oauthParams(url: URL, form?: Record<string, string>): {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
} {
  const f = form ?? {};
  return {
    clientId: f.client_id || qp(url, "client_id"),
    redirectUri: f.redirect_uri || qp(url, "redirect_uri"),
    state: f.state || qp(url, "state"),
    codeChallenge: f.code_challenge || qp(url, "code_challenge"),
    codeChallengeMethod: f.code_challenge_method || qp(url, "code_challenge_method") || "S256",
  };
}

function authorizeHtml(params: ReturnType<typeof oauthParams>, error?: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — promptfun</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;background:#ebe6ff;color:#1a1333}input,button{width:100%;box-sizing:border-box;padding:.75rem;margin:.5rem 0;font-size:1rem}button{background:#9b7bff;color:#fff;border:none;border-radius:.5rem;cursor:pointer}.err{color:#b00020;font-size:.9rem}</style></head><body>
<h1>Sign in</h1><p>Enter your email. We will send a magic link to finish connecting Claude.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="client_id" value="${esc(params.clientId)}">
<input type="hidden" name="redirect_uri" value="${esc(params.redirectUri)}">
<input type="hidden" name="state" value="${esc(params.state)}">
<input type="hidden" name="code_challenge" value="${esc(params.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${esc(params.codeChallengeMethod)}">
<label>Email <input type="email" name="email" required autocomplete="email"></label>
<button type="submit">Continue</button></form></body></html>`;
}

function magicSentHtml(link: string | null, expose: boolean): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const devLink = expose && link ? `<p><a href="${esc(link)}">Open magic link</a> (dev only)</p>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Check your email</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem">
<h1>Check your email</h1><p>If an account exists for that address, we sent a sign-in link. It expires in 15 minutes.</p>${devLink}</body></html>`;
}

export type OAuthJson = (status: number, body: unknown) => void;
export type OAuthSend = (status: number, type: string, body: string | Buffer) => void;

/** Returns true when the request was handled (including errors). */
export async function handleOAuthRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  config: Config,
  oauth: OAuthServer,
  json: OAuthJson,
  send: OAuthSend,
): Promise<boolean> {
  if (pathname === "/.well-known/oauth-protected-resource" || pathname === "/.well-known/oauth-protected-resource/mcp") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    json(200, protectedResourceMetadata(config));
    return true;
  }
  if (pathname === "/.well-known/oauth-authorization-server") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    json(200, authorizationServerMetadata(config));
    return true;
  }

  if (pathname === "/oauth/register") {
    if (req.method !== "POST") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    const ct = String(req.headers["content-type"] || "");
    let redirectUris: string[] = [];
    try {
      const body = await readBody(req);
      const parsed = ct.includes("application/json") ? JSON.parse(body.toString("utf8")) : parseForm(body);
      redirectUris = Array.isArray(parsed.redirect_uris) ? parsed.redirect_uris.map(String) : [];
    } catch {
      json(400, { error: "invalid_client_metadata" });
      return true;
    }
    if (!redirectUris.length) {
      json(400, { error: "invalid_redirect_uri" });
      return true;
    }
    const client = oauth.registerClient(redirectUris);
    json(201, {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
      token_endpoint_auth_method: "none",
    });
    return true;
  }

  if (pathname === "/oauth/authorize") {
    if (req.method === "GET") {
      const params = oauthParams(url);
      if (!params.clientId || !params.redirectUri || !params.codeChallenge) {
        json(400, { error: "invalid_request" });
        return true;
      }
      if (!oauth.validateRedirect(params.clientId, params.redirectUri)) {
        json(400, { error: "invalid_client" });
        return true;
      }
      send(200, "text/html; charset=utf-8", authorizeHtml(params));
      return true;
    }
    if (req.method === "POST") {
      let form: Record<string, string>;
      try {
        form = parseForm(await readBody(req));
      } catch {
        json(400, { error: "invalid_request" });
        return true;
      }
      const params = oauthParams(url, form);
      const email = form.email?.trim() ?? "";
      if (!params.clientId || !params.redirectUri || !params.codeChallenge || !email) {
        send(400, "text/html; charset=utf-8", authorizeHtml(params, "Missing required fields."));
        return true;
      }
      if (!oauth.validateRedirect(params.clientId, params.redirectUri)) {
        send(400, "text/html; charset=utf-8", authorizeHtml(params, "Unknown client or redirect URI."));
        return true;
      }
      try {
        const { magicUrl, exposeLink } = oauth.createMagicLink(email);
        const u = new URL(magicUrl);
        u.searchParams.set("client_id", params.clientId);
        u.searchParams.set("redirect_uri", params.redirectUri);
        u.searchParams.set("code_challenge", params.codeChallenge);
        u.searchParams.set("code_challenge_method", params.codeChallengeMethod);
        if (params.state) u.searchParams.set("state", params.state);
        send(200, "text/html; charset=utf-8", magicSentHtml(u.toString(), exposeLink));
      } catch (e) {
        send(400, "text/html; charset=utf-8", authorizeHtml(params, (e as Error).message));
      }
      return true;
    }
    json(405, { error: "Method not allowed." });
    return true;
  }

  if (pathname === "/oauth/magic/verify") {
    if (req.method !== "GET") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    const token = qp(url, "token");
    const params = oauthParams(url);
    if (!token || !params.clientId || !params.redirectUri || !params.codeChallenge) {
      json(400, { error: "invalid_request" });
      return true;
    }
    try {
      const { redirectUrl } = oauth.verifyMagicAndIssueCode({
        token,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        state: params.state,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
      });
      res.statusCode = 302;
      res.setHeader("Location", redirectUrl);
      res.setHeader("Cache-Control", "no-store");
      res.end();
    } catch {
      json(400, { error: "invalid_grant" });
    }
    return true;
  }

  if (pathname === "/oauth/token") {
    if (req.method !== "POST") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    let form: Record<string, string>;
    try {
      const body = await readBody(req);
      const ct = String(req.headers["content-type"] || "");
      form = ct.includes("application/json") ? (JSON.parse(body.toString("utf8")) as Record<string, string>) : parseForm(body);
    } catch {
      json(400, { error: "invalid_request" });
      return true;
    }
    if (form.grant_type !== "authorization_code") {
      json(400, { error: "unsupported_grant_type" });
      return true;
    }
    try {
      const tok = oauth.exchangeToken({
        code: String(form.code ?? ""),
        redirectUri: String(form.redirect_uri ?? ""),
        clientId: String(form.client_id ?? ""),
        codeVerifier: String(form.code_verifier ?? ""),
      });
      json(200, tok);
    } catch {
      json(400, { error: "invalid_grant" });
    }
    return true;
  }

  return false;
}

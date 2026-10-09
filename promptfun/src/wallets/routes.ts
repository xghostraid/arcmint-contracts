import type http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config.js";
import { authenticateBearer } from "../auth/mcp.js";
import type { PlatformStore } from "../platform/store.js";
import { claimDonePage, claimHomePage, claimSentPage } from "../web/claim.js";
import type { ClaimLaterWalletProvider } from "./claim-later.js";
import { platformSubFromEmail } from "./claim-later.js";

function qp(url: URL, key: string): string {
  return url.searchParams.get(key)?.trim() ?? "";
}

async function readBody(req: http.IncomingMessage, max = 16 * 1024): Promise<Buffer> {
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

export async function handleClaimRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  url: URL,
  config: Config,
  platform: PlatformStore | null,
  wallets: ClaimLaterWalletProvider | null,
  json: (status: number, body: unknown) => void,
  send: (status: number, type: string, body: string | Buffer) => void,
): Promise<boolean> {
  if (pathname === "/api/claim/wallet") {
    if (req.method !== "GET" && req.method !== "POST") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    if (!platform || !wallets) {
      json(503, { error: "Claim wallets require OAuth and Privy configuration." });
      return true;
    }
    const user = authenticateBearer(config, req);
    if (!user) {
      json(401, { error: "invalid_token", error_description: "Bearer access token required." });
      return true;
    }
    try {
      const record = await wallets.ensureSolanaWallet(user.sub, user.email);
      json(200, wallets.toView(record));
    } catch (err) {
      json(503, { error: (err as Error).message });
    }
    return true;
  }

  if (pathname === "/claim") {
    if (req.method === "GET") {
      send(200, "text/html; charset=utf-8", claimHomePage(config, wallets?.isConfigured() ?? false));
      return true;
    }
    if (req.method === "POST") {
      if (!platform || !wallets?.isConfigured()) {
        send(503, "text/html; charset=utf-8", claimHomePage(config, false, "Claim wallets are not available on this server yet."));
        return true;
      }
      let email = "";
      try {
        email = parseForm(await readBody(req)).email?.trim() ?? "";
      } catch {
        send(400, "text/html; charset=utf-8", claimHomePage(config, true, "Request too large."));
        return true;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        send(400, "text/html; charset=utf-8", claimHomePage(config, true, "Enter a valid email address."));
        return true;
      }
      const token = randomBytes(24).toString("base64url");
      platform.saveClaimMagicToken(token, email.toLowerCase(), Date.now() + 900_000);
      const link = `${config.publicUrl}/claim/verify?token=${encodeURIComponent(token)}`;
      send(200, "text/html; charset=utf-8", claimSentPage(link, config.oauthExposeMagicLink));
      return true;
    }
    json(405, { error: "Method not allowed." });
    return true;
  }

  if (pathname === "/claim/verify") {
    if (req.method !== "GET") {
      json(405, { error: "Method not allowed." });
      return true;
    }
    if (!platform || !wallets?.isConfigured()) {
      send(503, "text/html; charset=utf-8", claimHomePage(config, false, "Claim wallets are not available on this server yet."));
      return true;
    }
    const token = qp(url, "token");
    const email = platform.consumeClaimMagicToken(token);
    if (!email) {
      send(400, "text/html; charset=utf-8", claimHomePage(config, true, "This link expired or was already used."));
      return true;
    }
    platform.upsertUser(platformSubFromEmail(email), email);
    try {
      const record = await wallets.ensureSolanaWallet(platformSubFromEmail(email), email);
      send(200, "text/html; charset=utf-8", claimDonePage(wallets.toView(record)));
    } catch (err) {
      send(503, "text/html; charset=utf-8", claimHomePage(config, true, (err as Error).message));
    }
    return true;
  }

  return false;
}

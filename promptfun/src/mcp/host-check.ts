import type http from "node:http";
import { hostHeaderValidation } from "@modelcontextprotocol/node";
import { validateHostHeader } from "@modelcontextprotocol/server";

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw.split(",")[0]?.trim();
}

function hostnameOnly(hostHeader: string | null | undefined): string | undefined {
  const result = validateHostHeader(hostHeader, ["__never__"]);
  if (result.ok) return result.hostname;
  if (result.errorCode === "invalid_host" && "hostname" in result) return result.hostname;
  return undefined;
}

/** Public hostnames clients use in Claude (site + apex aliases). */
export function publicSiteHostnames(publicUrl: string): string[] {
  const hostname = new URL(publicUrl).hostname;
  const bare = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  return [...new Set([hostname, bare, `www.${bare}`, "promptfun-fun.vercel.app"])];
}

/** Hostnames on the MCP container that only accept proxied /mcp (not public connector URLs). */
export function internalMcpHostnames(env: NodeJS.ProcessEnv): string[] {
  const fromEnv = (env.PROMPTFUN_INTERNAL_HOSTS || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const vercel = env.VERCEL_URL?.replace(/^https?:\/\//, "").split(":")[0];
  return [...new Set([...(vercel ? [vercel] : []), "promptfun-mcp.vercel.app", ...fromEnv])];
}

/**
 * DNS rebinding guard for /mcp. Allows the public site hostname on direct hits and, when the
 * request arrives on an internal deploy hostname (Vercel MCP), trusts X-Forwarded-Host from
 * the marketing-site proxy (promptfun.fun / promptfun-fun.vercel.app).
 */
export function createMcpHostCheck(publicUrl: string, env: NodeJS.ProcessEnv) {
  const allowedDirect = [...new Set([new URL(publicUrl).hostname, "localhost", "127.0.0.1", "[::1]"])];
  const allowedForwarded = publicSiteHostnames(publicUrl);
  const internalHosts = internalMcpHostnames(env);
  const reject = hostHeaderValidation(allowedDirect);

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (validateHostHeader(req.headers.host, allowedDirect).ok) return true;

    const forwarded = firstHeader(req.headers["x-forwarded-host"]);
    const wireHost = hostnameOnly(req.headers.host);
    if (
      forwarded &&
      wireHost &&
      validateHostHeader(forwarded, allowedForwarded).ok &&
      validateHostHeader(wireHost, internalHosts).ok
    ) {
      return true;
    }

    return reject(req, res);
  };
}

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, toNodeHandler } from "@modelcontextprotocol/node";
import type { Config } from "./config.js";
import { findChain } from "./chains/registry.js";
import { IntentService } from "./intents/service.js";
import { IntentStore } from "./intents/store.js";
import { IntentError } from "./intents/types.js";
import { buildServer } from "./mcp/server.js";
import { intentView } from "./mcp/view.js";
import { approvePage, homePage, notFoundPage, type EvmWalletChain } from "./web/page.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = [path.resolve(here, "../public"), path.resolve(here, "../../public")].find((dir) => fs.existsSync(dir))!;
const STATIC: Record<string, string> = {
  "/static/approve.js": "approve.js",
  "/static/approve.css": "approve.css",
  "/static/fonts/instrument-sans.woff2": "fonts/instrument-sans.woff2",
};
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function headers(res: http.ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.setHeader("Cache-Control", "no-store");
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new IntentError("Send JSON.", "bad_request");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new IntentError("Request too large.", "bad_request");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error();
    return parsed;
  } catch {
    throw new IntentError("Invalid JSON.", "bad_request");
  }
}

export interface App {
  config: Config;
  service: IntentService;
  server: http.Server;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApp(config: Config): App {
  const store = new IntentStore(config.dbPath);
  const service = new IntentService(config, store);
  const mcp = createMcpHandler(() => buildServer(service), { legacy: "stateless" });
  const mcpNode = toNodeHandler(mcp);
  const allowedHosts = [...new Set([new URL(config.publicUrl).hostname, "localhost", "127.0.0.1", "[::1]"])];
  const hostCheck = hostHeaderValidation(allowedHosts);

  const intentPublic = (id: string) => {
    const intent = service.get(id);
    const view = intentView(config, intent, service.approveUrl(id));
    return { ...view, built: intent.built ? { payload: intent.built.payload, extraSigners: intent.built.extraSigners, signer: intent.built.signer } : null };
  };

  const server = http.createServer(async (req, res) => {
    headers(res);
    const url = new URL(req.url || "/", "http://local");
    const pathname = url.pathname;
    try {
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        if (!hostCheck(req, res)) return;
        await mcpNode(req, res);
        return;
      }
      if (pathname.startsWith("/.well-known/oauth")) return json(res, 404, { error: "No OAuth on this server (v1 is no-sign-in)." });

      const apiMatch = /^\/api\/intents\/(int_[a-f0-9]{32})(\/build|\/submit|\/reject)?$/.exec(pathname);
      if (apiMatch) {
        const [, id, action] = apiMatch;
        if (req.method === "GET" && !action) {
          await service.refresh(id).catch(() => undefined);
          return json(res, 200, intentPublic(id));
        }
        if (req.method !== "POST" || !action) return json(res, 405, { error: "Method not allowed." });
        const origin = req.headers.origin;
        if (origin && origin !== new URL(config.publicUrl).origin) return json(res, 403, { error: "Cross-origin requests are not accepted." });
        const body = await readJson(req);
        if (action === "/build") {
          const result = await service.build(id, String(body.account ?? ""), { mint: typeof body.mint === "string" ? body.mint : undefined });
          return json(res, 200, { view: intentView(config, result.intent, service.approveUrl(id)), built: { payload: result.built.payload, extraSigners: result.built.extraSigners } });
        }
        if (action === "/submit") {
          await service.submit(id, String(body.signedTransaction ?? body.transactionHash ?? ""));
          return json(res, 200, intentPublic(id));
        }
        service.walletRejected(id, String(body.reason ?? ""));
        return json(res, 200, intentPublic(id));
      }

      const page = /^\/approve\/(int_[a-f0-9]{32})$/.exec(pathname);
      if (page && req.method === "GET") {
        res.setHeader("Content-Security-Policy", PAGE_CSP);
        res.setHeader("Cache-Control", "no-store");
        let intent;
        try {
          intent = service.get(page[1]);
        } catch {
          return send(res, 404, "text/html; charset=utf-8", notFoundPage());
        }
        const chain = findChain(config, intent.chain);
        const walletChain = chain?.family === "solana" ? chain.walletChain : chain?.family === "evm" ? `eip155:${chain.chainId}` : null;
        const evm: EvmWalletChain | null = chain?.family === "evm"
          ? {
            chainId: `0x${chain.chainId.toString(16)}`,
            chainName: chain.name,
            rpcUrls: [chain.rpcUrl],
            nativeCurrency: { name: chain.nativeSymbol === "ETH" ? "Ether" : chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
            ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
          }
          : null;
        return send(res, 200, "text/html; charset=utf-8", approvePage(intentView(config, intent, service.approveUrl(intent.id)), walletChain, intent.family, evm));
      }

      const file = STATIC[pathname];
      if (file && req.method === "GET") {
        res.setHeader("Cache-Control", "public, max-age=300");
        return send(res, 200, TYPES[path.extname(file)] ?? "application/octet-stream", fs.readFileSync(path.join(PUBLIC_DIR, file)));
      }
      if (pathname === "/" && req.method === "GET") {
        res.setHeader("Content-Security-Policy", PAGE_CSP);
        return send(res, 200, "text/html; charset=utf-8", homePage());
      }
      if (pathname === "/healthz") return json(res, 200, { ok: true });
      res.setHeader("Content-Security-Policy", PAGE_CSP);
      return send(res, 404, "text/html; charset=utf-8", notFoundPage());
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof IntentError) {
        const status = err.code === "not_found" ? 404 : err.code === "bad_request" ? 400 : 422;
        return json(res, status, { error: err.message, code: err.code });
      }
      console.error("[promptfun] request failed:", err);
      return json(res, 500, { error: "Internal error. Nothing was sent." });
    }
  });

  return {
    config,
    service,
    server,
    listen: () =>
      new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : config.port;
          service.startPoller();
          resolve(`http://${config.host}:${port}`);
        });
      }),
    close: async () => {
      service.stopPoller();
      await mcp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      store.close();
    },
  };
}

import http from "node:http";
import type { Config } from "../config.js";
import { createFeePayerSigner } from "./local-signer.js";

export function createSignerHttpServer(config: Config): http.Server {
  const signer = createFeePayerSigner(config);
  return http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method !== "POST" || req.url !== "/sign") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (!signer) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Signer not configured" }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const p = JSON.parse(body);
      const signed = await signer.signSolanaTransaction(String(p.chainKey ?? ""), p.intent, p.built, String(p.unsignedPayloadBase64 ?? ""));
      res.end(JSON.stringify({ signedTransaction: signed, publicKey: signer.publicKey }));
    } catch (e) {
      res.statusCode = 422;
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}

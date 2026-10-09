import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { createApp, type App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

export interface Harness {
  app: App;
  base: string;
  client: Client;
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; data: any; isError: boolean }>;
  close(): Promise<void>;
}

export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "promptfun-"));
  const config = loadConfig({ ...process.env, HOST: "127.0.0.1", PORT: "0", PROMPTFUN_DB: path.join(dir, "db.sqlite"), ...env });
  const app = createApp(config);
  const base = await app.listen();
  config.publicUrl = base;
  const client = new Client({ name: "promptfun-e2e", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return {
    app,
    base,
    client,
    async call(name, args) {
      const result: any = await client.callTool({ name, arguments: args });
      const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
      return { text, data: result.structuredContent, isError: Boolean(result.isError) };
    },
    async close() {
      await client.close().catch(() => undefined);
      await app.close();
    },
  };
}

export function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

async function post(base: string, url: string, body: unknown): Promise<any> {
  const res = await fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { code: data.code, status: res.status });
  return data;
}

/**
 * Plays the user's wallet against the real approval API: the same /build and /submit calls approve.js makes.
 * The key stays in this process, as it would in a wallet. `tamper` lets tests sign something else.
 */
export async function approveWithKeypair(base: string, intentId: string, wallet: Keypair, tamper?: (tx: VersionedTransaction) => VersionedTransaction): Promise<any> {
  const built = await post(base, `/api/intents/${intentId}/build`, { account: wallet.publicKey.toBase58() });
  let tx = VersionedTransaction.deserialize(Buffer.from(built.built.payload, "base64"));
  if (tamper) tx = tamper(tx);
  tx.sign([wallet]);
  const submitted = await post(base, `/api/intents/${intentId}/submit`, { signedTransaction: Buffer.from(tx.serialize()).toString("base64") });
  return { built, submitted };
}

export async function waitForFinal(h: Harness, intentId: string, timeoutMs = 90_000): Promise<{ text: string; data: any }> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await h.call("get_action_status", { intentId });
    if (r.data?.status === "confirmed" || r.data?.status === "failed") return r;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${intentId}: ${r.text}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export { post };

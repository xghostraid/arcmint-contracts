/**
 * Screenshots of the in-chat card, rendered by the MCP Apps reference host from real tool results:
 *   - a launch and a transfer prepared and built on devnet for the demo wallet (live fees, real simulation),
 *   - a transfer whose simulation fails (more SOL than the wallet holds),
 *   - the confirmed receipts from a devnet-demo.ts run (PROMPTFUN_SHOTS_RECEIPTS=<its summary json>),
 *   - an anvil transfer that fails verification because the wallet sent a different value than previewed.
 *
 *   PROMPTFUN_URL=http://127.0.0.1:8787 PROMPTFUN_SHOTS_OUT=/tmp/shots PROMPTFUN_SHOTS_RECEIPTS=/tmp/devnet.json npx tsx scripts/ui-shots.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Keypair } from "@solana/web3.js";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chromium } from "playwright-core";
import { CARD_URI } from "../src/mcp/card.js";
import { installReferenceHost } from "./reference-host.js";

const BASE = process.env.PROMPTFUN_URL || "http://127.0.0.1:8787";
const OUT = process.env.PROMPTFUN_SHOTS_OUT || "/tmp/promptfun-shots";
const RECEIPTS = process.env.PROMPTFUN_SHOTS_RECEIPTS ? JSON.parse(fs.readFileSync(process.env.PROMPTFUN_SHOTS_RECEIPTS, "utf8")) : null;
const KEY = (process.env.PROMPTFUN_DEMO_KEY || "~/.config/promptfun/solana-devnet-demo-wallet.json").replace(/^~/, os.homedir());
// anvil's well-known default dev account 0
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, "utf8"))));
const client = new Client({ name: "promptfun-ui-shots", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result: any = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text}`);
  return { input: args, result };
}
async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${url}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url}: ${data.error}`);
  return data;
}
async function built(prepared: any, account: string): Promise<any> {
  const id = prepared.result.structuredContent.intentId;
  await post(`/api/intents/${id}/build`, { account });
  return { input: prepared.input, result: (await call("get_action_status", { intentId: id })).result };
}

const shots: Array<[string, any]> = [];
const me = wallet.publicKey.toBase58();
const stranger = Keypair.generate().publicKey.toBase58();
const run = Date.now().toString(36);
let n = 0;
const key = () => `shots-${run}-${n++}`;

shots.push(["card-launch-awaiting-wallet", await call("prepare_launch", { chain: "solana-devnet", name: "Moonbeam", symbol: "BEAM", supply: "1000000", idempotencyKey: key() })]);
shots.push(["card-launch-preview", await built(await call("prepare_launch", { chain: "solana-devnet", name: "Moonbeam", symbol: "BEAM", supply: "1000000", idempotencyKey: key() }), me)]);
shots.push(["card-transfer-preview", await built(await call("prepare_transfer", { chain: "solana-devnet", asset: "native", amount: "0.01", to: stranger, idempotencyKey: key() }), me)]);
shots.push(["card-transfer-check-failed", await built(await call("prepare_transfer", { chain: "solana-devnet", asset: "native", amount: "500", to: stranger, idempotencyKey: key() }), me)]);
if (RECEIPTS) {
  for (const [key, name] of [["launch", "card-launch-receipt"], ["tokenTransfer", "card-token-transfer-receipt"], ["solTransfer", "card-sol-transfer-receipt"]] as const) {
    if (RECEIPTS[key]?.intentId) shots.push([name, await call("get_action_status", { intentId: RECEIPTS[key].intentId })]);
  }
}

// A real failure: the wallet that was previewed sends twice the previewed value. The receipt check must catch it.
const a0 = privateKeyToAccount(ANVIL_KEY);
const anvil = await call("prepare_transfer", { chain: "evm-localnet", asset: "native", amount: "0.001", to: "0x000000000000000000000000000000000000dEaD", idempotencyKey: key() });
const anvilId = anvil.result.structuredContent.intentId;
const b = await post(`/api/intents/${anvilId}/build`, { account: a0.address });
const payload = JSON.parse(b.built.payload);
const hash = await createWalletClient({ account: a0, transport: http("http://127.0.0.1:8545") }).sendTransaction({ to: payload.to, value: BigInt(payload.value) * 2n, data: payload.data, chain: null });
await post(`/api/intents/${anvilId}/submit`, { transactionHash: hash });
for (let i = 0; i < 20; i++) {
  const s = await call("get_action_status", { intentId: anvilId });
  if (s.result.structuredContent.status !== "submitted") { shots.push(["card-transfer-failed", s]); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
const resource: any = await client.readResource({ uri: CARD_URI });
const html = resource.contents[0].text;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome", headless: true });
fs.mkdirSync(OUT, { recursive: true });
for (const [name, { input, result }] of shots) {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });
  await installReferenceHost(page, (params) => client.callTool(params),
    `<!doctype html><html><body style="margin:0;background:#f5f4ef;font:13px system-ui"><div id="shot" style="padding:28px 32px 24px;width:700px"><div id="host"></div><p style="margin:14px 0 0;color:#6b6a63">${name.replace(/^card-/, "").replace(/-/g, " ")} · rendered by the MCP Apps reference host from a real tool result</p></div></body></html>`);
  await page.evaluate(([h, i, r]) => (window as any).startHost(h, i, r, { theme: "light" }, 636), [html, input, result] as const);
  await page.waitForFunction(() => (window as any).host.heights.some((x: number) => x > 100));
  await page.waitForTimeout(400);
  await page.locator("#shot").screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}: ${result.structuredContent.status} -> ${path.join(OUT, `${name}.png`)}`);
  await page.close();
}
await browser.close();
await client.close();

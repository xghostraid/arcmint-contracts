/**
 * Real public Solana devnet run, driven through promptfun's MCP tools with the official MCP SDK client, and approved
 * on the real approval page in Chrome with the Wallet Standard demo test wallet.
 *
 *   PROMPTFUN_URL=http://127.0.0.1:8787 PROMPTFUN_DEMO_KEY=~/.config/promptfun/solana-devnet-demo-wallet.json \
 *     npx tsx scripts/devnet-demo.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Keypair } from "@solana/web3.js";
import { chromium, type Page } from "playwright-core";
import { installDemoWallet } from "./demo-wallet.js";

const BASE = process.env.PROMPTFUN_URL || "http://127.0.0.1:8787";
const CHAIN = process.env.PROMPTFUN_DEMO_CHAIN || "solana-devnet";
const KEY = (process.env.PROMPTFUN_DEMO_KEY || "~/.config/promptfun/solana-devnet-demo-wallet.json").replace(/^~/, os.homedir());
const SHOTS = process.env.PROMPTFUN_DEMO_SHOTS || "";
const RECIPIENT = process.env.PROMPTFUN_DEMO_RECIPIENT || "";
const PACE = Number(process.env.PROMPTFUN_DEMO_PACE_MS || 1800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, "utf8"))));
const recipient = RECIPIENT || Keypair.generate().publicKey.toBase58();
const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

const client = new Client({ name: "promptfun-devnet-demo", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
async function call(name: string, args: Record<string, unknown>) {
  log(`MCP tools/call ${name}`, JSON.stringify(args));
  const result: any = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  log(text.split("\n").map((l: string) => `    ${l}`).join("\n"));
  return result.structuredContent;
}

let shot = 0;
async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  shot += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
}

async function approveInBrowser(page: Page, approveUrl: string, label: string) {
  await page.goto(approveUrl);
  await page.locator('button[data-wallet="Demo test wallet"]').waitFor({ timeout: 15_000 });
  await sleep(PACE);
  await snap(page, `${label}-connect`);
  await page.locator('button[data-wallet="Demo test wallet"]').click();
  await page.locator("#preview").waitFor({ state: "visible", timeout: 30_000 });
  await sleep(PACE * 1.5);
  await snap(page, `${label}-preview`);
  await page.locator("#approve").click();
  await page.locator("#demo-wallet-prompt").waitFor({ timeout: 10_000 });
  await sleep(PACE);
  await snap(page, `${label}-wallet-prompt`);
  await page.locator("#demo-wallet-approve").click();
  await page.locator('#status[data-status="confirmed"], #status[data-status="failed"]').waitFor({ timeout: 120_000 });
  await sleep(PACE);
  await snap(page, `${label}-receipt`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: process.env.PROMPTFUN_DEMO_HEADLESS === "1",
  args: ["--window-position=0,0", "--window-size=1280,900", "--no-first-run", "--no-default-browser-check"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();
await installDemoWallet(page, wallet, ["solana:devnet", "solana:localnet"]);

const summary: Record<string, unknown> = { chain: CHAIN, wallet: wallet.publicKey.toBase58(), recipient };
try {
  await call("get_capabilities", {});
  await call("get_balance", { chain: CHAIN, address: wallet.publicKey.toBase58() });

  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  const launch = await call("prepare_launch", {
    chain: CHAIN,
    name: `Demo Coin ${stamp}`,
    symbol: `PFD${stamp}`.slice(0, 10),
    supply: "1000000",
    decimals: 6,
    description: "Devnet demo token launched through promptfun.fun's MCP tools.",
  });
  await approveInBrowser(page, launch.approveUrl, "launch");
  const launched = await call("get_action_status", { intentId: launch.intentId });
  if (launched.status !== "confirmed") throw new Error(`launch ended ${launched.status}`);
  summary.launch = { intentId: launch.intentId, signature: launched.transaction.id, mint: launched.receipt.tokenAddress, explorer: launched.receipt.explorerUrl, tokenExplorer: launched.receipt.tokenExplorerUrl, slot: launched.receipt.slotOrBlock, fee: launched.receipt.fee, verified: launched.receipt.verified };

  const send = await call("prepare_transfer", { chain: CHAIN, asset: launched.receipt.tokenAddress, amount: "25000", to: recipient });
  await approveInBrowser(page, send.approveUrl, "token-transfer");
  const sent = await call("get_action_status", { intentId: send.intentId });
  if (sent.status !== "confirmed") throw new Error(`token transfer ended ${sent.status}`);
  summary.tokenTransfer = { intentId: send.intentId, signature: sent.transaction.id, explorer: sent.receipt.explorerUrl, slot: sent.receipt.slotOrBlock, fee: sent.receipt.fee, verified: sent.receipt.verified };

  const sol = await call("prepare_transfer", { chain: CHAIN, asset: "native", amount: "0.01", to: recipient });
  await approveInBrowser(page, sol.approveUrl, "sol-transfer");
  const solDone = await call("get_action_status", { intentId: sol.intentId });
  if (solDone.status !== "confirmed") throw new Error(`SOL transfer ended ${solDone.status}`);
  summary.solTransfer = { intentId: sol.intentId, signature: solDone.transaction.id, explorer: solDone.receipt.explorerUrl, slot: solDone.receipt.slotOrBlock, fee: solDone.receipt.fee, verified: solDone.receipt.verified };

  await call("get_balance", { chain: CHAIN, address: recipient, token: launched.receipt.tokenAddress });
  summary.ok = true;
} catch (err) {
  summary.ok = false;
  summary.error = (err as Error).message;
  await snap(page, "error").catch(() => undefined);
} finally {
  console.log("SUMMARY " + JSON.stringify(summary, null, 2));
  if (process.env.PROMPTFUN_DEMO_SUMMARY) fs.writeFileSync(process.env.PROMPTFUN_DEMO_SUMMARY, JSON.stringify(summary, null, 2));
  await sleep(PACE * 2);
  await browser.close();
  await client.close();
}

/**
 * EVM run driven through promptfun's MCP tools with the official MCP SDK client, and approved on the real approval
 * page in Chrome with the EIP-6963 demo test wallet. Defaults to a local anvil; a public testnet needs a funded key.
 *
 *   PROMPTFUN_URL=http://127.0.0.1:8787 npx tsx scripts/evm-demo.ts                      # anvil (funds a fresh key)
 *   PROMPTFUN_DEMO_CHAIN=robinhood-testnet PROMPTFUN_DEMO_EVM_KEY=~/.config/promptfun/evm-demo-key \
 *     npx tsx scripts/evm-demo.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createPublicClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chromium, type Page } from "playwright-core";
import { installDemoEvmWallet } from "./demo-evm-wallet.js";

const BASE = process.env.PROMPTFUN_URL || "http://127.0.0.1:8787";
const CHAIN = process.env.PROMPTFUN_DEMO_CHAIN || "evm-localnet";
const KEY_FILE = (process.env.PROMPTFUN_DEMO_EVM_KEY || "").replace(/^~/, os.homedir());
const SHOTS = process.env.PROMPTFUN_DEMO_SHOTS || "";
const PACE = Number(process.env.PROMPTFUN_DEMO_PACE_MS || 1800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

const client = new Client({ name: "promptfun-evm-demo", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
async function call(name: string, args: Record<string, unknown>) {
  log(`MCP tools/call ${name}`, JSON.stringify(args));
  const result: any = await client.callTool({ name, arguments: args });
  const text = (result.content ?? []).map((c: any) => c.text ?? "").join("\n");
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  log(text.split("\n").map((l: string) => `    ${l}`).join("\n"));
  return result.structuredContent;
}

const caps = await call("get_capabilities", {});
const chain = caps.chains.find((c: any) => c.key === CHAIN);
if (!chain?.enabled) throw new Error(`${CHAIN} is not enabled on this server.`);
const rpcUrl = process.env.PROMPTFUN_DEMO_RPC || (CHAIN === "evm-localnet" ? "http://127.0.0.1:8545" : "");
if (!rpcUrl) throw new Error("Set PROMPTFUN_DEMO_RPC to the network's RPC URL for the demo wallet.");

const account = privateKeyToAccount(KEY_FILE ? (fs.readFileSync(KEY_FILE, "utf8").trim() as Hex) : generatePrivateKey());
if (!KEY_FILE) {
  if (CHAIN !== "evm-localnet") throw new Error("Set PROMPTFUN_DEMO_EVM_KEY to a funded key file for public networks.");
  await createPublicClient({ transport: http(rpcUrl) }).request({ method: "anvil_setBalance" as never, params: [account.address, `0x${parseEther("10").toString(16)}`] as never });
}
const recipient = privateKeyToAccount(generatePrivateKey()).address;

let shot = 0;
async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  shot += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
}

async function approveInBrowser(page: Page, approveUrl: string, label: string) {
  const button = page.locator('button[data-wallet="Demo test wallet (EVM)"]');
  await page.goto(approveUrl);
  await button.waitFor({ timeout: 15_000 });
  await sleep(PACE);
  await snap(page, `${label}-connect`);
  await button.click();
  await page.locator("#preview").waitFor({ state: "visible", timeout: 30_000 });
  await sleep(PACE * 1.5);
  await snap(page, `${label}-preview`);
  await page.locator("#approve").click();
  await page.locator("#demo-wallet-prompt").waitFor({ timeout: 10_000 });
  await sleep(PACE);
  await snap(page, `${label}-wallet-prompt`);
  await page.locator("#demo-wallet-approve").click();
  await page.locator('#status[data-status="confirmed"], #status[data-status="failed"]').waitFor({ timeout: 180_000 });
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
await installDemoEvmWallet(page, account, [{ id: chain.chainId, name: chain.name, rpcUrl }]);

const summary: Record<string, unknown> = { chain: CHAIN, wallet: account.address, recipient };
const pick = (s: any) => ({ intentId: s.intentId, hash: s.transaction.id, explorer: s.receipt.explorerUrl, block: s.receipt.slotOrBlock, fee: s.receipt.fee, verified: s.receipt.verified });
try {
  await call("get_balance", { chain: CHAIN, address: account.address });
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  const launch = await call("prepare_launch", { chain: CHAIN, name: `Demo Coin ${stamp}`, symbol: `PFD${stamp}`.slice(0, 10), supply: "1000000" });
  await approveInBrowser(page, launch.approveUrl, "launch");
  const launched = await call("get_action_status", { intentId: launch.intentId });
  if (launched.status !== "confirmed") throw new Error(`launch ended ${launched.status}`);
  summary.launch = { ...pick(launched), token: launched.receipt.tokenAddress, tokenExplorer: launched.receipt.tokenExplorerUrl };

  const send = await call("prepare_transfer", { chain: CHAIN, asset: launched.receipt.tokenAddress, amount: "25000", to: recipient });
  await approveInBrowser(page, send.approveUrl, "token-transfer");
  const sent = await call("get_action_status", { intentId: send.intentId });
  if (sent.status !== "confirmed") throw new Error(`token transfer ended ${sent.status}`);
  summary.tokenTransfer = pick(sent);

  const eth = await call("prepare_transfer", { chain: CHAIN, asset: "native", amount: "0.0001", to: recipient });
  await approveInBrowser(page, eth.approveUrl, "eth-transfer");
  const ethDone = await call("get_action_status", { intentId: eth.intentId });
  if (ethDone.status !== "confirmed") throw new Error(`ETH transfer ended ${ethDone.status}`);
  summary.ethTransfer = pick(ethDone);

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

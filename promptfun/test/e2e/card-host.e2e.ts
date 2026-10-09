/**
 * Hosts the in-chat card in the official MCP Apps host SDK (scripts/reference-host.ts), the way Claude does: a
 * sandboxed iframe speaking the ui/* protocol over postMessage. Tool calls from the card go through the host to the
 * real promptfun MCP server. Needs Chrome (CHROME_PATH, default /usr/local/bin/google-chrome).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { installReferenceHost } from "../../scripts/reference-host.js";
import { CARD_URI } from "../../src/mcp/card.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
let browser: Browser;
let page: Page;

before(async () => {
  h = await startHarness();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome", headless: true });
  page = await browser.newPage();
  await installReferenceHost(page, (params) => h.client.callTool(params));
});

after(async () => {
  await browser?.close();
  await h?.close();
});

test("the card renders a prepared action inside the reference MCP Apps host and drives it", async () => {
  const resource: any = await h.client.readResource({ uri: CARD_URI });
  const [content] = resource.contents;
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.doesNotMatch(content.text, /https?:\/\/(?!www\.w3\.org)[^"' ]+\.(css|svg|woff2)/, "the card loads no remote assets");

  const tools: any = await h.client.listTools();
  const prepare = tools.tools.find((t: any) => t.name === "prepare_transfer");
  assert.equal(prepare._meta.ui.resourceUri, CARD_URI);
  assert.equal(prepare._meta["ui/resourceUri"], CARD_URI);

  const input = { chain: "robinhood-testnet", asset: "native", amount: "0.001", to: "0x0000000000000000000000000000000000000001" };
  const result: any = await h.client.callTool({ name: "prepare_transfer", arguments: input });
  assert.notEqual(result.isError, true);
  const intentId = result.structuredContent.intentId;

  await page.evaluate(([html, i, r]) => (window as any).startHost(html, i, r, { theme: "dark", safeAreaInsets: { top: 0, right: 0, bottom: 16, left: 0 } }), [content.text, input, result] as const);
  const card = page.frameLocator("iframe");
  await card.getByText("Send 0.001 ETH").first().waitFor({ timeout: 10_000 });

  const state = await page.evaluate(() => ({ initialized: (window as any).host.initialized, heights: (window as any).host.heights }));
  assert.equal(state.initialized, true);
  assert.ok(state.heights.some((x: number) => x > 0), "the card reports a non-zero height");
  assert.equal(await card.locator("html").getAttribute("data-theme"), "dark", "the card follows the host's theme");
  assert.equal(await card.locator("body").evaluate((b) => b.style.paddingBottom), "16px", "the card honours safe-area insets");
  assert.equal(await card.locator(".pv-list li").count(), 0, "no steps are shown before the transaction exists");

  await card.getByRole("button", { name: /approve in wallet/i }).click();
  await page.waitForFunction(() => (window as any).host.opened.length > 0);
  const opened = await page.evaluate(() => (window as any).host.opened);
  assert.deepEqual(opened, [`${h.base}/approve/${intentId}`]);

  await card.getByRole("button", { name: /refresh status/i }).click();
  await page.waitForFunction(() => (window as any).host.calls.includes("get_action_status"));
  await card.getByText("Needs your wallet").first().waitFor();
});

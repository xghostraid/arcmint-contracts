import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { handler, resolvePath } from "../server.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const text = html.replace(/<[^>]+>/g, " ");

test("brand is promptfun.fun, never the old placeholder", () => {
  assert.match(html, /<title>promptfun\.fun/);
  assert.doesNotMatch(html, /socket/i);
  const flat = html.replace(/<[^>]+>/g, "");
  assert.doesNotMatch(flat, /promptfun(?!\.fun)/, "the name is always promptfun.fun");
});

test("the site is for ChatGPT and never mentions Claude, anywhere in the folder", async () => {
  // This file has to spell the word it forbids, so it is the one file not scanned.
  const self = fileURLToPath(import.meta.url);
  const files = (await readdir(ROOT, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .filter((f) => f !== self && !f.split(sep).includes("node_modules"));
  assert.ok(files.length >= 8);
  for (const file of files) {
    const body = await readFile(file, "latin1");
    assert.doesNotMatch(body, /claude/i, `"Claude" appears in ${relative(ROOT, file)}`);
  }
  assert.match(html, /<h1[^>]*>Say it in ChatGPT\./);
  assert.match(html, />Connect to ChatGPT</);
});

test("title, meta, alt, aria and caption text name ChatGPT and nothing else", () => {
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  const metas = [...html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/g)].map((m) => m[1]);
  const attrs = [...html.matchAll(/\b(?:alt|aria-label|title)="([^"]*)"/g)].map((m) => m[1]);
  const captions = [...html.matchAll(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/g)].map((m) => m[1]);
  assert.ok(metas.length >= 4 && attrs.length >= 1 && captions.length >= 1);
  for (const value of [title, ...metas, ...attrs, ...captions]) {
    assert.doesNotMatch(value, /claude/i, `"Claude" appears in: ${value}`);
  }
  for (const name of ["description", "og:description"]) {
    const tag = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)="${name}"[^>]*>`));
    assert.ok(tag, `missing meta ${name}`);
    assert.match(tag[0], /ChatGPT/, `meta ${name} should mention ChatGPT`);
  }
  assert.match(title, /ChatGPT/);
  assert.match(html, /aria-label="Connect to ChatGPT"/);
});

test("has every required section", () => {
  for (const id of ["how", "chains", "connect", "safety", "faq"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /class="hero"/);
});

test("every in-page link points at a real section", () => {
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} has no target`);
  }
});

test("every local asset exists", async () => {
  for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) {
    if (path === "/") continue;
    await access(new URL(`.${path}`, `file://${PUBLIC}`));
  }
});

test("no fake transaction hashes, signatures, or addresses", () => {
  assert.doesNotMatch(text, /\b0x[0-9a-fA-F]{8,}\b/, "EVM-looking hash or address");
  assert.doesNotMatch(text, /\b[1-9A-HJ-NP-Za-km-z]{32,}\b/, "base58-looking signature or address");
  assert.doesNotMatch(text, /solscan\.io|etherscan\.io|basescan\.org/i, "explorer link to a made-up transaction");
});

test("chain claims are labelled honestly", () => {
  const chains = html.slice(html.indexOf('id="chains"'), html.indexOf('id="connect"'));
  const items = [...chains.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.ok(items.length >= 3);
  for (const item of items) {
    assert.match(item, /class="status /, `unlabelled capability: ${item}`);
  }
  assert.doesNotMatch(chains, /status[^"]*live|>\s*Live\s*</i, "nothing is marked live yet");
  assert.match(chains, /pump\.fun[\s\S]*Coming soon/);
  assert.match(chains, /EVM chains[\s\S]*Coming next/);
  const evm = chains.slice(chains.indexOf("EVM chains"));
  const order = ["Ethereum", "Robinhood Chain", "Base"].map((name) => evm.indexOf(`</span>${name}</span>`));
  assert.ok(order.every((i) => i > 0), "Ethereum, Robinhood Chain and Base are all listed");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "EVM order is Ethereum, Robinhood Chain, Base");
  assert.match(evm, /Ethereum<\/span><span class="status status-soon">Coming next/);
  assert.match(html, /Not live on mainnet/);
});

test("network fees are dated, sourced, and never a promptfun.fun price", () => {
  const fees = html.slice(html.indexOf('id="fees"'), html.indexOf('class="later"'));
  assert.ok(fees.length > 0, "Network fees block is in the Chains section");
  assert.match(fees, /measured 9 Oct 2026/);
  assert.match(fees, /goes to the network, not to promptfun\.fun/);
  assert.match(fees, /not promptfun\.fun fees/);
  assert.match(fees, /preview shows the estimated fee for your exact transaction before you approve/);
  for (const source of ["etherscan.io/gastracker", "solana.com/docs/core/fees", "solana.com/docs/tokens/extensions/metadata", "pump.fun/docs/fees"]) {
    assert.ok(fees.includes(source), `missing source ${source}`);
  }
  assert.doesNotMatch(html, /metaplex/i, "Solana launches use Token-2022 on-mint metadata, so no Metaplex fee");
  assert.match(fees, /Token-2022/);
  assert.match(fees, /pump\.fun charges nothing to create a coin/);
  for (const chain of ["Solana", "Ethereum", "Robinhood Chain", "Base"]) {
    assert.match(fees, new RegExp(`<th scope="row">${chain}</th>`));
  }
  const flat = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(flat, /promptfun\.fun (fee|charges|costs) (is|of)?\s*\$/i, "no promptfun.fun price");
  assert.doesNotMatch(flat, /waitlist|wait list/i);
});

test("the connector link is not invented before launch", () => {
  assert.match(html, /Posted here at launch/);
  assert.doesNotMatch(text, /https?:\/\/[^\s"]*\/mcp\b/, "no connector URL until it exists");
  assert.match(html, /<button[^>]*disabled>Copy<\/button>/);
});

test("the hero demo is labelled as an illustration", () => {
  assert.match(html, /An illustration of the flow\. Nothing in this picture is a real transaction\./);
});

test("server serves the page with strict headers and refuses traversal", async () => {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  } finally {
    server.close();
  }
  assert.equal(resolvePath("/../server.js"), null);
  assert.equal(resolvePath("/%2e%2e/server.js"), null);
});

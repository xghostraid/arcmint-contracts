import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handler, resolvePath } from "../server.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const text = html.replace(/<[^>]+>/g, " ");

test("brand is promptfun.fun, never the old placeholder", () => {
  assert.match(html, /<title>promptfun\.fun/);
  assert.doesNotMatch(html, /socket/i);
  const flat = html.replace(/<[^>]+>/g, "");
  assert.doesNotMatch(flat, /promptfun(?!\.fun)/, "the name is always promptfun.fun");
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
  assert.match(html, /Not live on mainnet/);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handler, resolvePath } from "../server.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const text = html.replace(/<[^>]+>/g, " ");
const LILAC_BG = "#ebe6ff";
const LEGACY_CREAM = "#fff4e0";
const LEGACY_ORANGE_CTA = "#ff5b3a";

async function listHtmlPages() {
  const files = [];
  for (const entry of await readdir(PUBLIC, { recursive: true })) {
    if (entry.endsWith(".html")) files.push(entry);
  }
  files.sort();
  return files;
}

async function readPublic(rel) {
  return readFile(`${PUBLIC}${rel}`, "utf8");
}

test("brand is promptfun.fun, never the old placeholder", () => {
  assert.match(html, /<title>promptfun\.fun/);
  assert.doesNotMatch(html, /socket/i);
  const flat = html.replace(/<[^>]+>/g, "");
  assert.doesNotMatch(flat, /promptfun(?!\.fun)/, "the name is always promptfun.fun");
});

test("Claude is the main host: in the title, the hero headline and the primary CTA", () => {
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  assert.match(title, /Say it in Claude\./);
  for (const name of ["description", "og:description"]) {
    const tag = html.match(new RegExp(`<meta\\b[^>]*(?:name|property)="${name}"[^>]*>`));
    assert.ok(tag, `missing meta ${name}`);
    assert.match(tag[0], /Claude/, `meta ${name} should mention Claude`);
  }
  const hero = html.match(/<section class="hero"[\s\S]*?<\/section>/)[0];
  assert.match(hero, /<h1[^>]*>Say it in Claude\./);
  const primary = hero.match(/<div class="cta-row">\s*<a class="btn"[^>]*>([^<]*)<\/a>/);
  assert.ok(primary, "the hero needs a primary CTA");
  assert.equal(primary[1], "Add to Claude");
  assert.match(hero, /Works on the Claude Free plan/);
  const navCta = html.match(/<header[\s\S]*?<a class="btn btn-small"[^>]*>([^<]*)<\/a>[\s\S]*?<\/header>/);
  assert.equal(navCta[1], "Add to Claude");
  const closer = html.match(/<section class="[^"]*closer[\s\S]*?<\/section>/)[0];
  assert.match(closer, /<a class="btn"[^>]*>Add to Claude<\/a>/);
});

test("Connect lists the Claude steps as Anthropic documents them", () => {
  const connect = html.match(/<section[^>]*id="connect"[\s\S]*?<\/section>/)[0];
  assert.match(connect, /Customize → Connectors/);
  assert.match(connect, /Add custom connector/);
  assert.match(connect, /approve in your wallet/);
  assert.match(html, /href="https:\/\/support\.claude\.com\/en\/articles\/11175166-[^"]*"/);
});

test("the site is Claude-only: ChatGPT is not mentioned anywhere on the home page", () => {
  assert.doesNotMatch(html, /chatgpt/i);
});

test("every route is Sunny pop lilac inclined (alt), not cream/orange or the old Connect mock", async () => {
  const css = await readPublic("site.css");
  assert.match(css, new RegExp(`--bg:\\s*${LILAC_BG}`, "i"), "site.css must define lilac paper background");
  assert.doesNotMatch(css, new RegExp(LEGACY_CREAM, "i"), "cream #fff4e0 tokens are retired");
  assert.doesNotMatch(css, new RegExp(`--cta:\\s*${LEGACY_ORANGE_CTA}`, "i"), "orange tomato CTA is retired");
  assert.match(css, /--cta:\s*#[0-9a-f]{6}/i, "primary buttons must use a lilac/purple token");
  assert.doesNotMatch(css, /--cta:\s*#ff5b3a/i, "orange tomato CTA is retired");
  assert.match(css, /--done-bar:/, "Done highlight uses a pink bar token, not yellow block");
  assert.match(css, /body\s*\{[\s\S]*background-color:\s*var\(--bg\)/, "body must use lilac paper, not a dark gradient");
  assert.doesNotMatch(css, /body\s*\{[\s\S]*linear-gradient/i, "no full-page gradient on body");
  assert.match(css, /\.demo-shell[\s\S]*rotate\(-6deg\)/, "hero chat mock is inclined ~-6deg");
  assert.match(css, /\.demo-shadow[\s\S]*var\(--pink-shadow\)/, "pink offset layer sits behind the inclined mock");
  assert.doesNotMatch(css, /Connect to Claude/i);

  for (const file of await listHtmlPages()) {
    const page = await readPublic(file);
    const label = file.replace(/\\/g, "/");
    assert.match(page, new RegExp(`<meta name="theme-color" content="${LILAC_BG}">`), `${label} theme-color must be lilac`);
    assert.match(page, /<meta name="color-scheme" content="light">/, `${label} must declare light color-scheme`);
    assert.match(page, /<link rel="stylesheet" href="\/site\.css">/, `${label} must load the Sunny pop stylesheet`);
    assert.doesNotMatch(page, /Connect to Claude/i, `${label} still uses the old Connect mock CTA copy`);
    assert.doesNotMatch(page, /linear-gradient/i, `${label} must not embed inline gradient mocks`);
    assert.doesNotMatch(page, /theme-color" content="#fff4e0"/i, `${label} must not use retired cream theme-color`);
    assert.doesNotMatch(page, /theme-color" content="#(?:0|1[0-9a-f]{5}|17153b)/i, `${label} must not use a dark browser theme color`);
  }

  assert.match(html, /class="demo-shell"/, "home hero uses the inclined demo shell");
  assert.match(html, /card-preview-top[\s\S]*promptfun\.fun preview/, "preview card matches bright-2d alt layout");

  for (const file of (await readdir(PUBLIC, { recursive: true })).filter((f) => f.endsWith(".js"))) {
    const body = await readPublic(file);
    assert.doesNotMatch(body, /Connect to Claude/i, `${file} must not use old CTA copy`);
  }
});

test("has every required section", () => {
  for (const id of ["how", "chains", "connect", "safety", "faq", "prompt-fees"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /class="hero"/);
});

test("how-it-works uses four getplugged-style rows with PROMPT fee tiers", () => {
  const how = html.match(/<section class="section section-flow" id="how"[\s\S]*?<\/section>/)[0];
  assert.match(how, /class="flow-steps"/);
  const rows = [...how.matchAll(/<li class="flow-step[^"]*"[^>]*>/g)];
  assert.equal(rows.length, 4);
  assert.match(how, /You approve every launch\. No tap, no coin\./);
  assert.match(how, /Add your picture\. Upload in chat, then launch\./);
  assert.match(how, /flow-upload-panel/);
  assert.match(how, /Launch on Solana mainnet\. Real tokens/);
  assert.match(how, /70%/);
  assert.match(how, /40%/);
  assert.match(how, /\$PROMPT/);
  assert.match(how, /pump\.fun[\s\S]*creator fees/);
  assert.match(how, /Add Solana wallet at launch/);
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
  const items = [...chains.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.ok(items.length >= 6, `expected network rows in #chains, found ${items.length}`);
  for (const item of items) {
    assert.match(item, /class="status /, `unlabelled capability: ${item}`);
  }
  assert.match(chains, /Launch on pump\.fun \(Solana mainnet\)<\/span><span class="status status-live"[^>]*>Live/);
  assert.match(chains, /Launch with your wallet on Solana devnet<\/span><span class="status status-live"[^>]*>Live · testnet/);
  assert.match(chains, /Robinhood Chain Testnet<\/span><span class="status status-live"[^>]*>Live · testnet/);
  assert.match(chains, /EVM testnets[\s\S]*status-live/);
  const evmMain = chains.slice(chains.indexOf("EVM mainnets"));
  const order = ["Ethereum", "Robinhood Chain", "Base"].map((name) => evmMain.indexOf(`</span>${name}</span>`));
  assert.ok(order.every((i) => i > 0), "Ethereum, Robinhood Chain and Base are all listed");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "EVM order is Ethereum, Robinhood Chain, Base");
  assert.match(evmMain, /Ethereum<\/span><span class="status status-soon"[^>]*>Coming next/);
  assert.match(html, /data-networks-panel/);
  assert.match(html, /\/networks\.js/);
  assert.match(html, /mainnet, devnet &amp; testnets/);
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

test("connect section publishes the MCP URL with copy and Claude deep link", () => {
  const connect = html.match(/<section[^>]*id="connect"[\s\S]*?<\/section>/)[0];
  assert.match(connect, /https:\/\/promptfun\.fun\/mcp/);
  assert.match(connect, /data-mcp-url="https:\/\/promptfun\.fun\/mcp"/);
  assert.match(connect, /data-copy-mcp/);
  assert.doesNotMatch(connect, /Posted here at launch/);
  assert.doesNotMatch(connect, /<button[^>]*disabled>Copy<\/button>/);
  assert.match(
    connect,
    /claude\.ai\/customize\/connectors\?modal=add-custom-connector[^"]*connectorUrl=https%3A%2F%2Fpromptfun\.fun%2Fmcp/,
  );
});

test("the hero demo is labelled as an illustration", () => {
  assert.match(html, /An illustration of the flow\. Nothing in this picture is a real transaction\./);
});

test("the wallet flow is the headline, demo shows Preview then Wallet then Receipt, and unbuilt parts say they're being built", () => {
  assert.match(html, /<h1[^>]*>Say it in Claude\.<br>Approve in your wallet\.<br><em>Done\.<\/em><\/h1>/);
  const demo = html.match(/<figure class="demo"[\s\S]*?<\/figure>/)[0];
  assert.match(demo, /card-preview[\s\S]*promptfun\.fun preview[\s\S]*Approve in your wallet/);
  assert.match(demo, /card-wallet[\s\S]*Your wallet[\s\S]*Approve this action/);
  assert.match(demo, /card-receipt[\s\S]*Receipt[\s\S]*Confirmed onchain/);
  const caption = html.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)[1];
  assert.match(caption, /real SOL/i, "demo caption warns about mainnet funds");

  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>")).replace(/<figure class="demo"[\s\S]*?<\/figure>/, "");
  assert.match(main, /Launch on pump\.fun \(Solana mainnet\)<\/span><span class="status status-live"[^>]*>Live/);
  assert.match(main, /Launch with no wallet \(sponsored, devnet\)<\/span><span class="status status-live"[^>]*>Live · testnet/);
  assert.match(main, /Live on mainnet/);
});

test("Terms, Privacy, Docs and Explore pages exist and stay Claude-only", async () => {
  for (const path of ["/terms/", "/privacy/", "/docs/", "/explore/"]) {
    const page = await readFile(new URL(`../public${path}index.html`, import.meta.url), "utf8");
    assert.match(page, /Claude/i, `${path} should mention Claude`);
    assert.doesNotMatch(page, /chatgpt/i, `${path} must not mention ChatGPT`);
  }
  const explore = await readFile(new URL("../public/explore/index.html", import.meta.url), "utf8");
  assert.match(explore, /data-explore/);
  assert.match(explore, /\/explore\.js/);
  assert.match(explore, /n\/a/, "explore copy explains honest empty values");
  const terms = await readFile(new URL("../public/terms/index.html", import.meta.url), "utf8");
  assert.match(terms, /Draft · not legal advice/);
  const docs = await readFile(new URL("../public/docs/index.html", import.meta.url), "utf8");
  assert.match(docs, /Sixty seconds to set up/);
  assert.match(docs, /Customize → Connectors/);
});

test("home links to Docs, Explore, Terms and Privacy", () => {
  assert.match(html, /href="\/docs"/);
  assert.match(html, /href="\/explore"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /data-live-stats/);
});

const ART = fileURLToPath(new URL("../public/art/", import.meta.url));

test("every image has alt text, and the flat art is decorative and in use", async () => {
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 14);
  for (const img of imgs) {
    assert.match(img, /\balt="[^"]*"/, `missing alt: ${img}`);
    assert.match(img, /\bwidth="\d+" height="\d+"/, `missing size, the layout would shift: ${img}`);
  }
  for (const img of imgs.filter((i) => i.includes('src="/art/'))) {
    assert.match(img, /\balt=""/, `decorative art should have empty alt: ${img}`);
  }
  const files = (await readdir(ART)).filter((f) => f.endsWith(".svg"));
  assert.ok(files.length >= 13);
  for (const file of files) {
    assert.ok(html.includes(`src="/art/${file}"`), `public/art/${file} is not used on the page`);
  }
});

test("every SVG is plain, self-contained and safe under the CSP", async () => {
  const svgs = (await readdir(PUBLIC, { recursive: true })).filter((f) => f.endsWith(".svg"));
  assert.ok(svgs.includes("favicon.svg") && svgs.length >= 14);
  for (const file of svgs) {
    const body = await readFile(`${PUBLIC}${file}`, "utf8");
    assert.match(body, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d. ]+"/, `${file} needs xmlns and viewBox`);
    assert.doesNotMatch(body, /<script|<foreignObject|<image|\son[a-z]+=|\bstyle=|href=|url\(/i, `${file} has scripts, styles or external references`);
  }
});

test("the page works under the strict CSP: no inline styles, scripts or remote assets", async () => {
  const css = await readFile(`${PUBLIC}site.css`, "utf8");
  assert.doesNotMatch(html, /\sstyle=|<style\b|javascript:/i);
  for (const tag of html.match(/<script\b[^>]*>/g)) assert.match(tag, /\bsrc="\/[^"]+"/, `inline script: ${tag}`);
  for (const [, url] of css.matchAll(/url\(([^)]*)\)/g)) assert.match(url, /^"\/fonts\/[\w-]+\.woff2"$/, `CSS loads ${url}`);
  assert.doesNotMatch(css, /@import|https?:/);
  for (const [, url] of html.matchAll(/\s(?:src|href)="([^"#]+)"/g)) {
    assert.ok(url.startsWith("/") || /^https:\/\/[^"]+$/.test(url) && html.includes(`href="${url}" rel="noopener noreferrer"`), `unexpected asset or link: ${url}`);
  }
});

test("text colors meet WCAG AA contrast on the backgrounds they sit on", async () => {
  const css = await readFile(`${PUBLIC}site.css`, "utf8");
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const hex = (name) => {
    let v = vars[name];
    while (v?.startsWith("var(")) v = vars[v.slice(6, -1)];
    assert.match(v ?? "", /^#[0-9a-f]{6}$/i, `--${name} should be a hex color`);
    return v;
  };
  const lum = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const pairs = [
    ["ink", "bg"], ["ink-2", "bg"], ["ink-3", "bg"], ["ink-3", "bg-2"], ["ink-2", "bg-2"],
    ["ink-2", "paper"], ["ink-3", "paper"], ["red-text", "bg"], ["red-text", "paper"],
    ["ink", "done-bar"], ["ink", "green"], ["ink", "pink"], ["ink", "lilac"], ["ink", "blue-soft"],
    ["ink-2", "yellow-soft"], ["ink-3", "yellow-soft"], ["ink-2", "green-soft"], ["ink-2", "blue-soft"], ["ink-2", "pink-soft"],
    ["cta-ink", "cta"], ["band-ink", "band"],
  ];
  for (const [fg, bg] of pairs) {
    assert.ok(ratio(fg, bg) >= 4.5, `--${fg} on --${bg} is ${ratio(fg, bg).toFixed(2)}:1, below 4.5:1`);
  }
});

test("motion stops for people who ask for reduced motion", async () => {
  const css = await readFile(`${PUBLIC}site.css`, "utf8");
  const js = await readFile(`${PUBLIC}site.js`, "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(block.length > 0);
  assert.match(block, /animation: none !important; transition: none !important;/);
  assert.match(block, /scroll-behavior: auto/);
  assert.match(js, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
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
    assert.equal((await fetch(`${base}/explore/`)).status, 200);
    assert.equal((await fetch(`${base}/explore`)).status, 200);
    assert.equal((await fetch(`${base}/docs`)).status, 200);
    assert.equal((await fetch(`${base}/docs/`)).status, 200);
    assert.equal((await fetch(`${base}/terms/`)).status, 200);
    assert.equal((await fetch(`${base}/privacy/`)).status, 200);
    const homeHtml = await (await fetch(`${base}/`)).text();
    assert.match(homeHtml, new RegExp(`theme-color" content="${LILAC_BG}"`));
    assert.doesNotMatch(homeHtml, /Connect to Claude/i);
    assert.match((await fetch(`${base}/site.css`)).headers.get("cache-control"), /must-revalidate/);
    assert.match((await fetch(`${base}/`)).headers.get("cache-control"), /no-cache/);
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  } finally {
    server.close();
  }
  assert.equal(resolvePath("/../server.js"), null);
  assert.equal(resolvePath("/%2e%2e/server.js"), null);
});

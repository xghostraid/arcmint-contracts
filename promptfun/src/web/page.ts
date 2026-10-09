import { BRAND } from "../brand.js";
import type { IntentView } from "../mcp/view.js";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(BRAND)}</title>
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="/static/approve.css">
</head><body><main>${body}</main>
<footer>${esc(BRAND)} never holds your keys. Every fee shown is a network fee; ${esc(BRAND)} charges nothing.</footer>
</body></html>`;
}

export function homePage(): string {
  return layout("Home", `<h1>${esc(BRAND)}</h1><p>Launch tokens and send crypto from a chat, approved in your own wallet.</p><p class="muted">MCP endpoint: <code>/mcp</code></p>`);
}

export function notFoundPage(): string {
  return layout("Not found", `<h1>Not found</h1><p>This approval link does not exist.</p>`);
}

/** Server-rendered summary; /static/approve.js connects the wallet and fills in the exact transaction. */
export function approvePage(view: IntentView, walletChain: string | null, family: string): string {
  const unverified = view.chainStatus === "verified" ? "" : `<p class="warn" id="chain-warning">${view.chainStatus === "gated"
    ? `Real-money network. ${esc(BRAND)} has not verified this path end to end.`
    : `${esc(view.chainName)} is configured but not yet verified end to end by ${esc(BRAND)}.`}</p>`;
  return layout("Approve", `
<header><span class="brand">${esc(BRAND)}</span><span class="pill" id="status" data-status="${esc(view.status)}">${esc(view.status.replace("_", " "))}</span></header>
<h1 id="summary">${esc(view.summary)}</h1>
<p class="muted">${esc(view.chainName)} · status: ${esc(view.chainStatus)} · expires ${esc(new Date(view.expiresAt).toUTCString())}</p>
${unverified}
<section id="app" data-intent="${esc(view.intentId)}" data-family="${esc(family)}" data-wallet-chain="${esc(walletChain ?? "")}">
  <div id="wallets"><h2>1. Connect your wallet</h2><p class="muted" id="wallet-hint">Looking for wallets…</p><div id="wallet-list" class="buttons"></div></div>
  <div id="preview" hidden><h2>2. Review the exact transaction</h2>
    <p class="muted">Decoded from the transaction your wallet will sign:</p><ol id="steps"></ol>
    <p id="simulation"></p>
    <div class="fee" id="fee"></div>
    <div class="buttons"><button id="approve" class="primary">Approve in wallet</button><button id="cancel">Cancel</button></div>
  </div>
  <div id="result" hidden><h2>3. Result</h2><div id="result-body"></div></div>
  <p id="error" class="warn" role="alert"></p>
</section>
<script src="/static/approve.js" defer></script>`);
}

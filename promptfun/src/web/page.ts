import { BRAND } from "../brand.js";
import type { IntentView } from "../mcp/view.js";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ART = "/static/art";

function layout(title: string, body: string, navRight = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(BRAND)}</title>
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="/static/sunny-pop.css">
<link rel="stylesheet" href="/static/approve.css">
</head><body><main>
<div class="deco" aria-hidden="true">
  <img class="mk-star" src="${ART}/star.svg" alt="" width="84" height="84">
  <img class="mk-blob" src="${ART}/blob.svg" alt="" width="140" height="140">
  <img class="mk-squiggle" src="${ART}/squiggle.svg" alt="" width="120" height="40">
  <img class="mk-dot" src="${ART}/dot.svg" alt="" width="34" height="34">
</div>
<header class="ap-nav">
  <span class="brand"><img src="${ART}/brand-mark.svg" alt="" width="32" height="32"><span>promptfun<span class="brand-tld">.fun</span></span></span>
  ${navRight}
</header>
${body}
<p class="page-foot">${esc(BRAND)} never holds your keys. Every fee shown is a network fee; ${esc(BRAND)} charges nothing.</p>
</main></body></html>`;
}

export function homePage(): string {
  return layout("Home", `<div class="plain"><h1>${esc(BRAND)}</h1><p>Launch tokens and send crypto from a chat, approved in your own wallet.</p><p>MCP endpoint: <code>/mcp</code></p></div>`);
}

export function notFoundPage(): string {
  return layout("Not found", `<div class="plain"><h1>Not found</h1><p>This approval link does not exist.</p></div>`);
}

/** Parameters for wallet_addEthereumChain, so the wallet can switch to (or add) the intent's network. */
export interface EvmWalletChain {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls?: string[];
}

function heading(view: IntentView): { kicker: string; title: string; art: string } {
  const p = view.params as unknown as Record<string, string>;
  if (view.kind === "launch_token") return { kicker: "Create a new token", title: `${p.name} · ${p.symbol}`, art: "coin.svg" };
  return { kicker: "Transfer", title: view.summary.replace(/\.$/, ""), art: "step-preview.svg" };
}

/** Server-rendered summary; /static/approve.js connects the wallet and fills in the exact transaction. */
export function approvePage(view: IntentView, walletChain: string | null, family: string, evm: EvmWalletChain | null = null): string {
  const h = heading(view);
  const unverified = view.chainStatus === "verified" ? "" : `<p class="warn-box" id="chain-warning">${view.chainStatus === "gated"
    ? `Real-money network. ${esc(BRAND)} has not verified this path end to end.`
    : `${esc(view.chainName)} is configured but not yet verified end to end by ${esc(BRAND)}.`}</p>`;
  return layout("Approve", `
<ol class="stepper" aria-label="Progress">
  <li class="done"><b>✓</b>Said it</li><li class="sep" aria-hidden="true">→</li>
  <li class="done"><b>✓</b>Preview</li><li class="sep" aria-hidden="true">→</li>
  <li class="now" data-step="approve"><b>3</b>Approve</li><li class="sep" aria-hidden="true">→</li>
  <li data-step="receipt"><b>4</b>Receipt</li>
</ol>
<div class="ap">
  <section>
    <span class="eyebrow">Your own wallet</span>
    <h1>Approve in your own wallet</h1>
    <p class="ap-lede">Check the action, then approve or reject it in your wallet. Nothing is sent until you approve. Afterwards, your chat reads the receipt from the chain.</p>
    ${unverified}
    <article class="pv" aria-label="Transaction preview">
      <div class="pv-top" id="pv-top">
        <img class="pv-art" src="${ART}/${h.art}" alt="" width="56" height="56">
        <div class="pv-head"><span class="card-kicker">${esc(h.kicker)}</span><p class="pv-title" id="summary">${esc(h.title)}</p><p class="pv-sub">On ${esc(view.chainName)}</p></div>
        <span class="card-badge card-badge-wait" id="check-badge">Not checked yet</span>
      </div>
      <div class="pv-section">
        <p class="pv-label">What happens</p>
        <p class="pv-note" id="steps-hint">Connect your wallet. ${esc(BRAND)} then builds the exact transaction, decodes it back into plain steps here, and simulates it.</p>
        <ul class="pv-list" id="steps"></ul>
        <p class="pv-note" id="simulation" hidden></p>
      </div>
      <div class="pv-section">
        <dl class="rows" id="fee">
          <div><dt>Network</dt><dd>${esc(view.chainName)}<span>${view.testnet ? "Test tokens with no real value" : "Real funds"}</span></dd></div>
          <div><dt>Who pays</dt><dd>Your wallet, network fee only</dd></div>
          <div><dt>Estimated network fee</dt><dd><span class="fee-chip" id="fee-amount">Shown after you connect</span></dd></div>
        </dl>
        <p class="fee-basis" id="fee-basis" hidden></p>
      </div>
    </article>
  </section>
  <aside class="wallet-panel" aria-label="Your wallet" id="app" data-intent="${esc(view.intentId)}" data-family="${esc(family)}" data-chain-name="${esc(view.chainName)}" data-wallet-chain="${esc(walletChain ?? "")}"${evm ? ` data-evm="${esc(JSON.stringify(evm))}"` : ""}>
    <div class="wallet-art" aria-hidden="true"><img src="${ART}/wallet.svg" alt="" width="180" height="142"></div>
    <div class="wallet-inner">
      <div id="wallets">
        <p class="wallet-q">Connect your wallet</p>
        <p class="wallet-note" id="wallet-hint">Looking for wallets…</p>
        <div id="wallet-list" class="wallet-list"></div>
      </div>
      <div id="preview" hidden>
        <div class="wallet-who" id="wallet-who"></div>
        <p class="wallet-q">Sign in your wallet</p>
        <p class="wallet-note">Your wallet opens and shows this same transaction. Nothing is sent until you approve it there.</p>
        <div class="wallet-btns"><button type="button" id="approve" class="btn btn-approve">Approve in wallet</button><button type="button" id="cancel" class="btn btn-ghost">Reject</button></div>
      </div>
      <div id="result" hidden><p class="wallet-q" id="result-title"></p><div id="result-body"></div></div>
      <p id="error" class="warn-box" role="alert"></p>
      <p class="wallet-fine">${esc(BRAND)} never sees your keys or seed phrase. After you approve, we read the transaction back from the chain, and your chat shows the receipt.</p>
    </div>
  </aside>
</div>
<script src="/static/approve.js" defer></script>`, `<span class="status" id="status" data-status="${esc(view.status)}">${esc(view.status.replace("_", " "))}</span>`);
}

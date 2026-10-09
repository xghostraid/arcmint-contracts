import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, VERSION } from "../brand.js";

export const CARD_URI = "ui://promptfun/intent-card-v1.html";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = [path.resolve(here, "../../public"), path.resolve(here, "../../../public")].find((dir) => fs.existsSync(dir))!;
const ART = ["coin", "step-preview", "step-receipt", "faq", "check"] as const;

function dataUri(file: string, type: string): string {
  return `data:${type};base64,${fs.readFileSync(path.join(PUBLIC_DIR, file)).toString("base64")}`;
}

/**
 * The card's styles and art are files in public/ (sunny-pop.css, card.css, art/*.svg). The host loads the resource as
 * one HTML document with no network access by default, so they are inlined here: CSS into <style>, SVGs and the font
 * as data: URIs.
 */
function cardAssets(): { css: string; art: Record<string, string> } {
  const art = Object.fromEntries(ART.map((name) => [name, dataUri(`art/${name}.svg`, "image/svg+xml")]));
  const css = ["sunny-pop.css", "card.css"]
    .map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8"))
    .join("\n")
    .replace(/url\("art\/([a-z-]+)\.svg"\)/g, (_, name: string) => `url("${art[name] ?? dataUri(`art/${name}.svg`, "image/svg+xml")}")`)
    .replace(/url\("fonts\/([a-z-]+\.woff2)"\)/g, (_, file: string) => `url("${dataUri(`fonts/${file}`, "font/woff2")}")`);
  return { css, art };
}

let cached: string | null = null;

/**
 * In-chat intent card (MCP Apps standard, so the same HTML runs in any MCP Apps host). It shows the decoded preview,
 * the network fee, status and the chain-read receipt, and opens the approval page in the user's browser. It cannot
 * sign: the sandboxed frame (a native WebView on Claude mobile) has no wallet access.
 */
export function cardHtml(): string {
  if (cached) return cached;
  const { css, art } = cardAssets();
  cached = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head>
<body><div class="wrap" id="root"><div class="skeleton" aria-label="Loading"></div></div>
<script>
(function(){
  var ART = ${JSON.stringify(art)};
  var nextId = 1, pending = {}, view = null;
  function post(m){ window.parent.postMessage(m, "*"); }
  function request(method, params){ var id = nextId++; post({jsonrpc:"2.0", id:id, method:method, params:params}); return new Promise(function(res, rej){ pending[id] = {res:res, rej:rej}; }); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]; }); }
  function open(url){
    request("ui/open-link", {url:url}).catch(function(){ if (window.openai && window.openai.openExternal) window.openai.openExternal({href:url, redirectUrl:false}); });
  }
  var BADGES = {
    awaiting_wallet: ["Needs your wallet", "wait"], awaiting_confirm: ["Ready to launch", ""], submitted: ["Sent", "wait"], confirmed: ["Confirmed onchain", "ok"],
    failed: ["Failed", "bad"], expired: ["Expired", "wait"]
  };
  var CHAIN_CHIPS = { verified: ["Verified end to end", "status-ok"], configured: ["Not yet verified", "status-testing"], gated: ["Real money, not verified", "status-building"] };
  function row(label, value){ return '<div><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>'; }
  function render(v){
    if (!v || !v.intentId) return;
    view = v;
    var p = v.preview, r = v.receipt, s = v.status, launch = v.kind === "launch_token", params = v.params || {};
    var done = s === "confirmed" || s === "failed";
    var badge = s === "built" ? (p && p.simulationOk ? ["Checked", ""] : ["Check failed", "bad"]) : BADGES[s] || [s, "wait"];
    var tone = s === "confirmed" ? " is-ok" : s === "failed" ? " is-bad" : s === "expired" ? " is-idle" : "";
    var art = s === "confirmed" ? ART["step-receipt"] : s === "failed" || s === "expired" ? ART.faq : launch ? ART.coin : ART["step-preview"];
    var title = launch ? (s === "confirmed" ? params.name + " (" + params.symbol + ") is live" : "Create a new token") : (s === "confirmed" ? "Sent" : "Send");
    var sub = launch ? params.name + " · " + params.symbol + " on " + v.chainName : v.summary.replace(/\\.$/, "");
    var h = '<article class="pv" aria-label="' + (done ? "Receipt" : "Transaction preview") + '">';
    h += '<div class="pv-top' + tone + '"><img class="pv-art" src="' + art + '" alt="" width="56" height="56"><div class="pv-head">';
    h += '<span class="card-kicker">' + (done ? "Receipt" : "${BRAND} preview") + '</span><p class="pv-title">' + esc(title) + '</p><p class="pv-sub">' + esc(sub) + '</p></div>';
    h += '<span class="card-badge' + (badge[1] ? " card-badge-" + badge[1] : "") + '">' + esc(badge[0]) + '</span></div>';

    h += '<div class="pv-section">';
    if (r) {
      h += '<p class="pv-label">' + (r.status === "success" ? "Read back from the chain" : "What the chain shows") + '</p>';
      h += '<ul class="pv-list' + (r.status === "success" ? "" : " is-plain") + '">' + r.verified.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';
    } else if (p) {
      h += '<p class="pv-label">What happens</p><ul class="pv-list">' + p.steps.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';
      if (!p.simulationOk) h += '<p class="warn-box">Simulation failed: ' + esc(p.simulationError) + '</p>';
    } else if (s === "submitted") {
      h += '<p class="pv-note">Signed by your wallet and sent. ${BRAND} is reading it back from the chain.</p>';
    } else if (s === "expired") {
      h += '<p class="pv-note">Expired before approval. Nothing was sent.</p>';
    } else {
      h += '<p class="pv-label">What happens</p><p class="pv-note">' + esc(v.summary) + ' The exact transaction, decoded into plain steps, and its network fee appear when you connect your wallet on the approval page.</p>';
    }
    if (v.error && s !== "confirmed" && !(r && r.verified.indexOf(v.error) >= 0)) h += '<p class="warn-box">' + esc(v.error) + '</p>';
    h += '</div>';

    var chip = CHAIN_CHIPS[v.chainStatus];
    var rows = row("Network", esc(v.chainName) + '<span>' + (v.testnet ? "Test tokens with no real value" : "Real funds") + '</span>');
    if (chip) rows += row("Checked by ${BRAND}", '<span class="status ' + chip[1] + '">' + chip[0] + '</span>');
    if (r) {
      rows += row("Network fee paid", '<span class="fee-chip">' + esc(r.fee) + ' ' + esc(r.feeSymbol) + '</span>');
      rows += row("Block / slot", esc(r.slotOrBlock));
      if (r.tokenAddress) rows += row("Token", '<code>' + esc(r.tokenAddress) + '</code>');
    } else {
      rows += row("Who pays", v.sponsorPaysFee ? "promptfun.fun (you pay nothing)" : "Your wallet, network fee only");
      rows += row("Estimated network fee", p
        ? '<span class="fee-chip">' + esc(p.networkFee) + ' ' + esc(p.symbol) + '</span>' + (p.deposits !== "0" ? '<span>plus ' + esc(p.deposits) + ' ' + esc(p.symbol) + ' rent deposits</span>' : '') + (p.usd ? '<span>≈ $' + esc(p.usd) + '</span>' : '')
        : 'Shown when you connect<span>Read live from the network</span>');
    }
    rows += row("${BRAND} fee", "None");
    h += '<div class="pv-section"><dl class="rows">' + rows + '</dl></div>';

    h += '<div class="pv-actions">';
    if (s === "awaiting_confirm" && v.sponsoredPreview) h += '<button class="btn btn-main" data-confirm="1">Launch it</button>';
    if (s === "awaiting_wallet" || s === "built") h += '<button class="btn btn-main" data-open="' + esc(v.approveUrl) + '">Review &amp; approve in wallet</button>';
    if (v.transaction && v.transaction.explorerUrl) h += '<button class="btn btn-ghost btn-small" data-open="' + esc(v.transaction.explorerUrl) + '">View transaction</button>';
    if (r && r.tokenExplorerUrl) h += '<button class="btn btn-ghost btn-small" data-open="' + esc(r.tokenExplorerUrl) + '">View token</button>';
    if (!done && s !== "expired") h += '<button class="btn btn-ghost" data-refresh="1">Refresh status</button>';
    if (s === "awaiting_wallet" || s === "built") h += '<p class="pv-alt">Your chat app may ask you to confirm opening ' + esc(v.approveUrl.split("/approve/")[0]) + '.</p>';
    h += '<p class="pv-foot">' + (done ? "Read from the chain, not assumed." : "Read from the transaction itself. Nothing moves until you approve in your own wallet. ${BRAND} never holds your keys.") + '</p>';
    h += '</div></article>';
    document.getElementById("root").innerHTML = h;
    post({jsonrpc:"2.0", method:"ui/notifications/size-changed", params:{height:document.documentElement.scrollHeight}});
  }
  document.addEventListener("click", function(e){
    var t = e.target.closest("button"); if (!t) return;
    if (t.dataset.open) open(t.dataset.open);
    if (t.dataset.confirm && view) request("tools/call", {name:"confirm_launch", arguments:{intentId:view.intentId}}).then(function(r){ render(r && r.structuredContent); }).catch(function(){});
    if (t.dataset.refresh && view) request("tools/call", {name:"get_action_status", arguments:{intentId:view.intentId}}).then(function(r){ render(r && r.structuredContent); });
  });
  window.addEventListener("message", function(e){
    var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && !m.method) { var q = pending[m.id]; delete pending[m.id]; m.error ? q.rej(m.error) : q.res(m.result); return; }
    if (m.method === "ui/notifications/tool-result") render(m.params && m.params.structuredContent);
    if (m.method === "ui/notifications/host-context-changed") applyHost(m.params);
  });
  function applyHost(ctx){
    if (!ctx) return;
    if (ctx.theme === "light" || ctx.theme === "dark") document.documentElement.setAttribute("data-theme", ctx.theme);
    var s = ctx.safeAreaInsets;
    if (s) document.body.style.padding = [s.top, s.right, s.bottom, s.left].map(function(n){ return (Number(n) || 0) + "px"; }).join(" ");
    if (view) render(view);
  }
  request("ui/initialize", {protocolVersion:"2026-01-26", appInfo:{name:"${BRAND}", version:"${VERSION}"}, appCapabilities:{availableDisplayModes:["inline"]}})
    .then(function(r){ applyHost(r && r.hostContext); post({jsonrpc:"2.0", method:"ui/notifications/initialized", params:{}}); })
    .catch(function(){});
  if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
})();
</script></body></html>`;
  return cached;
}

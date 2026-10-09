import { BRAND, VERSION } from "../brand.js";

export const CARD_URI = "ui://promptfun/intent-card-v1.html";

/**
 * In-chat intent card (MCP Apps standard; ChatGPT primary). It shows the decoded preview, the network fee,
 * and status, and opens the approval page in the user's browser. It cannot sign: the iframe has no wallet access.
 */
export function cardHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--fg:#141414;--muted:#5f5f5f;--line:#e4e4e4;--bg:#fff;--accent:#0f5cff;--ok:#0a7a3d;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--fg:#f2f2f2;--muted:#a3a3a3;--line:#2c2c2c;--bg:#161616;--accent:#6e9bff;--ok:#4cc38a;--bad:#ff7b6b}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
.card{padding:14px 16px}.top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
h1{font-size:15px;margin:0}.pill{font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap}
.pill.confirmed{color:var(--ok);border-color:var(--ok)}.pill.failed,.pill.expired{color:var(--bad);border-color:var(--bad)}
p{margin:6px 0}.muted{color:var(--muted)}ul{margin:6px 0;padding-left:18px}li{margin:2px 0}
.fee{border-top:1px solid var(--line);margin-top:8px;padding-top:8px}.warn{color:var(--bad)}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}button{font:inherit;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}a{color:var(--accent)}code{font-size:12px;word-break:break-all}
</style></head>
<body><div class="card" id="root"><p class="muted">Loading…</p></div>
<script>
(function(){
  var nextId = 1, pending = {}, view = null;
  function post(m){ window.parent.postMessage(m, "*"); }
  function request(method, params){ var id = nextId++; post({jsonrpc:"2.0", id:id, method:method, params:params}); return new Promise(function(res, rej){ pending[id] = {res:res, rej:rej}; }); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]; }); }
  function open(url){
    request("ui/open-link", {url:url}).catch(function(){ if (window.openai && window.openai.openExternal) window.openai.openExternal({href:url, redirectUrl:false}); });
  }
  function render(v){
    if (!v || !v.intentId) return;
    view = v;
    var h = '<div class="top"><h1>' + esc(v.summary) + '</h1><span class="pill ' + esc(v.status) + '">' + esc(v.status.replace("_"," ")) + '</span></div>';
    h += '<p class="muted">' + esc(v.chainName) + ' · ' + esc(v.chainStatus) + '</p>';
    if (v.chainStatus !== "verified") h += '<p class="warn">' + (v.chainStatus === "gated" ? "Real-money network. Not verified end to end by ${BRAND}." : "Configured, not yet verified end to end.") + '</p>';
    var p = v.preview;
    if (p) {
      h += '<ul>' + p.steps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join("") + '</ul>';
      h += '<p>' + (p.simulationOk ? "Simulation passed." : '<span class="warn">Simulation failed: ' + esc(p.simulationError) + '</span>') + '</p>';
      h += '<div class="fee"><strong>' + esc(p.feeLabel) + '</strong><br>' + esc(p.networkFee) + ' ' + esc(p.symbol) + ' fee' + (p.deposits !== "0" ? ' + ' + esc(p.deposits) + ' ' + esc(p.symbol) + ' rent deposits' : '') + (p.usd ? ' (≈ $' + esc(p.usd) + ')' : '') + '<br><span class="muted">promptfun fee: none</span></div>';
    } else if (v.status === "awaiting_wallet") {
      h += '<p class="muted">The exact transaction, network fee and simulation appear when you connect your wallet on the approval page.</p>';
    }
    if (v.receipt) {
      h += '<ul>' + v.receipt.verified.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join("") + '</ul>';
      if (v.receipt.tokenAddress) h += '<p>Token <code>' + esc(v.receipt.tokenAddress) + '</code></p>';
    }
    if (v.error) h += '<p class="warn">' + esc(v.error) + '</p>';
    h += '<div class="row">';
    if (v.status === "awaiting_wallet" || v.status === "built") h += '<button class="primary" data-open="' + esc(v.approveUrl) + '">Review &amp; approve in wallet</button>';
    if (v.transaction && v.transaction.explorerUrl) h += '<button data-open="' + esc(v.transaction.explorerUrl) + '">View transaction</button>';
    if (v.receipt && v.receipt.tokenExplorerUrl) h += '<button data-open="' + esc(v.receipt.tokenExplorerUrl) + '">View token</button>';
    if (v.status !== "confirmed" && v.status !== "failed" && v.status !== "expired") h += '<button data-refresh="1">Refresh status</button>';
    h += '</div><p class="muted">Nothing moves until you approve in your own wallet. ${BRAND} never holds your keys.</p>';
    document.getElementById("root").innerHTML = h;
    var height = document.documentElement.scrollHeight;
    post({jsonrpc:"2.0", method:"ui/notifications/size-changed", params:{height:height}});
  }
  document.addEventListener("click", function(e){
    var t = e.target.closest("button"); if (!t) return;
    if (t.dataset.open) open(t.dataset.open);
    if (t.dataset.refresh && view) request("tools/call", {name:"get_action_status", arguments:{intentId:view.intentId}}).then(function(r){ render(r && r.structuredContent); });
  });
  window.addEventListener("message", function(e){
    var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && !m.method) { var p = pending[m.id]; delete pending[m.id]; m.error ? p.rej(m.error) : p.res(m.result); return; }
    if (m.method === "ui/notifications/tool-result") render(m.params && m.params.structuredContent);
  });
  request("ui/initialize", {protocolVersion:"2026-01-26", appInfo:{name:"${BRAND}", version:"${VERSION}"}, appCapabilities:{}})
    .then(function(){ post({jsonrpc:"2.0", method:"ui/notifications/initialized", params:{}}); })
    .catch(function(){});
  if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
})();
</script></body></html>`;
}

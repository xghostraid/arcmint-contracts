import type { Config } from "../config.js";
import { esc } from "./page.js";
import type { ClaimWalletView } from "../wallets/types.js";

function claimLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · promptfun</title>
<link rel="stylesheet" href="/static/sunny-pop.css">
<link rel="stylesheet" href="/static/approve.css">
<style>.claim{max-width:32rem;margin:2rem auto;padding:0 1rem}.claim input,.claim button{width:100%;box-sizing:border-box;padding:.75rem;margin:.5rem 0;font-size:1rem}.claim button{background:#9b7bff;color:#fff;border:none;border-radius:.5rem;cursor:pointer}.mono{font-family:ui-monospace,monospace;word-break:break-all}.err{color:#b00020}</style>
</head><body><main class="claim">${body}</main></body></html>`;
}

export function claimHomePage(config: Config, privyReady: boolean, error?: string): string {
  const err = error ? `<p class="err">${esc(error)}</p>` : "";
  const note = privyReady
    ? "<p>Enter the same email you use to sign in to Claude. We will create or look up your user-owned Solana wallet for locked creator fees.</p>"
    : "<p>Claim wallets are not configured on this server (Privy credentials missing).</p>";
  return claimLayout("Claim wallet", `
<h1>Claim your creator wallet</h1>
${note}
${err}
<form method="post" action="/claim">
<label>Email <input type="email" name="email" required autocomplete="email"></label>
<button type="submit">Send claim link</button>
</form>
<p class="mono">Or open this page after signing in via MCP OAuth: <code>${esc(config.publicUrl)}/api/claim/wallet</code></p>`);
}

export function claimSentPage(link: string, expose: boolean): string {
  const dev = expose ? `<p><a href="${esc(link)}">Open claim link</a> (dev only)</p>` : "";
  return claimLayout("Check your email", `
<h1>Check your email</h1>
<p>If an account exists for that address, we sent a link to reveal your Solana payout wallet. It expires in 15 minutes.</p>
${dev}`);
}

export function claimDonePage(view: ClaimWalletView): string {
  return claimLayout("Your wallet", `
<h1>Your Solana payout wallet</h1>
<p>Creator fees from sponsored pump.fun launches lock to this address. You control it through Privy (embedded, user-owned).</p>
<dl>
<dt>Email</dt><dd>${esc(view.email)}</dd>
<dt>Solana address</dt><dd class="mono">${esc(view.solanaAddress)}</dd>
</dl>
<p>Export or manage this wallet in the Privy app flow for your email. See <code>docs/custody.md</code> on the server for custody details.</p>`);
}

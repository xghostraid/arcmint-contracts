import { DASH, formatCap, formatSol } from "../public/format.js";
import { esc } from "./html.js";
import { PAYOUT_MIN_SOL } from "./payout.js";
import { SPLIT_LINE } from "../shared/copy.js";

export const LIVE_CARD_URI = "ui://socket/live-card.html";

function absolute(origin, src) {
  if (!src) return "";
  if (src.startsWith("/")) return `${origin}${src}`;
  return src;
}

export function renderLiveCard(origin, coin) {
  const safeOrigin = JSON.stringify(origin);
  const body = coin ? liveBody(origin, coin) : emptyBody();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live card</title>
<style>
  @font-face { font-family: "Instrument Sans"; font-style: normal; font-weight: 400 700; font-display: swap; src: url("${origin}/assets/fonts/instrument-sans.woff2") format("woff2"); }
  @font-face { font-family: "Instrument Sans"; font-style: italic; font-weight: 400 700; font-display: swap; src: url("${origin}/assets/fonts/instrument-sans-italic.woff2") format("woff2"); }
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #07080c; color: #e7e2d6; font-family: "Instrument Sans", "Helvetica Neue", sans-serif; }
  .card { width: min(560px, 100%); margin: 0 auto; padding: 18px 16px 28px; background: rgba(16, 19, 24, 0.92); border: 1px solid rgba(186, 196, 206, 0.34); }
  .kicker, .ca-label, .paid-label, .cap { font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(231, 226, 214, 0.72); }
  h1 { margin: 4px 0 14px; font-weight: 560; font-size: 48px; line-height: 0.92; letter-spacing: -0.045em; color: #f3ecdf; }
  h1 em { font-style: italic; font-weight: 480; }
  .face { display: block; width: 100%; aspect-ratio: 1; max-height: 360px; object-fit: cover; border: 1px solid rgba(186, 196, 206, 0.34); background: #101318; }
  .ca-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .ca { flex: 1; margin: 0; padding: 12px 14px; border: 1px solid rgba(186, 196, 206, 0.34); background: #07080c; color: #f3ecdf; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
  button { flex: 0 0 auto; border: 1px solid #a7b0b8; border-bottom-color: #050607; background: #161a20; color: #f3ecdf; padding: 12px 16px; font: 600 12px/1 "Instrument Sans", sans-serif; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
  .pump { display: inline-block; margin-top: 14px; color: #f3ecdf; letter-spacing: 0.08em; text-transform: uppercase; font-size: 13px; }
  .paid-label { margin: 18px 0 0; }
  .paid { margin: 4px 0 0; color: #f3ecdf; font-size: 40px; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
  .pending { margin: 6px 0 0; color: rgba(231, 226, 214, 0.72); font-size: 14px; font-variant-numeric: tabular-nums; }
  .cap, .lock { margin: 12px 0 0; }
  .lock { max-width: 46ch; color: rgba(231, 226, 214, 0.78); font-size: 14px; line-height: 1.45; }
  .fee { display: flex; height: 3px; margin-top: 16px; background: #1a1e24; }
  .fee-you { width: 50%; background: #f3ecdf; }
  .fee-them { width: 50%; background: #3a424c; }
  .fee-key { display: flex; justify-content: space-between; margin: 8px 0 0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(231, 226, 214, 0.72); }
</style>
</head>
<body>
<main class="card">
${body}
</main>
<script>
const ORIGIN = ${safeOrigin};
const button = document.querySelector("#copy");
const ca = document.querySelector("#ca");
if (button && ca) {
  button.addEventListener("click", async () => {
    const text = ca.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(ca);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    button.textContent = "Copied";
  });
}
</script>
</body>
</html>`;
}

function emptyBody() {
  return `  <p class="kicker">Live</p>
  <h1>No coin <em>yet</em></h1>
  <p class="lock">Launches are paused.</p>`;
}

function liveBody(origin, coin) {
  const paid = formatSol(coin.paidToCreatorSol);
  const pending = formatSol(coin.pendingFeeSol);
  const cap = formatCap(coin);
  const href = `https://pump.fun/coin/${coin.mint}`;
  const capLine = cap === DASH
    ? ""
    : `  <p class="cap">Market cap ${esc(cap)}</p>\n`;
  return `  <p class="kicker">Live</p>
  <h1>${esc(coin.name)}</h1>
  <img class="face" src="${esc(absolute(origin, coin.image))}" alt="${esc(coin.name)}">
  <p class="ca-label">Contract</p>
  <div class="ca-row">
    <p class="ca" id="ca">${esc(coin.mint)}</p>
    <button type="button" id="copy">Copy</button>
  </div>
  <a class="pump" href="${esc(href)}">pump.fun</a>
  <p class="paid-label">paid to your wallet</p>
  <p class="paid">${esc(paid)} SOL</p>
  <p class="pending">${esc(pending)} SOL detected, not yet pushed. Payout fires at ${esc(formatSol(PAYOUT_MIN_SOL))} SOL.</p>
${capLine}  <div class="fee" aria-hidden="true"><span class="fee-you"></span><span class="fee-them"></span></div>
  <p class="fee-key"><span>You 50%</span><span>Recipient 50%</span></p>
  <p class="lock">${esc(SPLIT_LINE)}</p>`;
}

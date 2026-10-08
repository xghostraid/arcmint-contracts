import { safeImage, showVolume } from "../public/board.js";
import {
  DASH,
  formatAge,
  formatCap,
  formatPct,
  formatSol,
  formatTokens,
  formatWhen,
  pctClass,
  shorten,
} from "../public/format.js";
import { CHATGPT_PATH, RESERVE_RULE, SPLIT_LINE, TOAST_TEXT } from "../shared/copy.js";

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nav(page, status, linked = false) {
  const line = status.display.marquee;
  const on = status.launchesOn;
  const floor = page === "floor" ? ` aria-current="page"` : "";
  const burns = page === "burns" ? ` aria-current="page"` : "";
  const homeLink = linked ? ` data-view-link="home"` : "";
  const floorLink = linked ? ` data-view-link="floor"` : "";
  const burnsLink = linked ? ` data-view-link="burns"` : "";
  return `<header class="nav">
    <a class="brand" href="/"${homeLink} data-led title="${on ? "Launches on" : "Launches paused"}">Socket</a>
    <p class="status-line" data-status-line>${esc(line)}</p>
    <nav class="nav-links" aria-label="Pages">
      <a href="/floor"${floor}${floorLink}>Floor</a>
      <a href="/burns"${burns}${burnsLink}>Burns</a>
    </nav>
  </header>`;
}

function shell({ status, title, page, main, scene = false }) {
  const view = page === "floor" || page === "burns" ? page : "home";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="Socket is a private ChatGPT connector for pump.fun.">
<meta name="theme-color" content="#07080c">
<title>${esc(title)}</title>
<link rel="icon" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body class="${scene ? "chamber" : esc(page)}" data-page="${esc(page)}"${scene ? ` data-view="${view}" data-focus="${view}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
${scene ? `<canvas id="chamber"></canvas><img class="still" src="/assets/chamber-still.png" alt="Machined socket" hidden>` : ""}
${scene ? "" : nav(page, status)}
${main}
<div class="toast" role="status" hidden>${esc(TOAST_TEXT)}</div>
<script type="module" src="/assets/site.js"></script>
</body>
</html>`;
}

function sigLink(sig) {
  if (!sig) return esc(DASH);
  if (!SIG.test(sig)) return esc(sig);
  const href = `https://solscan.io/tx/${sig}`;
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(shorten(sig, 6, 6))}</a>`;
}

function figure(label, value, attrs, sub = "") {
  const pause = sub
    ? `<p class="figure-sub" data-pause>${esc(sub)}</p>`
    : `<p class="figure-sub"${attrs.includes("data-left") ? " data-pause" : ""}></p>`;
  return `<article class="figure">
    <p class="figure-label">${esc(label)}</p>
    <p class="figure-num" ${attrs} data-value="${esc(value)}">${esc(value)}</p>
    ${pause}
  </article>`;
}

function seed(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderChamber({ status, title, page, mcpUrl, coins = [], burns = [] }) {
  const pause = status.launchesOn ? "" : "Paused";
  const vol = showVolume(coins);
  const volHead = `<th data-vol${vol ? "" : " hidden"}>24h volume</th>`;
  const burnBody = burns.length
    ? `<div class="tape-head"><span>When</span><span>SOL</span><span>Tokens</span><span>Burn</span></div>
      ${burns.map((burn) => `<div class="tape-row">
        <span>${esc(formatWhen(burn.at))}</span>
        <span>${esc(formatSol(burn.sol))}</span>
        <span>${esc(formatTokens(burn.tokens))}</span>
        <span>${sigLink(burn.burnSig)}</span>
      </div>`).join("")}`
    : `<p class="space-line">No burns yet.</p>`;
  const main = `${nav(page, status, true)}
<div class="hud" id="main">
  <section class="plate plate-hero" data-room="home" data-anchor="hero">
    <p class="kicker">Private connector</p>
    <h1>From the chat<br>to the curve.</h1>
    <div class="url-row">
      <div class="slot" id="mcp-url" data-mcp-url="${esc(mcpUrl)}">${esc(mcpUrl)}</div>
      <button class="copy" type="button" aria-describedby="chatgpt-path">Copy</button>
    </div>
    <p class="path" id="chatgpt-path">${esc(CHATGPT_PATH)}</p>
    <p class="split-line">${esc(SPLIT_LINE)}</p>
    <a class="floor-link" href="/floor" data-view-link="floor">See the floor</a>
  </section>
  <section class="plate plate-stat" data-room="home" data-anchor="left">
    ${figure("Left today", status.display.leftToday, "data-left", pause)}
  </section>
  <section class="plate plate-stat" data-room="home" data-anchor="paid">
    ${figure("Sol paid", status.display.paid, "data-paid")}
  </section>
  <section class="plate plate-stat" data-room="home" data-anchor="burned">
    ${figure("Burned", status.display.burned, "data-burned")}
  </section>
  <section class="plate plate-floor${coins.length ? "" : " is-empty"}" data-room="floor" data-anchor="floor">
    <div class="tools">
      <label class="srch">
        <span class="sr-only">Search coins</span>
        <input class="search" type="search" placeholder="Name, ticker, or mint" autocomplete="off" spellcheck="false">
      </label>
      <div class="chips" role="group" aria-label="Sort">
        <button type="button" class="chip" data-sort="top" aria-pressed="false">Top</button>
        <button type="button" class="chip" data-sort="new" aria-pressed="true">New</button>
        <button type="button" class="chip" data-sort="paid" aria-pressed="false">Most paid</button>
      </div>
    </div>
    <p class="space-line" data-empty-line${coins.length ? " hidden" : ""}>${coins.length ? "" : "The floor is clear."}</p>
    <p class="count" data-count>${coins.length} live</p>
    <div class="board-scroll">
      <table class="board">
        <caption class="sr-only">Live coins</caption>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Market cap</th>
            <th>Since launch</th>
            ${volHead}
            <th>Paid to creator</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody data-rows>
          ${boardRows(coins, vol)}
        </tbody>
      </table>
    </div>
    <p class="board-note">Refreshes every 30 seconds. Volume stays off this board until a figure exists.</p>
  </section>
  <section class="plate plate-burns" data-room="burns" data-anchor="burns">
    <div class="tape">${burnBody}</div>
    <p class="tape-foot">${esc(RESERVE_RULE)}</p>
  </section>
</div>
<script type="application/json" id="coin-seed">${seed(coins.map((coin) => ({ mint: coin.mint, name: coin.name, ticker: coin.ticker })))}</script>`;
  return shell({ status, title, page, main, scene: true });
}

export function renderHome(props) {
  return renderChamber({ ...props, title: "Socket", page: "home" });
}

function boardRows(coins, vol) {
  if (coins.length === 0) {
    return `<tr class="empty-row"><td colspan="${vol ? 6 : 5}"><span class="empty-line">The floor is clear.</span><span class="hint">No live coins yet.</span></td></tr>`;
  }
  return coins.map((coin) => {
    const href = `/coin/${encodeURIComponent(coin.mint)}`;
    const src = safeImage(coin.image);
    const face = src
      ? `<span class="mini-face"><img alt="" src="${esc(src)}"></span>`
      : `<span class="mini-face"></span>`;
    const since = pctClass(coin.sinceLaunchPct);
    const volume = vol
      ? `<td class="num" data-vol>${coin.volume24hUsd == null ? DASH : esc(String(coin.volume24hUsd))}</td>`
      : "";
    return `<tr>
      <td><a class="coin-id" href="${esc(href)}">${face}<span><span class="ticker">${esc(coin.ticker)}</span><span class="name">${esc(coin.name)}</span></span></a></td>
      <td class="num">${esc(formatCap(coin))}</td>
      <td class="num ${since}">${esc(formatPct(coin.sinceLaunchPct))}</td>
      ${volume}
      <td class="num">${esc(formatSol(coin.paidToCreatorSol))}</td>
      <td class="num">${esc(formatAge(coin.createdAt))}</td>
    </tr>`;
  }).join("");
}

export function renderFloor(props) {
  return renderChamber({ ...props, title: "The floor · Socket", page: "floor" });
}

function eventRows(events) {
  return events.map((event) => {
    const amount = event.kind === "burn"
      ? `${formatSol(event.sol)} SOL · ${formatTokens(event.tokens)}`
      : DASH;
    const label = event.kind === "burn" ? "Burn" : "Launched";
    return `<div class="tape-row">
      <span>${esc(formatWhen(event.at))}</span>
      <span>${esc(label)}</span>
      <span>${esc(amount)}</span>
      <span>${sigLink(event.signature)}</span>
    </div>`;
  }).join("");
}

export function renderCoin({ status, address, coin, events, burnsAttributed, now = Date.now() }) {
  if (!coin) {
    const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    const lede = valid
      ? "This mint has no Socket launch. The floor only lists coins this connector has confirmed."
      : "Socket reads a Solana contract address, 32 to 44 characters.";
    const shown = address.length > 80 ? `${address.slice(0, 80)}\u2026` : address;
    const main = `<main id="main" class="sheet missing">
      <h1>${valid ? "Not in the <em>book</em>." : "Not a <em>mint</em>."}</h1>
      <p class="lede">${esc(lede)}</p>
      <div class="slot">${esc(shown)}</div>
      <a class="floor-link" href="/floor">See the floor</a>
    </main>`;
    return {
      statusCode: 404,
      html: shell({
        status,
        title: valid ? "Not in the book · Socket" : "Not a mint · Socket",
        page: "coin",
        main,
      }),
    };
  }
  const src = safeImage(coin.image);
  const face = src
    ? `<div class="face"><img alt="" src="${esc(src)}"></div>`
    : `<div class="face"></div>`;
  const curve = coin.graduated ? "Graduated" : "On the curve";
  const wallet = coin.wallet ? shorten(coin.wallet) : "No wallet stored";
  const burnLink = burnsAttributed
    ? ""
    : `<p class="tape-link"><a href="/burns">See the burn tape</a></p>`;
  const main = `<main id="main" class="sheet coin-sheet">
    ${face}
    <p class="kicker">${esc(coin.ticker)}</p>
    <h1>${esc(coin.name)}</h1>
    <p class="ca-label">Contract</p>
    <div class="slot">${esc(coin.mint)}</div>
    <p class="coin-actions"><a class="pump" href="${esc(`https://pump.fun/coin/${coin.mint}`)}" target="_blank" rel="noopener noreferrer">pump.fun</a></p>
    <div class="fee" aria-hidden="true"><span class="fee-you"></span><span class="fee-them"></span></div>
    <p class="fee-key"><span>You 50%</span><span>Recipient 50%</span></p>
    <p class="launcher"><span>Launcher</span> ${esc(wallet)}</p>
    <div class="figures figures-coin">
      ${figure("Paid to creator", formatSol(coin.paidToCreatorSol), "")}
      ${figure("Age", formatAge(coin.createdAt, now), "")}
      ${figure("Curve", curve, "")}
    </div>
    <div class="tape">
      <div class="tape-head"><span>When</span><span>Event</span><span>Amount</span><span>Signature</span></div>
      ${eventRows(events)}
      ${burnLink}
    </div>
  </main>`;
  return {
    statusCode: 200,
    html: shell({ status, title: `${coin.name} · Socket`, page: "coin", main }),
  };
}

export function renderBurns(props) {
  return renderChamber({ ...props, title: "Burns · Socket", page: "burns" });
}

export function renderPreview(status) {
  const main = `<main id="main" class="sheet preview-sheet">
    <p class="kicker">Local preview</p>
    <h1>Draft <em>card</em></h1>
    <p class="preview-note">This page stands in for the ChatGPT iframe. The form calls quote_launch with an image URL.</p>
    <iframe id="card-frame" class="card-frame" src="/card" title="Draft card"></iframe>
    <form id="url-quote" class="url-quote">
      <label><span>Image URL</span><input id="image-url" name="image_url" type="url" inputmode="url" placeholder="https://" autocomplete="off"></label>
      <label><span>Name</span><input id="quote-name" name="name" type="text" maxlength="32" autocomplete="off"></label>
      <label><span>Ticker</span><input id="quote-ticker" name="ticker" type="text" maxlength="10" autocomplete="off"></label>
      <label><span>Wallet</span><input id="quote-wallet" name="wallet" type="text" maxlength="44" spellcheck="false" autocomplete="off"></label>
      <button id="ask" class="ask" type="submit">Ask quote_launch</button>
    </form>
    <p class="host-block"><span>quote_launch</span></p>
    <pre id="quote-out"></pre>
    <p class="host-block"><span>Host log</span></p>
    <pre id="host-log"></pre>
    <script src="/assets/preview.js"></script>
  </main>`;
  return shell({ status, title: "Draft preview · Socket", page: "preview", main });
}

export function renderNotFound(status) {
  const main = `<main id="main" class="sheet missing">
    <h1>No such <em>page</em>.</h1>
    <a class="floor-link" href="/">Back to Socket</a>
  </main>`;
  return shell({ status, title: "Not found · Socket", page: "missing", main });
}

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

function dotHtml(text) {
  const value = String(text);
  const split = value.indexOf(".");
  if (split === -1) return esc(value);
  return `${esc(value.slice(0, split))}<span class="dot">${esc(value.slice(split))}</span>`;
}

function plugSvg({ gid = "plug", label = "" } = {}) {
  const labelled = label
    ? `role="img" aria-label="${esc(label)}"`
    : `aria-hidden="true"`;
  return `<svg class="plug" viewBox="0 0 320 430" ${labelled}>
    <defs>
      <linearGradient id="${gid}-clay" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e7a088"/>
        <stop offset="0.45" stop-color="#d97757"/>
        <stop offset="1" stop-color="#b9542f"/>
      </linearGradient>
      <linearGradient id="${gid}-brass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3dd9a"/>
        <stop offset="0.45" stop-color="#d4ae5a"/>
        <stop offset="1" stop-color="#8d6a32"/>
      </linearGradient>
      <linearGradient id="${gid}-plate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7f3ea"/>
        <stop offset="1" stop-color="#e4dccb"/>
      </linearGradient>
    </defs>
    <path class="cord" d="M160 318 C160 352 214 346 198 392" fill="none" stroke="#2c2420" stroke-width="16" stroke-linecap="round"/>
    <path class="charge" d="M160 318 C160 352 214 346 198 392" fill="none" stroke="#4ade80" stroke-width="5" stroke-linecap="round"/>
    <rect x="78" y="8" width="164" height="118" rx="18" fill="url(#${gid}-plate)" stroke="#d9d0c0"/>
    <circle cx="108" cy="28" r="5" fill="#c9bfae"/>
    <circle cx="212" cy="28" r="5" fill="#c9bfae"/>
    <path d="M103 28 H113 M207 28 H217" stroke="#6d6458" stroke-width="1.4"/>
    <rect x="116" y="40" width="24" height="52" rx="5" fill="#1c1916"/>
    <rect x="180" y="40" width="24" height="52" rx="5" fill="#1c1916"/>
    <rect class="prong" x="121" y="46" width="14" height="78" rx="2" fill="url(#${gid}-brass)"/>
    <rect class="prong" x="185" y="46" width="14" height="78" rx="2" fill="url(#${gid}-brass)"/>
    <rect x="68" y="112" width="184" height="206" rx="46" fill="url(#${gid}-clay)"/>
    <ellipse cx="128" cy="156" rx="34" ry="16" fill="#fff" opacity="0.28"/>
    <ellipse cx="160" cy="206" rx="54" ry="64" fill="#f3eee3"/>
    <rect x="92" y="248" width="136" height="7" rx="3" fill="#b9542f" opacity="0.45"/>
  </svg>`;
}

function nav(page, status) {
  const line = status.display.marquee;
  const on = status.launchesOn;
  const floor = page === "floor" ? ` aria-current="page"` : "";
  const burns = page === "burns" ? ` aria-current="page"` : "";
  return `<header class="nav">
    <a class="mark" href="/">
      <span class="led${on ? " led-on" : ""}" data-led title="${on ? "Launches on" : "Launches paused"}"></span>
      <span>Socket</span>
    </a>
    <div class="marquee" data-marquee aria-label="${esc(line)}">
      <div class="marquee-track">
        <span class="mq" aria-hidden="true">${esc(line)}</span>
        <span class="mq" aria-hidden="true">${esc(line)}</span>
      </div>
    </div>
    <nav class="nav-links" aria-label="Pages">
      <a href="/floor"${floor}>Floor</a>
      <a href="/burns"${burns}>Burns</a>
    </nav>
  </header>`;
}

function shell({ status, title, page, main }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="description" content="Socket is a private ChatGPT connector for pump.fun. This server is the read path.">
<meta name="theme-color" content="#f3eee3">
<title>${esc(title)}</title>
<link rel="icon" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body class="${esc(page)}" data-page="${esc(page)}">
<a class="skip" href="#main">Skip to content</a>
${nav(page, status)}
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

function lcd(label, value, attrs, sub = "") {
  const word = /[A-Za-z]/.test(value) ? " lcd-word" : "";
  const pause = sub
    ? `<p class="lcd-sub" data-pause>${esc(sub)}</p>`
    : `<p class="lcd-sub"${attrs.includes("data-left") ? " data-pause" : ""}></p>`;
  return `<article class="lcd">
    <p class="lcd-label">${esc(label)}</p>
    <p class="lcd-num${word}" ${attrs} data-value="${esc(value)}">${dotHtml(value)}</p>
    ${pause}
  </article>`;
}

export function renderHome({ status, mcpUrl }) {
  const pause = status.launchesOn ? "" : "Paused";
  const main = `<main id="main" class="stage">
    <div class="lead">
      <p class="kicker">Private connector</p>
      <h1>pump.fun,<br><em>plugged</em> into ChatGPT.</h1>
      <div class="housing">
        <span class="screw tl" aria-hidden="true"></span>
        <span class="screw tr" aria-hidden="true"></span>
        <span class="screw bl" aria-hidden="true"></span>
        <span class="screw br" aria-hidden="true"></span>
        <div class="slot" id="mcp-url" data-mcp-url="${esc(mcpUrl)}">${esc(mcpUrl)}</div>
        <button class="copy" type="button" aria-describedby="chatgpt-path">Copy</button>
      </div>
      <p class="path" id="chatgpt-path">${esc(CHATGPT_PATH)}</p>
      <div class="lcds" aria-live="polite">
        ${lcd("Left today", status.display.leftToday, `data-left`, pause)}
        ${lcd("Sol paid", status.display.paid, `data-paid`)}
        ${lcd("Burned", status.display.burned, `data-burned`)}
      </div>
      <p class="split-line">${esc(SPLIT_LINE)}</p>
      <a class="floor-link" href="/floor">See the floor</a>
    </div>
    <div class="plug-stage">
      ${plugSvg({ gid: "home", label: "Vinyl plug seated in the wall socket" })}
    </div>
  </main>`;
  return shell({ status, title: "Socket", page: "home", main });
}

function boardRows(coins, vol) {
  if (coins.length === 0) {
    return `<tr class="empty-row"><td colspan="${vol ? 6 : 5}"><span>The floor is clear.</span><span class="hint">No live coins yet.</span></td></tr>`;
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

export function renderFloor({ status, coins }) {
  const vol = showVolume(coins);
  const volHead = `<th data-vol${vol ? "" : " hidden"}>24h volume</th>`;
  const main = `<main id="main" class="board-wrap">
    <div class="board-head">
      <div>
        <h1>The <em>floor</em></h1>
        <p class="count" data-count>${coins.length} live</p>
      </div>
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
    </div>
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
  </main>`;
  return shell({ status, title: "The floor · Socket", page: "floor", main });
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
      ${plugSvg({ gid: "miss" })}
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
    : `<div class="face">${plugSvg({ gid: "coin" })}</div>`;
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
    <div class="lcds lcds-coin">
      ${lcd("Paid to creator", formatSol(coin.paidToCreatorSol), "")}
      ${lcd("Age", formatAge(coin.createdAt, now), "")}
      ${lcd("Curve", curve, "")}
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

export function renderBurns({ status, burns }) {
  const rows = burns.length
    ? `<div class="tape-head"><span>When</span><span>SOL</span><span>Tokens</span><span>Burn</span></div>
      ${burns.map((burn) => `<div class="tape-row">
        <span>${esc(formatWhen(burn.at))}</span>
        <span>${esc(formatSol(burn.sol))}</span>
        <span>${esc(formatTokens(burn.tokens))}</span>
        <span>${sigLink(burn.burnSig)}</span>
      </div>`).join("")}`
    : `<p class="tape-empty">No burns yet.</p>`;
  const main = `<main id="main" class="sheet burns-sheet">
    <div class="burn-top">
      <h1>Burn <em>tape</em></h1>
      <article class="lcd lcd-compact">
        <p class="lcd-label">Burned</p>
        <p class="lcd-num" data-value="${esc(status.display.burned)}">${dotHtml(status.display.burned)}</p>
      </article>
    </div>
    <div class="tape">${rows}</div>
    <p class="tape-foot">${esc(RESERVE_RULE)}</p>
  </main>`;
  return shell({ status, title: "Burn tape · Socket", page: "burns", main });
}

export function renderNotFound(status) {
  const main = `<main id="main" class="sheet missing">
    <h1>No such <em>page</em>.</h1>
    <a class="floor-link" href="/">Back to Socket</a>
  </main>`;
  return shell({ status, title: "Not found · Socket", page: "missing", main });
}

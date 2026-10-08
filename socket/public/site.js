import { safeImage, searchCoins, showVolume, sortCoins } from "./board.js";
import { mountChamber } from "./chamber.js";
import { DASH, formatAge, formatCap, formatPct, formatSol, pctClass } from "./format.js";

function showToast() {
  const el = document.querySelector(".toast");
  if (!el) return;
  el.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

async function copyUrl() {
  const slot = document.querySelector("[data-mcp-url]");
  const url = slot?.dataset.mcpUrl || "";
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const area = document.createElement("textarea");
    area.value = url;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-999px";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  window.dispatchEvent(new CustomEvent("socket:focus", { detail: "copy" }));
  showToast();
}

function setFigure(el, text) {
  if (!el || el.dataset.value === text) return;
  el.dataset.value = text;
  el.textContent = text;
}

function applyStatus(status) {
  setFigure(document.querySelector("[data-left]"), status.display.leftToday);
  setFigure(document.querySelector("[data-paid]"), status.display.paid);
  setFigure(document.querySelector("[data-burned]"), status.display.burned);
  const pause = document.querySelector("[data-pause]");
  if (pause) pause.textContent = status.launchesOn ? "" : "Paused";
  const led = document.querySelector("[data-led]");
  if (led) {
    led.classList.toggle("led-on", Boolean(status.launchesOn));
    led.title = status.launchesOn ? "Launches on" : "Launches paused";
  }
  const line = status.display.marquee;
  const statusLine = document.querySelector("[data-status-line]");
  if (statusLine && statusLine.textContent !== line) statusLine.textContent = line;
  document.body.dataset.statusReady = "1";
}

async function pollStatus() {
  try {
    const res = await fetch("/api/status", { headers: { accept: "application/json" } });
    if (res.ok) applyStatus(await res.json());
  } catch {
    /* keep the server render */
  }
  document.body.dataset.statusReady = "1";
}

function cell(text, className) {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
}

function renderRows(state) {
  const body = document.querySelector("[data-rows]");
  if (!body) return;
  const filtered = sortCoins(searchCoins(state.coins, state.query), state.sort);
  const volume = showVolume(state.coins);
  document.querySelectorAll("[data-vol]").forEach((el) => {
    el.hidden = !volume;
  });
  const count = document.querySelector("[data-count]");
  if (count) count.textContent = `${state.coins.length} live`;
  const empty = document.querySelector("[data-empty-line]");
  const plate = document.querySelector(".plate-floor");
  if (empty) {
    empty.hidden = filtered.length !== 0;
    empty.textContent = filtered.length === 0
      ? (state.coins.length === 0 ? "The floor is clear." : "Nothing matches that.")
      : "";
  }
  plate?.classList.toggle("is-empty", filtered.length === 0);
  window.dispatchEvent(new CustomEvent("socket:coins", { detail: filtered }));
  body.replaceChildren();
  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = volume ? 6 : 5;
    const title = document.createElement("span");
    title.className = "empty-line";
    title.textContent = state.coins.length === 0 ? "The floor is clear." : "Nothing matches that.";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = state.coins.length === 0 ? "No live coins yet." : "Try another name, ticker, or mint.";
    td.append(title, hint);
    tr.append(td);
    body.append(tr);
    return;
  }
  const newcomers = state.seen ? filtered.filter((coin) => !state.seen.has(coin.mint)) : [];
  const fresh = new Set(newcomers.map((coin) => coin.mint));
  for (const coin of filtered) body.append(coinRow(coin, volume, fresh.has(coin.mint)));
}

function coinRow(coin, volume, isNew) {
  const tr = document.createElement("tr");
  if (isNew) tr.classList.add("new");
  tr.tabIndex = 0;
  const href = `/coin/${encodeURIComponent(coin.mint)}`;
  tr.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    location.href = href;
  });
  tr.addEventListener("keydown", (event) => {
    if (event.key === "Enter") location.href = href;
  });

  const coinCell = document.createElement("td");
  const link = document.createElement("a");
  link.className = "coin-id";
  link.href = href;
  const face = document.createElement("span");
  face.className = "mini-face";
  const src = safeImage(coin.image);
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = src;
    face.append(img);
  }
  const text = document.createElement("span");
  const ticker = document.createElement("span");
  ticker.className = "ticker";
  ticker.textContent = coin.ticker;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = coin.name;
  text.append(ticker, name);
  link.append(face, text);
  coinCell.append(link);

  const since = cell(formatPct(coin.sinceLaunchPct), `num ${pctClass(coin.sinceLaunchPct)}`.trim());
  const paid = cell(formatSol(coin.paidToCreatorSol), "num");
  const age = cell(formatAge(coin.createdAt), "num");
  tr.append(coinCell, cell(formatCap(coin), "num"), since);
  if (volume) {
    const vol = cell(coin.volume24hUsd == null ? DASH : String(coin.volume24hUsd), "num");
    vol.dataset.vol = "";
    tr.append(vol);
  }
  tr.append(paid, age);
  return tr;
}

document.querySelector(".copy")?.addEventListener("click", copyUrl);

if (document.querySelector("[data-left]") || document.querySelector("[data-status-line]")) {
  pollStatus();
  window.setInterval(pollStatus, 60_000);
}

if (document.querySelector("[data-rows]")) {
  const state = { coins: [], sort: "new", query: "", seen: null };
  const draw = () => renderRows(state);
  const commit = (coins) => {
    state.coins = coins;
    draw();
    state.seen = new Set(coins.map((coin) => coin.mint));
  };
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = button.dataset.sort;
      document.querySelectorAll("[data-sort]").forEach((other) => {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      });
      draw();
    });
  });
  document.querySelector(".search")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    draw();
  });
  const poll = async () => {
    try {
      const res = await fetch("/api/coins", { headers: { accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        commit(data.coins || []);
      }
    } catch {
      /* keep the server render */
    }
    document.body.dataset.boardReady = "1";
  };
  poll();
  window.setInterval(poll, 30_000);
}

if (document.querySelector("#chamber")) mountChamber();

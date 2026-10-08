export const DRAFT_CARD_URI = "ui://socket/draft-card.html";

export function renderDraftCard(origin) {
  const safeOrigin = JSON.stringify(origin);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft card</title>
<style>
  @font-face { font-family: "Bodoni Moda"; font-style: normal; font-weight: 500 800; font-display: swap; src: url("${origin}/assets/fonts/bodoni-moda.woff2") format("woff2"); }
  @font-face { font-family: "Bodoni Moda"; font-style: italic; font-weight: 500 800; font-display: swap; src: url("${origin}/assets/fonts/bodoni-moda-italic.woff2") format("woff2"); }
  @font-face { font-family: Manrope; font-style: normal; font-weight: 400 700; font-display: swap; src: url("${origin}/assets/fonts/manrope.woff2") format("woff2"); }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e6eef2; color: #17202b; font-family: Manrope, "Helvetica Neue", sans-serif; }
  .card { width: min(560px, 100%); margin: 0 auto; padding: 18px 16px 28px; }
  .kicker, label span, .fee-key, .bytes, .hint { font-family: Manrope, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #17202b; }
  h1 { margin: 4px 0 14px; font-family: "Bodoni Moda", Didot, serif; font-weight: 600; font-size: 48px; line-height: 0.88; letter-spacing: -0.045em; color: #17202b; }
  h1 em { font-style: italic; font-weight: 560; color: inherit; }
  .stage { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 1; max-height: 360px; margin: 0 auto 8px; overflow: hidden; border: 1px solid #17202b; background: #f7f4ee; cursor: pointer; }
  .stage.hot { outline: 1px solid #b68b4c; outline-offset: -2px; }
  .stage input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .stage img[hidden] { display: none; }
  .socket-mark { width: 42%; height: auto; }
  .stage.has-image .socket-mark, .stage.has-image .hint { display: none; }
  .hint { margin: 8px 0 0; }
  .bytes, .status { margin: 8px 0 0; text-align: center; font-variant-numeric: tabular-nums; }
  .status { font-family: Manrope, sans-serif; font-size: 13px; color: #17202b; }
  .status.bad { border-left: 3px solid #b68b4c; padding-left: 8px; }
  label { display: block; margin-top: 12px; }
  label span { display: block; margin-bottom: 6px; }
  input[type="text"], input[type="url"], textarea { width: 100%; border: 1px solid #17202b; padding: 12px 14px; background: #e6eef2; color: #17202b; font: 15px/1.4 Manrope, sans-serif; }
  textarea { min-height: 72px; resize: vertical; }
  .fee { display: flex; height: 8px; margin-top: 16px; background: #17202b; }
  .fee-you { width: 50%; background: #b68b4c; }
  .fee-them { width: 50%; background: #17202b; }
  .fee-key { display: flex; justify-content: space-between; margin: 8px 0 0; }
  .paused { margin: 16px 0 0; color: #17202b; font-family: "Bodoni Moda", Didot, serif; font-style: italic; font-weight: 560; font-size: 28px; letter-spacing: -0.03em; }
  .covered { margin: 14px 0 0; color: #17202b; }
  .lock { margin: 8px 0 0; max-width: 46ch; color: #17202b; font-size: 14px; line-height: 1.45; }
  .issues { margin: 8px 0 0; color: #17202b; font-family: Manrope, sans-serif; font-size: 12px; border-left: 3px solid #b68b4c; padding-left: 8px; }
  .issues:empty { display: none; }
</style>
</head>
<body>
<main class="card">
  <p class="kicker">Draft</p>
  <h1>Your <em>coin</em></h1>
  <label class="stage" id="stage">
    <input id="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp">
    <svg class="socket-mark" viewBox="0 0 200 280" aria-hidden="true">
      <rect x="52" y="58" width="120" height="132" fill="#17202b"/>
      <rect x="36" y="42" width="120" height="132" fill="#b68b4c"/>
      <rect x="70" y="14" width="14" height="46" fill="#b68b4c"/>
      <rect x="112" y="14" width="14" height="46" fill="#b68b4c"/>
      <circle cx="96" cy="112" r="30" fill="#f7f4ee"/>
      <path d="M96 174 L96 224 L122 258" fill="none" stroke="#17202b" stroke-width="3"/>
    </svg>
    <img id="face" alt="" hidden>
    <span class="hint">PNG, JPEG, GIF, WebP</span>
  </label>
  <p class="bytes" id="bytes"></p>
  <p class="status" id="status"></p>
  <label>Image URL <span>If the file drop is unavailable</span><input id="image-url" type="url" maxlength="2000" placeholder="https://"></label>
  <label>Name <span>32 characters</span><input id="name" type="text" maxlength="32"></label>
  <label>Ticker <span>10 letters or numbers</span><input id="ticker" type="text" maxlength="10" autocapitalize="characters"></label>
  <label>Description <span>400 characters</span><textarea id="description" maxlength="400"></textarea></label>
  <label>X <span>Optional</span><input id="x" type="url" maxlength="2000" placeholder="https://x.com/"></label>
  <label>Website <span>Optional</span><input id="website" type="url" maxlength="2000" placeholder="https://"></label>
  <label>Wallet <span>Solana address, 50% locks to it</span><input id="wallet" type="text" maxlength="44" spellcheck="false"></label>
  <div class="fee" aria-hidden="true"><span class="fee-you"></span><span class="fee-them"></span></div>
  <p class="fee-key"><span>You 50%</span><span>Recipient 50%</span></p>
  <p class="paused" id="paused">Launches are paused.</p>
  <p class="covered" id="covered" hidden>Creation fee covered by Socket · about 0.012 SOL</p>
  <p class="lock">Nothing is on chain until you approve launch_coin. The split cannot be changed after that.</p>
  <p class="issues" id="issues"></p>
</main>
<script>
const ORIGIN = ${safeOrigin};
const MAX = 4000000;
const fileInput = document.querySelector("#file");
const stage = document.querySelector("#stage");
const face = document.querySelector("#face");
const bytesEl = document.querySelector("#bytes");
const statusEl = document.querySelector("#status");
const issuesEl = document.querySelector("#issues");
const fields = {
  image_url: document.querySelector("#image-url"),
  name: document.querySelector("#name"),
  ticker: document.querySelector("#ticker"),
  description: document.querySelector("#description"),
  x: document.querySelector("#x"),
  website: document.querySelector("#website"),
  wallet: document.querySelector("#wallet"),
};
let pictureId = null;
let quoteTimer = 0;

function post(message) {
  window.parent.postMessage(message, "*");
}

function sniff(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const head = String.fromCharCode(...b.slice(0, 6));
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  const riff = String.fromCharCode(...b.slice(0, 4));
  const webp = b.length >= 12 ? String.fromCharCode(...b.slice(8, 12)) : "";
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

function setStatus(text, bad) {
  statusEl.textContent = text;
  statusEl.classList.toggle("bad", Boolean(bad));
}

function showImage(url) {
  face.src = url;
  face.hidden = false;
  stage.classList.add("has-image");
}

async function shrink(file) {
  const raw = await file.arrayBuffer();
  const mime = sniff(raw);
  if (!mime) return { error: "format" };
  if (raw.byteLength <= MAX) return { bytes: raw, mime, size: raw.byteLength };
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([raw], { type: mime }));
  } catch {
    return { error: "size" };
  }
  let scale = 1;
  let quality = 0.92;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const side = Math.max(32, Math.round(Math.min(bitmap.width, bitmap.height, 1600) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    const crop = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX) {
      return { bytes: await blob.arrayBuffer(), mime: "image/jpeg", size: blob.size };
    }
    quality -= 0.12;
    if (quality < 0.5) {
      scale *= 0.65;
      quality = 0.84;
    }
  }
  return { error: "size" };
}

function keptUntil(iso) {
  const date = new Date(iso);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][date.getUTCMonth()];
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return mon + " " + date.getUTCDate() + " " + hh + ":" + mm + " UTC";
}

function draftPayload(quote) {
  return {
    picture_id: pictureId,
    image_url: fields.image_url.value.trim() || null,
    name: fields.name.value.trim() || null,
    ticker: fields.ticker.value.trim() || null,
    description: fields.description.value.trim() || null,
    x: fields.x.value.trim() || null,
    website: fields.website.value.trim() || null,
    wallet: fields.wallet.value.trim() || null,
    userPercent: 50,
    recipientPercent: 50,
    canPay: false,
    paused: true,
    quote: quote || null,
  };
}

function pushContext(quote) {
  const draft = draftPayload(quote);
  const picture = draft.picture_id ? "picture_id " + draft.picture_id : (draft.image_url ? "image_url " + draft.image_url : "no picture");
  post({
    jsonrpc: "2.0",
    method: "ui/update-model-context",
    params: {
      content: [{ type: "text", text: "Socket draft. " + picture + ". Launches are paused. 50% wallet / 50% published recipient." }],
      structuredContent: draft,
    },
  });
}

function applyQuote(quote) {
  const paused = document.querySelector("#paused");
  const covered = document.querySelector("#covered");
  const canPay = Boolean(quote && quote.canPay);
  paused.hidden = canPay;
  covered.hidden = !canPay;
  const lines = (quote && quote.issues || []).map((issue) => issue.field + " · " + issue.error);
  issuesEl.textContent = lines.join("\\n");
  pushContext(quote);
}

async function refreshQuote() {
  const body = {
    name: fields.name.value,
    ticker: fields.ticker.value,
    description: fields.description.value,
    x: fields.x.value,
    website: fields.website.value,
    wallet: fields.wallet.value,
    picture_id: pictureId,
    image_url: fields.image_url.value,
  };
  try {
    const res = await fetch(ORIGIN + "/api/quote", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    applyQuote(await res.json());
  } catch {
    /* the host can still call quote_launch */
  }
}

function scheduleQuote() {
  window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(refreshQuote, 200);
}

async function takeFile(file) {
  if (!file) return;
  const prepared = await shrink(file);
  if (prepared.error) {
    bytesEl.textContent = "";
    setStatus(prepared.error, true);
    return;
  }
  bytesEl.textContent = prepared.size.toLocaleString("en-US") + " bytes";
  showImage(URL.createObjectURL(new Blob([prepared.bytes], { type: prepared.mime })));
  setStatus("Uploading", false);
  try {
    const res = await fetch(ORIGIN + "/api/picture", {
      method: "POST",
      headers: { "content-type": prepared.mime, accept: "application/json" },
      body: prepared.bytes,
    });
    const json = await res.json();
    if (!res.ok || !json.ok || !json.stored || !json.id) {
      setStatus(json.error || "upload failed", true);
      return;
    }
    pictureId = json.id;
    setStatus("In · picture kept until " + keptUntil(json.expiresAt), false);
    refreshQuote();
  } catch {
    setStatus("upload failed", true);
  }
}

fileInput.addEventListener("change", () => takeFile(fileInput.files && fileInput.files[0]));
stage.addEventListener("dragover", (event) => { event.preventDefault(); stage.classList.add("hot"); });
stage.addEventListener("dragleave", () => stage.classList.remove("hot"));
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  stage.classList.remove("hot");
  takeFile(event.dataTransfer.files && event.dataTransfer.files[0]);
});
fields.image_url.addEventListener("change", () => {
  const url = fields.image_url.value.trim();
  if (url.startsWith("https://")) showImage(url);
  scheduleQuote();
});
for (const input of Object.values(fields)) input.addEventListener("input", scheduleQuote);

function applyToolInput(params) {
  const args = params?.arguments || params?.structuredContent || params?.toolInput || params || {};
  for (const [key, input] of Object.entries(fields)) {
    if (typeof args[key] === "string") input.value = args[key];
  }
  if (typeof args.picture_id === "string") pictureId = args.picture_id;
  if (typeof args.image_url === "string" && args.image_url.startsWith("https://")) showImage(args.image_url);
  if (pictureId) {
    face.src = ORIGIN + "/api/img?id=" + encodeURIComponent(pictureId);
    face.hidden = false;
    stage.classList.add("has-image");
  }
  scheduleQuote();
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  if (msg.method === "ui/initialize") {
    post({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-03-26",
        appInfo: { name: "Socket draft", version: "0.1.0" },
        capabilities: {},
      },
    });
  }
  if (msg.method === "ui/notifications/tool-input" || msg.method === "ui/notifications/tool-result") {
    applyToolInput(msg.params);
  }
});

post({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
refreshQuote();
</script>
</body>
</html>`;
}

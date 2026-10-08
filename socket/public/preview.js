const frame = document.querySelector("#card-frame");
const log = document.querySelector("#host-log");
const form = document.querySelector("#url-quote");
const out = document.querySelector("#quote-out");

function fit() {
  const doc = frame.contentDocument;
  if (!doc) return;
  const height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
  if (height > 0) frame.style.height = `${height + 24}px`;
}

function wake() {
  frame.contentWindow?.postMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "ui/initialize",
    params: {},
  }, "*");
  fit();
}

window.addEventListener("message", (event) => {
  if (!frame || event.source !== frame.contentWindow) return;
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  if (msg.method === "ui/notifications/initialized") wake();
  if (msg.method === "ui/update-model-context") {
    log.textContent = JSON.stringify(msg.params);
    fit();
  }
});

frame.addEventListener("load", () => {
  if (frame.contentDocument?.readyState === "complete") wake();
  fit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const args = {};
  for (const key of ["image_url", "name", "ticker", "wallet"]) {
    const value = String(data.get(key) || "").trim();
    if (value) args[key] = value;
  }
  out.textContent = "Asking";
  const res = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "quote_launch", arguments: args },
    }),
  });
  const json = await res.json();
  out.textContent = json?.result?.content?.[0]?.text || JSON.stringify(json);
});

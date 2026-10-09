const out = document.querySelector("#refusal");
const frame = document.querySelector("#card-frame");
const key = "preview-paused-launch";

function fit() {
  const doc = frame && frame.contentDocument;
  if (!doc) return;
  frame.style.height = `${doc.documentElement.scrollHeight}px`;
}

if (frame) {
  await new Promise((resolve) => {
    if (frame.contentDocument && frame.contentDocument.readyState === "complete") resolve();
    else frame.addEventListener("load", () => resolve(), { once: true });
  });
  fit();
}

async function call(id) {
  const res = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "launch_coin",
        arguments: {
          name: "Chamber Lamp",
          ticker: "LAMP",
          wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
          idempotency_key: key,
        },
      },
    }),
  });
  return res.json();
}

try {
  const first = await call(1);
  const second = await call(2);
  const a = first.result;
  const b = second.result;
  const states = (a.structuredContent && a.structuredContent.states) || [];
  const same = a.structuredContent
    && b.structuredContent
    && a.structuredContent.idempotencyKey === b.structuredContent.idempotencyKey
    && a.structuredContent.status === b.structuredContent.status
    && a.isError === true
    && b.isError === true;
  out.textContent = `${a.content[0].text} Status ${states.join(" → ")}. Same result on repeat: ${same ? "yes" : "no"}.`;
} catch {
  out.textContent = "Launches are paused.";
}

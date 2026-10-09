// promptfun approval page. Runs in the user's browser: discovers Wallet Standard wallets, asks the server to
// compile the exact transaction, shows the decoded preview and network fee, has the wallet sign, and reads the receipt.
// No key ever leaves the wallet. The pump.fun one-time mint key (if any) is generated here and never sent.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const intentId = app.dataset.intent;
  const walletChain = app.dataset.walletChain;
  const $ = (id) => document.getElementById(id);
  const wallets = [];
  let account = null;
  let wallet = null;
  let built = null;
  let mintKey = null;

  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58(bytes) {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let out = "";
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
    return out;
  }
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  function text(el, value) { el.textContent = value; return el; }
  function node(tag, props = {}, kids = []) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    for (const k of kids) el.append(k);
    return el;
  }
  function setError(message) { text($("error"), message || ""); }
  function setStatus(status) { const el = $("status"); el.dataset.status = status; text(el, status.replace("_", " ")); }

  async function api(path, body) {
    const res = await fetch(`/api/intents/${intentId}${path}`, body === undefined
      ? { headers: { accept: "application/json" } }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code });
    return data;
  }

  // Wallet Standard discovery, without a library: https://github.com/wallet-standard/wallet-standard
  function register(...list) {
    for (const w of list) {
      if (wallets.includes(w)) continue;
      const solana = (w.chains || []).some((c) => c.startsWith("solana:"));
      if (!solana || !w.features["standard:connect"] || !w.features["solana:signTransaction"]) continue;
      wallets.push(w);
    }
    renderWallets();
    return () => {};
  }
  const api0 = Object.freeze({ register });
  window.addEventListener("wallet-standard:register-wallet", (event) => event.detail(api0));
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api0 }));

  function renderWallets() {
    const list = $("wallet-list");
    list.replaceChildren();
    text($("wallet-hint"), wallets.length ? "Pick the wallet you want to use." : "No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.");
    for (const w of wallets) {
      const btn = node("button", { type: "button", className: "wallet" }, [node("img", { src: w.icon, alt: "" }), w.name]);
      btn.dataset.wallet = w.name;
      btn.addEventListener("click", () => connect(w, btn));
      list.append(btn);
    }
  }
  setTimeout(renderWallets, 1500);

  async function connect(w, btn) {
    setError("");
    btn.disabled = true;
    try {
      const { accounts } = await w.features["standard:connect"].connect();
      const acct = (accounts || []).find((a) => (a.chains || []).length === 0 || a.chains.includes(walletChain)) || accounts[0];
      if (!acct) throw new Error("The wallet did not share an account.");
      wallet = w;
      account = acct;
      await build();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  }

  async function build() {
    const intent = await api("");
    const needsMint = intent.kind === "launch_token" && intent.params.venue === "pumpfun";
    if (needsMint && !mintKey) {
      mintKey = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    }
    const body = { account: account.address };
    if (needsMint) body.mint = b58(new Uint8Array(await crypto.subtle.exportKey("raw", mintKey.publicKey)));
    const data = await api("/build", body);
    built = data.built;
    renderPreview(data.view);
  }

  function renderPreview(view) {
    $("wallets").hidden = true;
    $("preview").hidden = false;
    setStatus(view.status);
    const p = view.preview;
    $("steps").replaceChildren(...p.steps.map((s) => node("li", { textContent: s })));
    const sim = $("simulation");
    sim.className = p.simulationOk ? "ok" : "warn";
    text(sim, p.simulationOk ? "Simulation passed on the network." : `Simulation failed: ${p.simulationError}. Approving would likely fail.`);
    const rows = [
      ["Network fee", `${p.networkFee} ${p.symbol}`],
      ...(p.deposits !== "0" ? [["Rent deposits (held by the new accounts)", `${p.deposits} ${p.symbol}`]] : []),
      ["Total from your wallet", `${p.total} ${p.symbol}${p.usd ? ` (≈ $${p.usd})` : ""}`],
      ["promptfun fee", "none"],
      ["Your balance", p.balance == null ? "unknown" : `${p.balance} ${p.symbol}`],
    ];
    const dl = node("dl");
    for (const [k, v] of rows) dl.append(node("dt", { textContent: k }), node("dd", { textContent: v }));
    $("fee").replaceChildren(
      node("strong", { textContent: p.feeLabel }),
      dl,
      ...(p.note ? [node("p", { className: "muted", textContent: p.note })] : []),
      node("p", { className: "muted", textContent: `${p.feeBasis} ${p.usdSource || ""}`.trim() }),
    );
    if (p.enough === false) setError(`Not enough ${p.symbol}: this needs ${p.total} and the wallet has ${p.balance}.`);
  }

  function signerIndex(wire, pubkey) {
    let o = 0;
    let count = 0, shift = 0, byte;
    do { byte = wire[o++]; count |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    const sigStart = o;
    o += count * 64;
    const msgStart = o;
    if (wire[o] & 0x80) o += 1; // versioned prefix
    const required = wire[o];
    o += 3;
    let keys = 0; shift = 0;
    do { byte = wire[o++]; keys |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    for (let i = 0; i < Math.min(required, keys); i++) {
      const key = wire.subarray(o + i * 32, o + i * 32 + 32);
      if (key.every((b, j) => b === pubkey[j])) return { index: i, sigStart, msgStart };
    }
    throw new Error("Mint key is not a signer of this transaction.");
  }

  async function approve() {
    setError("");
    const btn = $("approve");
    btn.disabled = true;
    try {
      let wire = fromB64(built.payload);
      if (built.extraSigners.length && mintKey) {
        const pub = new Uint8Array(await crypto.subtle.exportKey("raw", mintKey.publicKey));
        const { index, sigStart, msgStart } = signerIndex(wire, pub);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, mintKey.privateKey, wire.subarray(msgStart)));
        wire = wire.slice();
        wire.set(sig, sigStart + index * 64);
      }
      let signed;
      try {
        [signed] = await wallet.features["solana:signTransaction"].signTransaction({ account, transaction: wire, chain: walletChain });
      } catch (err) {
        await api("/reject", { reason: err.message || "Declined in wallet" }).catch(() => {});
        throw new Error("You declined in your wallet. Nothing was sent.");
      }
      const view = await api("/submit", { signedTransaction: toB64(signed.signedTransaction) });
      showResult(view);
      poll();
    } catch (err) {
      if (err.code === "stale") {
        setError("The transaction went stale before it was sent. Rebuilding — review and approve again.");
        await build().catch((e) => setError(e.message));
      } else {
        setError(err.message || String(err));
      }
    } finally {
      btn.disabled = false;
    }
  }

  function link(href, label) { return node("a", { href, textContent: label, target: "_blank", rel: "noopener noreferrer" }); }

  function showResult(view) {
    setStatus(view.status);
    $("preview").hidden = true;
    $("result").hidden = false;
    const body = [];
    if (view.status === "submitted") body.push(node("p", { textContent: "Signed by your wallet and sent. Waiting for the network to confirm…" }));
    if (view.transaction) {
      body.push(node("p", {}, ["Transaction ", node("code", { textContent: view.transaction.id })]));
      if (view.transaction.explorerUrl) body.push(node("p", {}, [link(view.transaction.explorerUrl, "View transaction on the explorer")]));
    }
    if (view.receipt) {
      body.push(node("p", { className: view.receipt.status === "success" ? "ok" : "warn", textContent: view.receipt.status === "success" ? "Confirmed. Checked against the chain:" : "Failed. What the chain shows:" }));
      body.push(node("ul", {}, view.receipt.verified.map((v) => node("li", { textContent: v }))));
      body.push(node("p", { className: "muted", textContent: `Slot/block ${view.receipt.slotOrBlock} · network fee paid ${view.receipt.fee} ${view.receipt.feeSymbol}` }));
      if (view.receipt.tokenAddress) {
        body.push(node("p", {}, ["Token ", node("code", { textContent: view.receipt.tokenAddress })]));
        if (view.receipt.tokenExplorerUrl) body.push(node("p", {}, [link(view.receipt.tokenExplorerUrl, "View token on the explorer")]));
      }
      body.push(node("p", { className: "muted", textContent: "You can go back to the chat now." }));
    }
    if (view.error && view.status !== "confirmed") body.push(node("p", { className: "warn", textContent: view.error }));
    $("result-body").replaceChildren(...body);
  }

  async function poll() {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const view = await api("").catch(() => null);
      if (!view) continue;
      if (view.status !== "submitted") { showResult(view); return; }
    }
    setError("Still waiting for the network. Refresh this page later; the transaction link above shows its state.");
  }

  $("approve").addEventListener("click", approve);
  $("cancel").addEventListener("click", async () => {
    await api("/reject", { reason: "Cancelled on approval page" }).catch(() => {});
    setError("Cancelled. Nothing was sent.");
    $("preview").hidden = true;
  });

  api("").then((view) => {
    if (["submitted", "confirmed", "failed", "expired"].includes(view.status)) {
      $("wallets").hidden = true;
      if (view.status === "expired") setError("This request expired. Nothing was sent. Ask again in the chat.");
      else { showResult(view); if (view.status === "submitted") poll(); }
    }
  }).catch((err) => setError(err.message));
})();

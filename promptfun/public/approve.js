// promptfun approval page. Runs in the user's browser: discovers wallets (Wallet Standard on Solana, EIP-6963 on EVM),
// asks the server to compile the exact transaction, shows the decoded preview and network fee, has the wallet sign,
// and reads the receipt. No key ever leaves the wallet. The pump.fun one-time mint key (if any) is generated here
// and never sent.
(() => {
  "use strict";
  const app = document.getElementById("app");
  const intentId = app.dataset.intent;
  const walletChain = app.dataset.walletChain;
  const family = app.dataset.family;
  const evmChain = app.dataset.evm ? JSON.parse(app.dataset.evm) : null;
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
  function setStatus(status) {
    const el = $("status"); el.dataset.status = status; text(el, status.replace("_", " "));
    const approveStep = document.querySelector('[data-step="approve"]');
    const receiptStep = document.querySelector('[data-step="receipt"]');
    const sent = ["submitted", "confirmed", "failed"].includes(status);
    approveStep.className = sent ? "done" : "now";
    approveStep.firstChild.textContent = sent ? "✓" : "3";
    receiptStep.className = status === "confirmed" ? "done" : sent ? "now" : "";
    receiptStep.firstChild.textContent = status === "confirmed" ? "✓" : "4";
  }
  function setBadge(label, tone) {
    const badge = $("check-badge");
    badge.className = `card-badge${tone ? ` card-badge-${tone}` : ""}`;
    text(badge, label);
    $("pv-top").className = `pv-top${tone === "ok" ? " is-ok" : tone === "bad" ? " is-bad" : tone === "wait" ? "" : ""}`;
  }

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
  if (family === "solana") {
    window.addEventListener("wallet-standard:register-wallet", (event) => event.detail(api0));
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api0 }));
  }

  // EIP-6963 multi-wallet discovery: https://eips.ethereum.org/EIPS/eip-6963
  if (family === "evm") {
    window.addEventListener("eip6963:announceProvider", (event) => {
      const { info, provider } = event.detail || {};
      if (!info || !provider || wallets.some((w) => w.uuid === info.uuid)) return;
      wallets.push({ uuid: info.uuid, name: info.name, icon: info.icon, provider });
      renderWallets();
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      if (!wallets.length && window.ethereum) {
        wallets.push({ uuid: "injected", name: "Browser wallet", icon: "", provider: window.ethereum });
        renderWallets();
      }
    }, 1200);
  }

  async function ensureEvmChain(provider) {
    const current = await provider.request({ method: "eth_chainId" });
    if (String(current).toLowerCase() === evmChain.chainId) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: evmChain.chainId }] });
    } catch (err) {
      if (err && err.code === 4902) {
        await provider.request({ method: "wallet_addEthereumChain", params: [evmChain] });
      } else {
        throw new Error(`Switch your wallet to ${evmChain.chainName} to continue.`);
      }
    }
    const after = await provider.request({ method: "eth_chainId" });
    if (String(after).toLowerCase() !== evmChain.chainId) throw new Error(`Your wallet is not on ${evmChain.chainName}.`);
  }

  function renderWallets() {
    const list = $("wallet-list");
    list.replaceChildren();
    text($("wallet-hint"), wallets.length
      ? "Pick the wallet you want to use."
      : family === "evm"
        ? "No EVM wallet found. Install MetaMask, Rabby or Coinbase Wallet, then reload."
        : "No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.");
    for (const w of wallets) {
      const btn = node("button", { type: "button", className: "btn btn-ghost wallet-pick" }, [...(w.icon ? [node("img", { src: w.icon, alt: "" })] : []), w.name]);
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
      if (family === "evm") {
        const accounts = await w.provider.request({ method: "eth_requestAccounts" });
        if (!accounts || !accounts[0]) throw new Error("The wallet did not share an account.");
        await ensureEvmChain(w.provider);
        wallet = w;
        account = { address: accounts[0] };
        await build();
        return;
      }
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

  function renderWho() {
    const icon = wallet.icon ? node("img", { className: "wallet-icon", src: wallet.icon, alt: "" }) : node("i", { className: "wallet-icon" });
    const name = wallet.name || "Your wallet";
    const addr = account.address;
    $("wallet-who").replaceChildren(
      icon,
      node("p", {}, [name, node("span", { textContent: `${addr.slice(0, 6)}…${addr.slice(-4)} on ${app.dataset.chainName}` })]),
      node("span", { className: "status", textContent: "Ready" }),
    );
  }

  function row(label, value, chip) {
    return node("div", {}, [node("dt", { textContent: label }), node("dd", {}, [chip ? node("span", { className: "fee-chip", textContent: value }) : value])]);
  }

  function renderPreview(view) {
    $("wallets").hidden = true;
    $("preview").hidden = false;
    renderWho();
    setStatus(view.status);
    const p = view.preview;
    $("steps-hint").hidden = true;
    $("steps").replaceChildren(...p.steps.map((s) => node("li", { textContent: s })));
    const sim = $("simulation");
    sim.hidden = false;
    text(sim, p.simulationOk ? "Simulated on the network: it passes." : `Simulation failed: ${p.simulationError}. Approving would likely fail.`);
    sim.className = p.simulationOk ? "pv-note" : "warn-box";
    if (p.simulationOk) setBadge("Checked"); else setBadge("Check failed", "bad");
    const fee = $("fee");
    while (fee.children.length > 2) fee.lastElementChild.remove();
    fee.append(
      row(p.feeLabel.replace(/^Network fee/, "Estimated network fee"), `${p.networkFee} ${p.symbol}`, true),
      ...(p.deposits !== "0" ? [row("Rent deposits (held by the new accounts)", `${p.deposits} ${p.symbol}`)] : []),
      row("Total from your wallet", `${p.total} ${p.symbol}${p.usd ? ` (≈ $${p.usd})` : ""}`),
      row(`${"promptfun"} fee`, "none"),
      row("Your balance", p.balance == null ? "unknown" : `${p.balance} ${p.symbol}`),
    );
    const basis = $("fee-basis");
    basis.hidden = false;
    text(basis, [p.note, p.feeBasis, p.usdSource].filter(Boolean).join(" "));
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
      if (family === "evm") {
        await approveEvm();
        return;
      }
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

  async function approveEvm() {
    await ensureEvmChain(wallet.provider);
    const call = JSON.parse(built.payload);
    const tx = { from: call.from, data: call.data, value: call.value, chainId: call.chainId };
    if (call.to) tx.to = call.to;
    let hash;
    try {
      hash = await wallet.provider.request({ method: "eth_sendTransaction", params: [tx] });
    } catch (err) {
      await api("/reject", { reason: (err && err.message) || "Declined in wallet" }).catch(() => {});
      throw new Error(err && err.code === 4001 ? "You declined in your wallet. Nothing was sent." : `The wallet did not send it: ${(err && err.message) || err}`);
    }
    const view = await api("/submit", { transactionHash: hash });
    showResult(view);
    poll();
  }

  function link(href, label) { return node("a", { className: "btn btn-ghost btn-small", href, textContent: label, target: "_blank", rel: "noopener noreferrer" }); }

  const RESULT_TITLES = { submitted: "Sent. Waiting for the network…", confirmed: "Confirmed onchain", failed: "It didn't go through", expired: "This request expired" };

  function showResult(view) {
    setStatus(view.status);
    $("wallets").hidden = true;
    $("preview").hidden = true;
    $("result").hidden = false;
    text($("result-title"), RESULT_TITLES[view.status] || view.status);
    if (view.status === "confirmed") setBadge("Confirmed onchain", "ok");
    else if (view.status === "failed") setBadge("Failed", "bad");
    else if (view.status === "submitted") setBadge("Sent", "wait");
    const body = [];
    if (view.status === "submitted") body.push(node("p", { className: "wallet-note", textContent: "Signed by your wallet and sent. promptfun.fun is reading it back from the chain." }));
    if (view.receipt) {
      const ok = view.receipt.status === "success";
      body.push(node("p", { className: "wallet-note", textContent: ok ? "Checked against the chain:" : "What the chain shows:" }));
      body.push(node("ul", { className: ok ? "pv-list" : "pv-list is-plain" }, view.receipt.verified.map((v) => node("li", { textContent: v }))));
      if (view.receipt.tokenAddress) body.push(node("p", { className: "result-meta" }, ["Token ", node("code", { textContent: view.receipt.tokenAddress })]));
      body.push(node("p", { className: "result-meta", textContent: `Block/slot ${view.receipt.slotOrBlock} · network fee paid ${view.receipt.fee} ${view.receipt.feeSymbol}` }));
    }
    if (view.transaction) body.push(node("p", { className: "result-meta" }, ["Transaction ", node("code", { textContent: view.transaction.id })]));
    if (view.error && view.status !== "confirmed") body.push(node("p", { className: "warn-box", textContent: view.error }));
    const links = [];
    if (view.transaction && view.transaction.explorerUrl) links.push(link(view.transaction.explorerUrl, "View transaction"));
    if (view.receipt && view.receipt.tokenExplorerUrl) links.push(link(view.receipt.tokenExplorerUrl, "View token"));
    if (links.length) body.push(node("div", { className: "result-links" }, links));
    if (view.receipt) body.push(node("p", { className: "result-meta", textContent: "You can go back to the chat now." }));
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
    setBadge("Cancelled", "wait");
  });

  api("").then((view) => {
    if (["submitted", "confirmed", "failed", "expired"].includes(view.status)) {
      $("wallets").hidden = true;
      if (view.status === "expired") { setStatus("expired"); setBadge("Expired", "wait"); setError("This request expired. Nothing was sent. Ask again in the chat."); }
      else { showResult(view); if (view.status === "submitted") poll(); }
    }
  }).catch((err) => setError(err.message));
})();

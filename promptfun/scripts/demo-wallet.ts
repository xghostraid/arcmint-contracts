import type { Page } from "playwright-core";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

/**
 * A Wallet Standard test wallet for demos and browser tests. It stands in for Phantom: the approval page discovers it
 * the same way. The key lives in this Node process (the "wallet"), never in promptfun's server or the page.
 * Every signature request shows a visible prompt labelled as a test wallet.
 */
export async function installDemoWallet(page: Page, keypair: Keypair, chains: string[]): Promise<void> {
  await page.exposeFunction("__pfDemoAddress", () => keypair.publicKey.toBase58());
  await page.exposeFunction("__pfDemoSign", (b64: string) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    tx.sign([keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  });
  // Plain JS source: a serialized TS function would carry bundler helpers that do not exist in the page.
  await page.addInitScript({ content: `(${WALLET_SOURCE})(${JSON.stringify(chains)});` });
}

const WALLET_SOURCE = String.raw`function (walletChains) {
  var icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5b3df5"/><text x="16" y="21" font-size="13" text-anchor="middle" fill="#fff" font-family="sans-serif">TW</text></svg>');
  function toB64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function fromB64(text) { return Uint8Array.from(atob(text), function (c) { return c.charCodeAt(0); }); }
  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function unb58(s) {
    var n = 0n;
    for (var ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
    var out = [];
    while (n > 0n) { out.unshift(Number(n % 256n)); n = n / 256n; }
    for (var c of s) { if (c !== "1") break; out.unshift(0); }
    return new Uint8Array(out);
  }
  function prompt() {
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.id = "demo-wallet-prompt";
      box.setAttribute("style", "position:fixed;right:24px;top:24px;width:340px;z-index:99999;background:#1b1530;color:#fff;border-radius:14px;padding:16px 18px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)");
      box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Demo test wallet</div>' +
        '<div style="opacity:.85;margin-bottom:10px">Stands in for Phantom in this recording. Devnet key held by the test harness, not by promptfun.</div>' +
        '<div style="margin-bottom:12px">Sign this transaction?</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button id="demo-wallet-reject" style="padding:8px 14px;border-radius:8px;border:1px solid #6b6290;background:transparent;color:#fff">Reject</button>' +
        '<button id="demo-wallet-approve" style="padding:8px 14px;border-radius:8px;border:0;background:#8f7bff;color:#fff;font-weight:600">Sign</button></div>';
      document.body.append(box);
      box.querySelector("#demo-wallet-approve").addEventListener("click", function () { box.remove(); resolve(true); });
      box.querySelector("#demo-wallet-reject").addEventListener("click", function () { box.remove(); resolve(false); });
    });
  }
  var wallet = {
    version: "1.0.0",
    name: "Demo test wallet",
    icon: icon,
    chains: walletChains,
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async function () {
          var address = await window.__pfDemoAddress();
          var account = { address: address, publicKey: unb58(address), chains: walletChains, features: ["solana:signTransaction"] };
          wallet.accounts = [account];
          return { accounts: [account] };
        }
      },
      "standard:events": { version: "1.0.0", on: function () { return function () {}; } },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async function () {
          var inputs = Array.prototype.slice.call(arguments);
          if (!(await prompt())) throw new Error("User rejected the request.");
          var out = [];
          for (var input of inputs) out.push({ signedTransaction: fromB64(await window.__pfDemoSign(toB64(input.transaction))) });
          return out;
        }
      }
    }
  };
  window.addEventListener("wallet-standard:app-ready", function (event) { event.detail.register(wallet); });
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: function (api) { api.register(wallet); } }));
}`;

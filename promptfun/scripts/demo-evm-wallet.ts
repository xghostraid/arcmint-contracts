import type { Page } from "playwright-core";
import { createWalletClient, defineChain, http, type Hex, type PrivateKeyAccount } from "viem";

export interface DemoEvmChain {
  id: number;
  name: string;
  rpcUrl: string;
}

/**
 * An EIP-6963 test wallet for demos and browser tests. It stands in for MetaMask: the approval page discovers it the
 * same way. The key lives in this Node process (the "wallet"), never in promptfun's server or the page.
 * Every send request shows a visible prompt labelled as a test wallet.
 */
export async function installDemoEvmWallet(page: Page, account: PrivateKeyAccount, chains: DemoEvmChain[]): Promise<void> {
  let current = chains[0];
  const viemChain = (c: DemoEvmChain) =>
    defineChain({ id: c.id, name: c.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } });

  await page.exposeFunction("__pfEvmRequest", async (method: string, params: any[] = []) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return `0x${current.id.toString(16)}`;
      case "wallet_switchEthereumChain": {
        const next = chains.find((c) => c.id === Number(BigInt(params[0].chainId)));
        if (!next) throw Object.assign(new Error("Unrecognized chain."), { code: 4902 });
        current = next;
        return null;
      }
      case "wallet_addEthereumChain":
        throw Object.assign(new Error("The demo wallet only knows its configured chains."), { code: 4001 });
      case "eth_sendTransaction": {
        const tx = params[0];
        if (tx.from.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("Unknown account."), { code: 4100 });
        if (tx.chainId && Number(BigInt(tx.chainId)) !== current.id) throw Object.assign(new Error("Wrong chain."), { code: 4901 });
        const wallet = createWalletClient({ account, chain: viemChain(current), transport: http(current.rpcUrl) });
        return wallet.sendTransaction({ to: tx.to ?? undefined, data: tx.data as Hex, value: BigInt(tx.value ?? 0) } as never);
      }
      default:
        throw Object.assign(new Error(`The demo wallet does not support ${method}.`), { code: 4200 });
    }
  });
  await page.addInitScript({ content: `(${WALLET_SOURCE})();` });
}

// Plain JS source: a serialized TS function would carry bundler helpers that do not exist in the page.
const WALLET_SOURCE = String.raw`function () {
  var icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e2761b"/><text x="16" y="21" font-size="13" text-anchor="middle" fill="#fff" font-family="sans-serif">TW</text></svg>');
  function prompt() {
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.id = "demo-wallet-prompt";
      box.setAttribute("style", "position:fixed;right:24px;top:24px;width:340px;z-index:99999;background:#2a1a0c;color:#fff;border-radius:14px;padding:16px 18px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)");
      box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Demo test wallet (EVM)</div>' +
        '<div style="opacity:.85;margin-bottom:10px">Stands in for MetaMask in this recording. Test key held by the test harness, not by promptfun.</div>' +
        '<div style="margin-bottom:12px">Send this transaction?</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button id="demo-wallet-reject" style="padding:8px 14px;border-radius:8px;border:1px solid #8a6a4a;background:transparent;color:#fff">Reject</button>' +
        '<button id="demo-wallet-approve" style="padding:8px 14px;border-radius:8px;border:0;background:#f6851b;color:#fff;font-weight:600">Send</button></div>';
      document.body.append(box);
      box.querySelector("#demo-wallet-approve").addEventListener("click", function () { box.remove(); resolve(true); });
      box.querySelector("#demo-wallet-reject").addEventListener("click", function () { box.remove(); resolve(false); });
    });
  }
  var provider = {
    request: async function (args) {
      if (args.method === "eth_sendTransaction" && !(await prompt())) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      try {
        return await window.__pfEvmRequest(args.method, args.params || []);
      } catch (err) {
        var m = /code[^0-9]*([0-9]{4})/.exec(String(err && err.message));
        throw Object.assign(new Error(String(err && err.message)), { code: m ? Number(m[1]) : 4001 });
      }
    },
    on: function () {},
    removeListener: function () {}
  };
  var info = Object.freeze({ uuid: "6f1c3d0e-5b7a-4c39-9d2e-7a1f0b9c2e41", name: "Demo test wallet (EVM)", icon: icon, rdns: "fun.promptfun.demo" });
  function announce() { window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: info, provider: provider }) })); }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}`;

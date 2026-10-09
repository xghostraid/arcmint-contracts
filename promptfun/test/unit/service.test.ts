import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import "../../src/chains/index.js";
import { allChains } from "../../src/chains/registry.js";
import { IntentService } from "../../src/intents/service.js";
import { IntentStore } from "../../src/intents/store.js";
import { usdValue } from "../../src/util/price.js";

function service(env: Record<string, string> = {}) {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_ENABLE_LOCALNET: "1", ...env });
  return new IntentService(config, new IntentStore(":memory:"));
}
const to = Keypair.generate().publicKey.toBase58();

test("launch input is normalised and checked before any network call", async () => {
  const s = service();
  const intent = await s.prepareLaunch({ chain: "solana-devnet", name: " My Coin ", symbol: "myc", supply: "1,000,000" });
  assert.equal(intent.status, "awaiting_wallet");
  assert.deepEqual([(intent.params as any).name, (intent.params as any).symbol, (intent.params as any).supply, (intent.params as any).decimals], ["My Coin", "MYC", "1000000", 9]);
  assert.match(intent.id, /^int_[a-f0-9]{32}$/);
  assert.equal(Date.parse(intent.expiresAt) - Date.parse(intent.createdAt), 15 * 60 * 1000);

  await assert.rejects(s.prepareLaunch({ chain: "solana-devnet", name: "x", symbol: "TOO-LONG-SYM" }), /symbol/);
  await assert.rejects(s.prepareLaunch({ chain: "solana-devnet", name: "promptfun official", symbol: "OK" }), /promptfun name/);
  await assert.rejects(s.prepareLaunch({ chain: "solana-devnet", name: "Not USDC", symbol: "USDC" }), /major token/);
  await assert.rejects(s.prepareLaunch({ chain: "solana-devnet", name: "Huge", symbol: "HUGE", supply: "100000000000", decimals: 9 }), /too large/);
  await assert.rejects(s.prepareLaunch({ chain: "solana-devnet", name: "Link", symbol: "LNK", metadataUri: "javascript:alert(1)" }), /metadata link/);
  await assert.rejects(s.prepareLaunch({ chain: "nowhere", name: "A", symbol: "A" }), /Unknown chain/);
});

test("gated and unbuilt chains refuse with the reason", async () => {
  const s = service();
  await assert.rejects(s.prepareLaunch({ chain: "solana-mainnet", name: "P", symbol: "P", metadataUri: "https://x.io/m.json" }), /Mainnet is off/);
  await assert.rejects(s.prepareTransfer({ chain: "robinhood", asset: "native", amount: "1", to: "0x0000000000000000000000000000000000000001" }), /Mainnet is off/);
  const rh = await s.prepareTransfer({ chain: "robinhood-testnet", asset: "native", amount: "0.001", to: "0x0000000000000000000000000000000000000001" });
  assert.equal(rh.status, "awaiting_wallet");
  await assert.rejects(s.prepareTransfer({ chain: "robinhood-testnet", asset: "native", amount: "1", to: "0x0000000000000000000000000000000000000000" }), /not a Robinhood Chain Testnet wallet address/);
  const pump = service({ PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1" });
  await assert.rejects(pump.prepareLaunch({ chain: "solana-mainnet", name: "P", symbol: "PP" }), /metadata link/);
  await assert.rejects(pump.prepareLaunch({ chain: "solana-mainnet", name: "P", symbol: "PP", supply: "5", metadataUri: "https://x.io/m.json" }), /1,000,000,000/);
  await assert.rejects(pump.prepareTransfer({ chain: "solana-mainnet", asset: "native", amount: "1", to }), /does not support transfers/);
});

test("transfer amounts are checked against the native decimals", async () => {
  const s = service();
  await assert.rejects(s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "0.0000000001", to }), /decimal places/);
  await assert.rejects(s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "0", to }), /more than zero/);
  await assert.rejects(s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to: "nope" }), /not a Solana/);
});

test("the same live request is deduplicated; a finished one is not", async () => {
  const s = service();
  const a = await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  const b = await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  assert.equal(a.id, b.id);
  s.store.save({ ...a, status: "confirmed" });
  const c = await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  assert.notEqual(c.id, a.id);
});

test("intents expire and cannot be built after expiry", async () => {
  const s = service({ PROMPTFUN_INTENT_TTL_MS: "1" });
  const a = await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.get(a.id).status, "expired");
  await assert.rejects(s.build(a.id, to), /already expired/);
});

test("intent creation is rate limited", async () => {
  const s = service({ PROMPTFUN_MAX_INTENTS_PER_HOUR: "2" });
  await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "1", to });
  await s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "2", to });
  await assert.rejects(s.prepareTransfer({ chain: "solana-localnet", asset: "native", amount: "3", to }), /Too many/);
});

test("EVM priority order and Robinhood Chain values match the official docs", () => {
  const chains = allChains(loadConfig({}));
  const evm = chains.filter((c) => c.family === "evm") as any[];
  const firstThree = [...new Set(evm.filter((c) => c.priority >= 1 && c.priority <= 3).sort((a, b) => a.priority - b.priority).map((c) => c.name.split(" ")[0]))];
  assert.deepEqual(firstThree, ["Ethereum", "Robinhood", "Base"]);
  const rh = evm.find((c) => c.key === "robinhood-testnet");
  assert.deepEqual([rh.chainId, rh.rpcUrl, rh.explorerUrl, rh.status], [46630, "https://rpc.testnet.chain.robinhood.com", "https://explorer.testnet.chain.robinhood.com", "verified"]);
  const rhMain = evm.find((c) => c.key === "robinhood");
  assert.deepEqual([rhMain.chainId, rhMain.status], [4663, "gated"]);
  assert.ok(evm.filter((c) => !c.testnet).every((c) => c.status === "gated"));
});

test("no USD is invented for testnets or unknown symbols", async () => {
  assert.equal(await usdValue("SOL", "1", true), null);
  assert.equal(await usdValue("NOPE", "1", false), null);
});

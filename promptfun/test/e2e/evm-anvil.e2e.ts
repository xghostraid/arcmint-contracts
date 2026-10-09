import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, getAddress, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { post, startHarness, waitForFinal, type Harness } from "./harness.js";

const RPC = process.env.PROMPTFUN_RPC_EVM_LOCALNET || "http://127.0.0.1:8545";
const anvil = defineChain({ id: 31337, name: "Anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain: anvil, transport: http(RPC) });
// Anvil's dev accounts are unlocked, so the node signs and no key appears in this test.
const wallet = createWalletClient({ chain: anvil, transport: http(RPC) });
let h: Harness;
let user: Hex;
let other: Hex;
const friend = privateKeyToAddress(generatePrivateKey());

/** Plays the user's wallet against the approval API the way approve.js does: /build, eth_sendTransaction, /submit. */
async function approveWithAnvil(intentId: string, from: Hex, tamper?: (call: any) => any): Promise<any> {
  const built = await post(h.base, `/api/intents/${intentId}/build`, { account: from });
  let call = JSON.parse(built.built.payload);
  if (tamper) call = tamper(call);
  const hash = await wallet.sendTransaction({
    account: call.from,
    to: call.to ?? undefined,
    data: call.data,
    value: BigInt(call.value),
    chain: anvil,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
  const submitted = await post(h.base, `/api/intents/${intentId}/submit`, { transactionHash: hash });
  return { built, submitted, hash };
}

before(async () => {
  [user, other] = await wallet.getAddresses();
  h = await startHarness({ PROMPTFUN_ENABLE_LOCALNET: "1" });
});

after(async () => {
  await h?.close();
});

let token: Hex;

test("capabilities list EVM chains in priority order with honest status", async () => {
  const r = await h.call("get_capabilities", {});
  const local = r.data.chains.find((c: any) => c.key === "evm-localnet");
  assert.deepEqual([local.enabled, local.status, local.chainId], [true, "verified", 31337]);
  for (const key of ["ethereum-sepolia", "robinhood-testnet", "base-sepolia"]) {
    const chain = r.data.chains.find((c: any) => c.key === key);
    assert.deepEqual([chain.enabled, chain.status], [true, "configured"], key);
  }
  const mainnet = r.data.chains.find((c: any) => c.key === "robinhood");
  assert.deepEqual([mainnet.enabled, mainnet.status], [false, "gated"]);
});

test("deploy a fixed-supply ERC-20 through MCP + approval API, verified from chain", async () => {
  const prep = await h.call("prepare_launch", { chain: "evm-localnet", name: "Anvil Proof", symbol: "APROOF", supply: "1000000" });
  assert.equal(prep.isError, false, prep.text);
  const { built } = await approveWithAnvil(prep.data.intentId, user);
  const preview = built.view.preview;
  assert.equal(preview.simulationOk, true);
  assert.match(preview.steps.join("\n"), /Deploy a new ERC-20.*\n.*"Anvil Proof", symbol APROOF, 18 decimals[\s\S]*Mint 1,000,000 APROOF once[\s\S]*supply is fixed forever/);
  assert.match(preview.feeLabel, /paid to Local EVM \(Anvil\), not promptfun/);
  assert.ok(Number(preview.networkFee) > 0);
  assert.equal(preview.usd, null);

  const done = await waitForFinal(h, prep.data.intentId);
  assert.equal(done.data.status, "confirmed", done.text);
  const verified = done.data.receipt.verified.join("\n");
  assert.match(verified, /Deployed code is byte-identical/);
  assert.match(verified, /Supply on chain is 1,000,000 APROOF/);
  assert.match(verified, /Your wallet holds the full supply/);
  token = done.data.receipt.tokenAddress;
  assert.equal(await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [user] }), parseEther("1000000"));
});

test("send the launched token and ETH, each verified from chain", async () => {
  const spl = await h.call("prepare_transfer", { chain: "evm-localnet", asset: token, amount: "1234.5", to: friend });
  assert.equal(spl.isError, false, spl.text);
  await approveWithAnvil(spl.data.intentId, user);
  const splDone = await waitForFinal(h, spl.data.intentId);
  assert.equal(splDone.data.status, "confirmed", splDone.text);
  assert.match(splDone.data.receipt.verified.join("\n"), /received 1,234.5 APROOF \(Transfer event/);
  assert.equal(await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [friend] }), parseEther("1234.5"));

  const native = await h.call("prepare_transfer", { chain: "evm-localnet", asset: "ETH", amount: 0.25, to: friend });
  assert.equal(native.isError, false, native.text);
  await approveWithAnvil(native.data.intentId, user);
  const nativeDone = await waitForFinal(h, native.data.intentId);
  assert.equal(nativeDone.data.status, "confirmed", nativeDone.text);
  assert.equal(await pub.getBalance({ address: friend }), parseEther("0.25"));
});

test("a sent transaction that differs from the preview is reported as a mismatch, never as success", async () => {
  const prep = await h.call("prepare_transfer", { chain: "evm-localnet", asset: "native", amount: "0.01", to: friend });
  const thief = getAddress(`0x${"0d".repeat(20)}`);
  await approveWithAnvil(prep.data.intentId, user, (call) => ({ ...call, to: thief }));
  const done = await waitForFinal(h, prep.data.intentId);
  assert.equal(done.data.status, "failed");
  assert.match(done.data.receipt.verified.join("\n"), /MISMATCH: your wallet sent a different transaction/);
});

test("a hash sent by another account is refused", async () => {
  const prep = await h.call("prepare_transfer", { chain: "evm-localnet", asset: "native", amount: "0.02", to: friend });
  await post(h.base, `/api/intents/${prep.data.intentId}/build`, { account: user });
  const hash = await wallet.sendTransaction({ account: other, to: friend, value: 1n, chain: anvil } as never);
  await pub.waitForTransactionReceipt({ hash });
  await assert.rejects(post(h.base, `/api/intents/${prep.data.intentId}/submit`, { transactionHash: hash }), (err: any) => err.code === "mismatch");
});

test("EVM-specific bad inputs are refused with plain reasons", async () => {
  const meta = await h.call("prepare_launch", { chain: "evm-localnet", name: "Meta", symbol: "META", metadataUri: "https://example.com/m.json" });
  assert.match(meta.text, /no on-chain metadata link/);
  const mintable = await h.call("prepare_launch", { chain: "evm-localnet", name: "Mintable", symbol: "MINT", fixedSupply: false });
  assert.match(mintable.text, /always fixed supply/);
  const lower = await h.call("prepare_transfer", { chain: "evm-localnet", asset: "native", amount: "1", to: "0x00000000000000000000000000000000000000Ab" });
  assert.match(lower.text, /not a Local EVM \(Anvil\) wallet address/);
  const noToken = await h.call("prepare_transfer", { chain: "evm-localnet", asset: friend, amount: "1", to: friend });
  assert.match(noToken.text, /no contract/);
  const poor = await h.call("prepare_transfer", { chain: "evm-localnet", asset: "native", amount: "1", to: friend });
  const broke = privateKeyToAddress(generatePrivateKey());
  await assert.rejects(post(h.base, `/api/intents/${poor.data.intentId}/build`, { account: broke }), /Not enough ETH/);
});

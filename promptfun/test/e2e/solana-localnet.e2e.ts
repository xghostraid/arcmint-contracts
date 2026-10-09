import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { approveWithKeypair, post, startHarness, waitForFinal, type Harness } from "./harness.js";

const RPC = process.env.PROMPTFUN_RPC_SOLANA_LOCALNET || "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
let h: Harness;
const wallet = Keypair.generate();
const friend = Keypair.generate();

before(async () => {
  await conn.getVersion();
  const sig = await conn.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  h = await startHarness({ PROMPTFUN_ENABLE_LOCALNET: "1" });
});

after(async () => {
  await h?.close();
});

let mint = "";

test("capabilities list Solana chains with honest status", async () => {
  const r = await h.call("get_capabilities", {});
  const local = r.data.chains.find((c: any) => c.key === "solana-localnet");
  assert.equal(local.enabled, true);
  assert.equal(local.status, "verified");
  const robinhood = r.data.chains.find((c: any) => c.key === "robinhood-testnet");
  assert.equal(robinhood.chainId, 46630);
  assert.equal(robinhood.status, "verified");
  assert.equal(r.data.promptfunFee, "0");
});

test("launch a Token-2022 coin through MCP + approval API, verified from chain", async () => {
  const prep = await h.call("prepare_launch", { chain: "solana-localnet", name: "Local Proof", symbol: "LPROOF", supply: "1000000", decimals: 6 });
  assert.equal(prep.isError, false, prep.text);
  assert.equal(prep.data.status, "awaiting_wallet");
  assert.match(prep.data.approveUrl, /\/approve\/int_[a-f0-9]{32}$/);

  const { built } = await approveWithKeypair(h.base, prep.data.intentId, wallet);
  const preview = built.view.preview;
  assert.equal(preview.simulationOk, true, preview.simulationError);
  assert.match(preview.feeLabel, /^Network fee \(paid to .*not promptfun\)$/);
  assert.equal(preview.networkFee, "0.000005");
  assert.ok(Number(preview.deposits) > 0);
  assert.equal(preview.promptfunFee, "0");
  assert.equal(preview.usd, null);

  const done = await waitForFinal(h, prep.data.intentId);
  assert.equal(done.data.status, "confirmed", done.text);
  assert.ok(done.data.receipt.verified.every((v: string) => !v.startsWith("MISMATCH")));
  mint = done.data.receipt.tokenAddress;
  const bal = await h.call("get_balance", { chain: "solana-localnet", address: wallet.publicKey.toBase58(), token: mint });
  assert.equal(bal.data.amount, "1,000,000");
});

test("send the launched token and SOL, each verified from chain", async () => {
  const spl = await h.call("prepare_transfer", { chain: "solana-localnet", asset: mint, amount: "1234.5", to: friend.publicKey.toBase58() });
  assert.equal(spl.isError, false, spl.text);
  await approveWithKeypair(h.base, spl.data.intentId, wallet);
  const splDone = await waitForFinal(h, spl.data.intentId);
  assert.equal(splDone.data.status, "confirmed", splDone.text);

  const native = await h.call("prepare_transfer", { chain: "solana-localnet", asset: "native", amount: 0.25, to: friend.publicKey.toBase58() });
  assert.equal(native.isError, false, native.text);
  await approveWithKeypair(h.base, native.data.intentId, wallet);
  const nativeDone = await waitForFinal(h, native.data.intentId);
  assert.equal(nativeDone.data.status, "confirmed", nativeDone.text);
  assert.equal(await conn.getBalance(friend.publicKey), 0.25 * LAMPORTS_PER_SOL);
});

test("a signed transaction that differs from the preview is refused and never sent", async () => {
  const prep = await h.call("prepare_transfer", { chain: "solana-localnet", asset: "native", amount: "0.01", to: friend.publicKey.toBase58() });
  const thief = Keypair.generate().publicKey;
  await assert.rejects(
    approveWithKeypair(h.base, prep.data.intentId, wallet, (tx) => {
      const msg = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: tx.message.recentBlockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: thief, lamports: 10_000_000 })],
      }).compileToLegacyMessage();
      return new VersionedTransaction(msg);
    }),
    (err: any) => err.code === "mismatch",
  );
  assert.equal(await conn.getBalance(thief), 0);
  const status = await h.call("get_action_status", { intentId: prep.data.intentId });
  assert.equal(status.data.status, "built");
});

test("an unsigned submission is refused", async () => {
  const prep = await h.call("prepare_transfer", { chain: "solana-localnet", asset: "native", amount: "0.02", to: friend.publicKey.toBase58() });
  const built = await post(h.base, `/api/intents/${prep.data.intentId}/build`, { account: wallet.publicKey.toBase58() });
  await assert.rejects(
    post(h.base, `/api/intents/${prep.data.intentId}/submit`, { signedTransaction: built.built.payload }),
    (err: any) => err.code === "signature",
  );
});

test("bad inputs are refused with plain reasons", async () => {
  const badAddr = await h.call("prepare_transfer", { chain: "solana-localnet", asset: "native", amount: "1", to: "not-an-address" });
  assert.equal(badAddr.isError, true);
  const tooPrecise = await h.call("prepare_transfer", { chain: "solana-localnet", asset: "native", amount: 1e-10, to: friend.publicKey.toBase58() });
  assert.match(tooPrecise.text, /decimal places/);
  const brand = await h.call("prepare_launch", { chain: "solana-localnet", name: "Prompt Fun Official", symbol: "PF" });
  assert.equal(brand.isError, true);
  const major = await h.call("prepare_launch", { chain: "solana-localnet", name: "Totally Sol", symbol: "SOL" });
  assert.equal(major.isError, true);
  const mainnet = await h.call("prepare_launch", { chain: "solana-mainnet", name: "Gated", symbol: "GATE", metadataUri: "https://example.com/m.json" });
  assert.equal(mainnet.isError, true);
  assert.match(mainnet.text, /off/);
  const evmMainnet = await h.call("prepare_transfer", { chain: "ethereum", asset: "native", amount: "0.1", to: "0x0000000000000000000000000000000000000001" });
  assert.match(evmMainnet.text, /Mainnet is off/);
});

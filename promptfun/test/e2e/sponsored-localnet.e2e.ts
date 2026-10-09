import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { startHarness, waitForFinal, type Harness } from "./harness.js";

const RPC = process.env.PROMPTFUN_RPC_SOLANA_LOCALNET || "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
let h: Harness;
const sponsor = Keypair.generate();

before(async () => {
  await conn.getVersion();
  const sig = await conn.requestAirdrop(sponsor.publicKey, 2 * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  h = await startHarness({
    PROMPTFUN_ENABLE_LOCALNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: JSON.stringify(Array.from(sponsor.secretKey)),
  });
});

after(async () => h?.close());

test("sponsored SPL launch on localnet", async () => {
  const prep = await h.call("prepare_launch", { chain: "solana-localnet", name: "SBeam", symbol: "SBEAM", supply: "500000", decimals: 6 });
  assert.equal(prep.data.status, "awaiting_confirm");
  await h.call("confirm_launch_by_text", { intentId: prep.data.intentId });
  assert.equal((await waitForFinal(h, prep.data.intentId)).data.status, "confirmed");
});

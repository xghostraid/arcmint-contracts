import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import { checkSolanaSponsorPolicy } from "../../src/sponsor/policy.js";
import type { Built, Intent } from "../../src/intents/types.js";

test("sponsor policy refuses high outflow", () => {
  const sponsor = Keypair.generate().publicKey;
  const msg = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: Keypair.generate().publicKey, lamports: 50_000_000 })],
  }).compileToLegacyMessage();
  const built: Built = {
    signer: sponsor.toBase58(),
    payload: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"),
    digest: "",
    steps: [],
    simulation: { ok: true, error: null, logs: [], unitsConsumed: null, at: new Date().toISOString() },
    cost: { label: "x", networkFee: "0.05", feeBasis: "", deposits: "0", sends: "0", total: "0.05", symbol: "SOL", balance: "1", enough: true, note: null, usd: null, usdSource: null, promptfunFee: "0" },
    builtAt: new Date().toISOString(),
    validUntil: null,
    tokenAddress: null,
    extraSigners: [],
  };
  const config = loadConfig({ PROMPTFUN_SPONSOR_MAX_LAMPORTS: String(Math.floor(Number(LAMPORTS_PER_SOL) / 100)) });
  assert.equal(checkSolanaSponsorPolicy(config, { kind: "launch_token" } as Intent, built, built.payload, sponsor.toBase58()).ok, false);
});

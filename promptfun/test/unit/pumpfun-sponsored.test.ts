import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildPumpfunLaunchSponsored } from "../../src/chains/solana/pumpfun.js";
import { decodeInstructions } from "../../src/chains/solana/decode.js";
import type { Intent, LaunchParams } from "../../src/intents/types.js";

test("sponsored pump.fun build compiles three instructions that decode", async () => {
  const sponsor = Keypair.generate().publicKey;
  const feeRecipient = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  const params: LaunchParams = {
    name: "Test Coin",
    symbol: "TST",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri: "https://example.com/meta.json",
    fixedSupply: true,
    venue: "pumpfun",
    feeRecipient: feeRecipient.toBase58(),
  };
  const intent: Intent = {
    id: "int_test",
    kind: "launch_token",
    chain: "solana-devnet",
    family: "solana",
    params,
    summary: "test",
    status: "awaiting_wallet",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    built: null,
    submission: null,
    receipt: null,
    error: null,
    events: [],
    idempotencyKey: "k",
    executionMode: "wallet",
    instructionFingerprint: null,
  };

  const compiled = await buildPumpfunLaunchSponsored({} as never, intent, sponsor, feeRecipient, mintKp);
  assert.equal(compiled.instructions.length, 3);

  const message = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: compiled.instructions,
  }).compileToLegacyMessage();
  const decoded = decodeInstructions(TransactionMessage.decompile(message).instructions, compiled.mints);
  compiled.check(decoded);
  assert.ok(decoded.pumpCreate);
  assert.ok(decoded.pumpFeeSharing?.created);
  assert.ok(decoded.pumpFeeSharing?.updated);

  assert.equal(decoded.steps.length, 3);
});

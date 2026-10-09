import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildPumpfunLaunchSponsored } from "../../src/chains/solana/pumpfun.js";
import { SOLANA_TX_BASE64_MAX, SOLANA_TX_RAW_MAX } from "../../src/chains/solana/tx-size.js";
import { decodeInstructions } from "../../src/chains/solana/decode.js";
import type { Intent, LaunchParams } from "../../src/intents/types.js";

test("sponsored pump.fun build compiles three instructions that decode", async () => {
  const sponsor = Keypair.generate().publicKey;
  const feeRecipient = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  const params: LaunchParams = {
    name: "Test",
    symbol: "TST",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri: "http://127.0.0.1:8787/m/pic_000000000000000000000000",
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

  const tx = new VersionedTransaction(message);
  const raw = tx.serialize();
  assert.ok(raw.length <= SOLANA_TX_RAW_MAX, `raw tx ${raw.length} > ${SOLANA_TX_RAW_MAX}`);
  assert.ok(Buffer.from(raw).toString("base64").length <= SOLANA_TX_BASE64_MAX);
});

test("sponsored pump.fun rejects oversized metadata URI before simulate", async () => {
  const sponsor = Keypair.generate().publicKey;
  const feeRecipient = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  const params: LaunchParams = {
    name: "A Very Long Token Name Here!!!!",
    symbol: "LONGSYMBOL",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri: "ipfs://bafybeigdyrzt5sfp7udm17uh4l0y5qenqwf2jq4vxqjq4vxqjq4vxqjq4extra",
    fixedSupply: true,
    venue: "pumpfun",
    feeRecipient: feeRecipient.toBase58(),
  };
  const intent: Intent = {
    id: "int_big",
    kind: "launch_token",
    chain: "solana-mainnet",
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
    idempotencyKey: "k2",
    executionMode: "wallet",
    instructionFingerprint: null,
  };
  await assert.rejects(
    () => buildPumpfunLaunchSponsored({} as never, intent, sponsor, feeRecipient, mintKp),
    /transaction too large/i,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildPumpfunLaunchSponsored, patchLaunchUpdateFeeSharesAccounts } from "../../src/chains/solana/pumpfun.js";
import { SOLANA_TX_BASE64_MAX, SOLANA_TX_RAW_MAX } from "../../src/chains/solana/tx-size.js";
import { decodeInstructions } from "../../src/chains/solana/decode.js";
import type { Intent, LaunchParams } from "../../src/intents/types.js";

test("patchLaunchUpdateFeeSharesAccounts adds remaining account when shareholder is authority", async () => {
  const sponsor = Keypair.generate().publicKey;
  const { createRequire } = await import("node:module");
  const { PUMP_SDK } = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
  const mint = Keypair.generate().publicKey;
  const ix = await PUMP_SDK.updateFeeShares({
    authority: sponsor,
    mint,
    currentShareholders: [],
    newShareholders: [{ address: sponsor, shareBps: 10_000 }],
    bondingCurveComplete: false,
  });
  assert.equal(
    ix.keys.some((k) => k.pubkey.equals(sponsor) && k.isWritable && !k.isSigner),
    false,
  );
  patchLaunchUpdateFeeSharesAccounts(ix, [{ address: sponsor }]);
  assert.ok(ix.keys.some((k) => k.pubkey.equals(sponsor) && k.isWritable && !k.isSigner));
});

test("sponsored pump.fun build compiles primary + follow-up fee shares", async () => {
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

  const compiled = await buildPumpfunLaunchSponsored({} as never, intent, sponsor, mintKp);
  assert.equal(compiled.instructions.length, 2);
  assert.equal(compiled.followUpInstructions?.length, 1);

  const message = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: compiled.instructions,
  }).compileToLegacyMessage();
  const decoded = decodeInstructions(TransactionMessage.decompile(message).instructions, compiled.mints);
  compiled.check(decoded);
  assert.ok(decoded.pumpCreate);
  assert.ok(decoded.pumpFeeSharing?.created);
  assert.equal(decoded.pumpFeeSharing?.updated, false);

  assert.equal(decoded.steps.length, 2);

  const tx = new VersionedTransaction(message);
  const raw = tx.serialize();
  assert.ok(raw.length <= SOLANA_TX_RAW_MAX, `raw tx ${raw.length} > ${SOLANA_TX_RAW_MAX}`);
  assert.ok(Buffer.from(raw).toString("base64").length <= SOLANA_TX_BASE64_MAX);

  const followMsg = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: compiled.followUpInstructions!,
  }).compileToLegacyMessage();
  const followDecoded = decodeInstructions(TransactionMessage.decompile(followMsg).instructions, compiled.mints);
  compiled.checkFollowUp(followDecoded);
  assert.ok(followDecoded.pumpFeeSharing?.updated);
});

test("sponsored pump.fun with two fee shareholders stages follow-up tx under size limit", async () => {
  const sponsor = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const treasury = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  const pic = "pic_000000000000000000000000";
  const params: LaunchParams = {
    name: "PCAT",
    symbol: "PCAT",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri: `https://promptfun.fun/m/${pic}`,
    fixedSupply: true,
    venue: "pumpfun",
    feeRecipient: creator.toBase58(),
    feeShareholders: [
      { address: creator.toBase58(), shareBps: 5000 },
      { address: treasury.toBase58(), shareBps: 5000 },
    ],
  };
  const intent: Intent = {
    id: "int_tier",
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
    idempotencyKey: "k-tier",
    executionMode: "sponsor",
    instructionFingerprint: null,
  };

  const compiled = await buildPumpfunLaunchSponsored({} as never, intent, sponsor, mintKp);
  assert.equal(compiled.instructions.length, 2);
  assert.ok(compiled.followUpInstructions?.length === 1);

  const primaryMsg = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: compiled.instructions,
  }).compileToLegacyMessage();
  const primaryRaw = new VersionedTransaction(primaryMsg).serialize();
  assert.ok(primaryRaw.length <= SOLANA_TX_RAW_MAX, `primary raw ${primaryRaw.length}`);
  assert.ok(Buffer.from(primaryRaw).toString("base64").length <= SOLANA_TX_BASE64_MAX);

  const followMsg = new TransactionMessage({
    payerKey: sponsor,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: compiled.followUpInstructions!,
  }).compileToLegacyMessage();
  const followRaw = new VersionedTransaction(followMsg).serialize();
  assert.ok(followRaw.length <= SOLANA_TX_RAW_MAX, `follow-up raw ${followRaw.length}`);
  assert.ok(Buffer.from(followRaw).toString("base64").length <= SOLANA_TX_BASE64_MAX);

  const followDecoded = decodeInstructions(TransactionMessage.decompile(followMsg).instructions, compiled.mints);
  compiled.checkFollowUp(followDecoded);
});

test("sponsored pump.fun rejects oversized metadata URI before simulate", async () => {
  const sponsor = Keypair.generate().publicKey;
  const feeRecipient = Keypair.generate().publicKey;
  const mintKp = Keypair.generate();
  const params: LaunchParams = {
    name: "A Very Long Token Name Here!!!!".repeat(3),
    symbol: "LONGSYMBOL",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri:
      "ipfs://bafybeigdyrzt5sfp7udm17uh4l0y5qenqwf2jq4vxqjq4vxqjq4vxqjq4extra" + "x".repeat(200),
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
    () => buildPumpfunLaunchSponsored({} as never, intent, sponsor, mintKp),
    /transaction too large/i,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SOLANA_TX_BASE64_MAX, SOLANA_TX_RAW_MAX, versionedTxWireSize } from "../../src/chains/solana/tx-size.js";

test("Solana tx size limits match network packet caps", () => {
  assert.equal(SOLANA_TX_RAW_MAX, 1232);
  assert.equal(SOLANA_TX_BASE64_MAX, 1644);
});

test("versionedTxWireSize matches serialized transaction length", () => {
  const payer = Keypair.generate().publicKey;
  const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  const measured = versionedTxWireSize([ix], payer);
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [ix],
  }).compileToLegacyMessage();
  const raw = new VersionedTransaction(msg).serialize();
  assert.equal(measured.raw, raw.length);
  assert.equal(measured.base64, Buffer.from(raw).toString("base64").length);
});

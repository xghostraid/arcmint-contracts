import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import { officialTreasuryPubkey, resolvePumpfunCreatorFeeLock } from "../../src/chains/solana/prompt-tier.js";

const TREASURY = Keypair.generate().publicKey.toBase58();
const CREATOR = Keypair.generate().publicKey.toBase58();

test("pre-mint routes 100% creator fees to official treasury", async () => {
  const config = loadConfig({
    PROMPTFUN_TREASURY_PUBKEY: TREASURY,
  });
  const lock = await resolvePumpfunCreatorFeeLock(config, {} as Connection, CREATOR, undefined);
  assert.equal(lock.preMintTreasuryRouting, true);
  assert.equal(lock.feeRecipient, TREASURY);
  assert.deepEqual(lock.feeShareholders, [{ address: TREASURY, shareBps: 10_000 }]);
  assert.equal(lock.creatorWallet, CREATOR);
});

test("pre-mint without creatorWallet still locks to treasury", async () => {
  const config = loadConfig({
    PROMPTFUN_SPONSOR_FEE_RECIPIENT: TREASURY,
  });
  const lock = await resolvePumpfunCreatorFeeLock(config, {} as Connection, undefined, undefined);
  assert.equal(lock.feeRecipient, TREASURY);
  assert.equal(lock.creatorWallet, undefined);
});

test("officialTreasuryPubkey prefers treasury env over sponsor fee recipient", () => {
  const config = loadConfig({
    PROMPTFUN_TREASURY_PUBKEY: TREASURY,
    PROMPTFUN_SPONSOR_FEE_RECIPIENT: Keypair.generate().publicKey.toBase58(),
  });
  assert.equal(officialTreasuryPubkey(config), TREASURY);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import { loadConfig } from "../../src/config.js";
import {
  officialTreasuryPubkey,
  PROMPTFUN_OFFICIAL_WALLET_PUBKEY,
  PROMPTFUN_PROMPT_MINT_LIVE,
  resolvePumpfunCreatorFeeLock,
} from "../../src/chains/solana/prompt-tier.js";

const TREASURY = Keypair.generate().publicKey.toBase58();
const CREATOR = Keypair.generate().publicKey.toBase58();

/** Tier gate inactive when mint account is missing on chain. */
const connNoMint = {
  getAccountInfo: async () => null,
} as Connection;

test("pre-mint routes 100% creator fees to official treasury", async () => {
  const config = loadConfig({
    PROMPTFUN_TREASURY_PUBKEY: TREASURY,
  });
  const lock = await resolvePumpfunCreatorFeeLock(config, connNoMint, CREATOR, undefined);
  assert.equal(lock.preMintTreasuryRouting, true);
  assert.equal(lock.feeRecipient, TREASURY);
  assert.deepEqual(lock.feeShareholders, [{ address: TREASURY, shareBps: 10_000 }]);
  assert.equal(lock.creatorWallet, CREATOR);
});

test("pre-mint without creatorWallet still locks to treasury", async () => {
  const config = loadConfig({
    PROMPTFUN_SPONSOR_FEE_RECIPIENT: TREASURY,
  });
  const lock = await resolvePumpfunCreatorFeeLock(config, connNoMint, undefined, undefined);
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

test("officialTreasuryPubkey uses production default when env and sponsor unset", () => {
  const config = loadConfig({});
  assert.equal(officialTreasuryPubkey(config), PROMPTFUN_OFFICIAL_WALLET_PUBKEY);
  assert.equal(PROMPTFUN_OFFICIAL_WALLET_PUBKEY, "5YPhpDDtYtKaKnUgSskb4tXKZL9a7rj8siCuMS7qESpv");
});

test("pre-mint with no env locks to production default treasury", async () => {
  const config = loadConfig({});
  const lock = await resolvePumpfunCreatorFeeLock(config, connNoMint, CREATOR, undefined);
  assert.equal(lock.feeRecipient, PROMPTFUN_OFFICIAL_WALLET_PUBKEY);
});

test("loadConfig defaults PROMPTFUN_PROMPT_MINT to live mint when env key absent", () => {
  const config = loadConfig({});
  assert.equal(config.promptMint, PROMPTFUN_PROMPT_MINT_LIVE);
});

test("loadConfig allows disabling prompt mint with empty env", () => {
  const config = loadConfig({ PROMPTFUN_PROMPT_MINT: "" });
  assert.equal(config.promptMint, null);
});

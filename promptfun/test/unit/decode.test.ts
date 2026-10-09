import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createInitializeInstruction } from "@solana/spl-token-metadata";
import { UnknownInstructionError, decodeInstructions, isWalletAddress } from "../../src/chains/solana/decode.js";
import { buildPumpfunLaunch } from "../../src/chains/solana/pumpfun.js";
import type { Intent } from "../../src/intents/types.js";

const user = Keypair.generate().publicKey;

test("a launch decodes back into the facts the preview shows", async () => {
  const seed = "pf0123456789abcdef01234567";
  const mint = await PublicKey.createWithSeed(user, seed, TOKEN_2022_PROGRAM_ID);
  const ata = getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID);
  const ixs = [
    SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: mint, basePubkey: user, seed, lamports: 3_000_000, space: 234, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint, user, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, 6, user, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: user, mint, mintAuthority: user, name: "Test Coin", symbol: "TEST", uri: "https://example.com/t.json" }),
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, TOKEN_2022_PROGRAM_ID),
    createMintToCheckedInstruction(mint, ata, user, 1_000_000_000_000n, 6, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, user, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  ];
  const d = decodeInstructions(ixs, new Map([[mint.toBase58(), { decimals: 6, symbol: "TEST" }]]));
  assert.equal(d.createdMint?.mint, mint.toBase58());
  assert.equal(d.createdMint?.base, user.toBase58());
  assert.equal(d.mintInit?.decimals, 6);
  assert.equal(d.mintInit?.freezeAuthority, null);
  assert.deepEqual([d.metadata?.name, d.metadata?.symbol, d.metadata?.uri], ["Test Coin", "TEST", "https://example.com/t.json"]);
  assert.equal(d.mintedTo?.amount, 1_000_000_000_000n);
  assert.equal(d.mintAuthorityRevoked, true);
  assert.equal(d.steps.length, 7);
  assert.match(d.steps[5].text, /Mint 1,000,000 TEST/);
});

test("transfers decode recipient and amount from the bytes", () => {
  const to = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const d = decodeInstructions([
    SystemProgram.transfer({ fromPubkey: user, toPubkey: to, lamports: 10_000_000 }),
    createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, user), mint, getAssociatedTokenAddressSync(mint, to), user, 2500n, 2),
  ], new Map([[mint.toBase58(), { decimals: 2, symbol: "TKN" }]]));
  assert.deepEqual(d.solTransfers, [{ from: user.toBase58(), to: to.toBase58(), lamports: 10_000_000n }]);
  assert.equal(d.tokenTransfers[0].amount, 2500n);
  assert.match(d.steps[0].text, /Send 0\.01 SOL/);
  assert.match(d.steps[1].text, /Send 25 TKN/);
});

test("anything outside the allowlist is refused, not previewed", () => {
  const unknown = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1, 2, 3]) });
  assert.throws(() => decodeInstructions([unknown], new Map()), UnknownInstructionError);
  const mint = Keypair.generate().publicKey;
  const giveAway = createSetAuthorityInstruction(mint, user, AuthorityType.MintTokens, Keypair.generate().publicKey, [], TOKEN_2022_PROGRAM_ID);
  assert.throws(() => decodeInstructions([giveAway], new Map()), /Only revoking/);
  const assign = SystemProgram.assign({ accountPubkey: user, programId: Keypair.generate().publicKey });
  assert.throws(() => decodeInstructions([assign], new Map()), /not allowed/);
});

test("pump.fun create_v2 decodes from the official SDK's bytes", async () => {
  const mint = Keypair.generate().publicKey;
  const intent = { id: "int_x", params: { name: "Pump Test", symbol: "PTEST", supply: "1000000000", decimals: 6, description: "", metadataUri: "https://example.com/p.json", fixedSupply: true, venue: "pumpfun" } } as unknown as Intent;
  const compiled = await buildPumpfunLaunch(null as never, intent, user, mint.toBase58());
  const d = decodeInstructions(compiled.instructions, compiled.mints);
  compiled.check(d);
  assert.equal(d.pumpCreate?.mint, mint.toBase58());
  assert.equal(d.pumpCreate?.creator, user.toBase58());
  assert.deepEqual(compiled.extraSigners, [mint.toBase58()]);
  await assert.rejects(buildPumpfunLaunch(null as never, intent, user, undefined), /one-time mint key/);
});

test("wallet addresses must be canonical and on the curve", () => {
  assert.equal(isWalletAddress(user.toBase58()), true);
  const pda = PublicKey.findProgramAddressSync([Buffer.from("x")], TOKEN_2022_PROGRAM_ID)[0];
  assert.equal(isWalletAddress(pda.toBase58()), false);
  assert.equal(isWalletAddress("0x0000000000000000000000000000000000000001"), false);
  assert.equal(isWalletAddress(""), false);
});

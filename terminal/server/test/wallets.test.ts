import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { solanaKeys } from "../src/chains/families.js";
import { unlockedStore } from "./helpers.js";

const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("wallets: HD generation is deterministic and continues the index", async () => {
  const { wallets, vault } = await unlockedStore();
  const g = wallets.createGroup("bundle");
  const first = wallets.generate({ count: 3, groupId: g.id, labelPrefix: "B" });
  const next = wallets.generate({ count: 2 });
  assert.deepEqual(first.map((w) => w.hdIndex), [0, 1, 2]);
  assert.deepEqual(next.map((w) => w.hdIndex), [3, 4]);
  assert.equal(new Set([...first, ...next].map((w) => w.address)).size, 5);
  assert.equal(first[0]!.label, "B 1");
  assert.equal(wallets.listGroups().find((x) => x.id === g.id)!.walletCount, 3);

  // Re-deriving from the vault mnemonic yields the same addresses (the mnemonic is the backup).
  const reimported = solanaKeys.parseImport(vault.mnemonic(), 5).map((k) => k.address);
  assert.deepEqual(reimported, [...first, ...next].map((w) => w.address));
});

test("wallets: import base58, JSON array and mnemonic; duplicates skipped", async () => {
  const { wallets } = await unlockedStore();
  const a = Keypair.generate();
  const b = Keypair.generate();
  const r1 = wallets.import({ text: `${bs58.encode(a.secretKey)}\n${JSON.stringify(Array.from(b.secretKey))}` });
  assert.deepEqual(r1.created.map((w) => w.address), [a.publicKey.toBase58(), b.publicKey.toBase58()]);
  const r2 = wallets.import({ text: bs58.encode(a.secretKey) });
  assert.equal(r2.created.length, 0);
  assert.deepEqual(r2.skipped, [a.publicKey.toBase58()]);
  const r3 = wallets.import({ text: PHRASE, mnemonicAccounts: 2 });
  assert.equal(r3.created.length, 2);
  assert.throws(() => wallets.import({ text: "zzzz" }));
  assert.throws(() => wallets.import({ text: bs58.encode(new Uint8Array(32)) }), /64-byte/);
});

test("wallets: export returns the original secret; signers decrypt and wipe", async () => {
  const { wallets } = await unlockedStore();
  const kp = Keypair.generate();
  const [w] = wallets.import({ text: bs58.encode(kp.secretKey) }).created;
  const [exp] = wallets.exportSecrets([w!.id]);
  assert.equal(exp!.secretKey, bs58.encode(kp.secretKey));
  let held: Keypair | undefined;
  await wallets.withSolanaSigners([w!.id], async (s) => {
    held = s.get(w!.id)!;
    assert.equal(held.publicKey.toBase58(), kp.publicKey.toBase58());
  });
  assert.ok(held!.secretKey.every((x) => x === 0), "secret wiped after use");
});

test("wallets: archive hides from default list; group update", async () => {
  const { wallets } = await unlockedStore();
  const ws = wallets.generate({ count: 3 });
  const g = wallets.createGroup("dev");
  wallets.update([ws[0]!.id], { status: "archived" });
  wallets.update([ws[1]!.id, ws[2]!.id], { groupId: g.id });
  assert.equal(wallets.list().length, 2);
  assert.equal(wallets.list({ includeArchived: true }).length, 3);
  assert.equal(wallets.list({ groupId: g.id }).length, 2);
  assert.throws(() => wallets.createGroup("dev"), /already exists/);
});

test("wallets: locked vault refuses to generate or sign", async () => {
  const { wallets, vault } = await unlockedStore();
  const [w] = wallets.generate({ count: 1 });
  vault.lock();
  assert.throws(() => wallets.generate({ count: 1 }), /locked/);
  await assert.rejects(wallets.withSolanaSigners([w!.id], async () => 1), /locked/);
});

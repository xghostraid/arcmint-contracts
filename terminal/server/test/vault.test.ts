import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { Vault, VaultError } from "../src/vault.js";
import { deriveEd25519 } from "../src/crypto/slip10.js";
import { open, seal } from "../src/crypto/envelope.js";
import { FAST_KDF, PASS } from "./helpers.js";

test("vault: create, lock, unlock, wrong passphrase", async () => {
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 0, kdf: FAST_KDF });
  assert.equal(vault.initialized, false);
  await assert.rejects(vault.init("short"), (e: VaultError) => e.code === "weak_passphrase");
  await vault.init(PASS);
  assert.ok(vault.unlocked);
  const sealed = vault.sealSecret("addr1", Buffer.from("secret"));
  const phrase = vault.mnemonic();
  assert.equal(phrase.split(" ").length, 24);

  vault.lock();
  assert.throws(() => vault.openSecret("addr1", sealed), (e: VaultError) => e.code === "locked");
  await assert.rejects(vault.unlock("wrong passphrase!!"), (e: VaultError) => e.code === "bad_passphrase");
  await vault.unlock(PASS);
  assert.equal(vault.openSecret("addr1", sealed).toString(), "secret");
  assert.equal(vault.mnemonic(), phrase);
});

test("vault: ciphertext is bound to its row and tamper-evident", async () => {
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 0, kdf: FAST_KDF });
  await vault.init(PASS);
  const sealed = vault.sealSecret("addrA", Buffer.from("key-a"));
  assert.throws(() => vault.openSecret("addrB", sealed));
  const parts = sealed.split(".");
  const ct = Buffer.from(parts[3]!, "base64");
  ct[0] = ct[0]! ^ 1;
  parts[3] = ct.toString("base64");
  assert.throws(() => vault.openSecret("addrA", parts.join(".")));
});

test("vault: change passphrase keeps data readable", async () => {
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 0, kdf: FAST_KDF });
  await vault.init(PASS);
  const sealed = vault.sealSecret("x", Buffer.from("payload"));
  await vault.changePassphrase(PASS, "a brand new passphrase");
  vault.lock();
  await assert.rejects(vault.unlock(PASS));
  await vault.unlock("a brand new passphrase");
  assert.equal(vault.openSecret("x", sealed).toString(), "payload");
});

test("vault: restore from a known mnemonic", async () => {
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 0, kdf: FAST_KDF });
  await assert.rejects(vault.init(PASS, "not a real phrase at all"), (e: VaultError) => e.code === "bad_mnemonic");
  const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  await vault.init(PASS, phrase);
  assert.equal(vault.mnemonic(), phrase);
});

test("vault: auto-lock after idle", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 1, kdf: FAST_KDF });
  await vault.init(PASS);
  t.mock.timers.tick(30_000);
  assert.ok(vault.unlocked);
  t.mock.timers.tick(45_000);
  assert.equal(vault.unlocked, false);
  vault.close();
});

test("envelope: seal/open round trip with AAD", () => {
  const key = Buffer.alloc(32, 7);
  const s = seal(key, Buffer.from("hello"), "aad");
  assert.equal(open(key, s, "aad").toString(), "hello");
  assert.throws(() => open(key, s, "other"));
});

// SLIP-0010 test vector 1 for ed25519.
test("slip10: ed25519 test vectors", () => {
  const seed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  assert.equal(deriveEd25519(seed, "m").toString("hex"), "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7");
  assert.equal(deriveEd25519(seed, "m/0'").toString("hex"), "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
  assert.equal(deriveEd25519(seed, "m/0'/1'/2'/2'/1000000000'").toString("hex"), "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793");
  assert.throws(() => deriveEd25519(seed, "m/0"));
});

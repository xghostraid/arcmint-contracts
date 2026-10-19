import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { SolanaExecutor } from "../src/chains/solana/executor.js";
import { JitoClient, JITO_TIP_ACCOUNTS, tipGroup, type FetchLike } from "../src/chains/solana/jito.js";
import { appendTip, packGroups } from "../src/chains/solana/pack.js";
import { transferGroup } from "../src/chains/solana/treasury.js";
import { fakeConnection } from "./helpers.js";

function drafts(n: number) {
  const from = Keypair.generate();
  return { from, drafts: Array.from({ length: n }, (_, i) => packGroups([transferGroup(from, Keypair.generate().publicKey, 1_000_000n, `t${i}`)])[0]!) };
}

function conn(opts: { simErr?: (i: number) => unknown; statusErr?: (sig: string) => unknown } = {}) {
  const sent: Buffer[] = [];
  let simCount = 0;
  const c = fakeConnection({
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1000 }),
    simulateTransaction: async () => ({ value: { err: opts.simErr?.(simCount++) ?? null, logs: ["log"], unitsConsumed: 300 } }),
    sendRawTransaction: async (raw: Buffer) => {
      sent.push(Buffer.from(raw));
      return "sig";
    },
    getSignatureStatuses: async (sigs: string[]) => ({ value: sigs.map((s) => ({ confirmationStatus: "confirmed", err: opts.statusErr?.(s) ?? null })) }),
    getBlockHeight: async () => 10,
  });
  return { c, sent };
}

test("executor: a failed simulation sends nothing", async () => {
  const { c, sent } = conn({ simErr: (i) => (i === 1 ? { InstructionError: [0, "Custom"] } : null) });
  const { drafts: ds } = drafts(3);
  const r = await new SolanaExecutor(c, null).run(ds, { mode: "parallel", microLamports: 1000 });
  assert.equal(sent.length, 0);
  assert.equal(r.txs[1]!.status, "failed");
  assert.match(r.txs[1]!.error!, /Simulation failed/);
  assert.deepEqual(r.txs.map((t) => t.status), ["skipped", "failed", "skipped"]);
});

test("executor: dry run simulates and returns signatures without sending", async () => {
  const { c, sent } = conn();
  const r = await new SolanaExecutor(c, null).run(drafts(2).drafts, { mode: "parallel", microLamports: 0, dryRun: true });
  assert.equal(sent.length, 0);
  assert.deepEqual(r.txs.map((t) => t.status), ["simulated", "simulated"]);
});

test("executor: parallel sends all and confirms", async () => {
  const { c, sent } = conn();
  const r = await new SolanaExecutor(c, null).run(drafts(3).drafts, { mode: "parallel", microLamports: 0 });
  assert.equal(sent.length, 3);
  assert.ok(r.txs.every((t) => t.status === "confirmed"));
});

test("executor: sequential stops at the first failure", async () => {
  let n = 0;
  const { c, sent } = conn({ statusErr: () => (n++ === 1 ? { InstructionError: [1, "x"] } : null) });
  const r = await new SolanaExecutor(c, null).run(drafts(3).drafts, { mode: "sequential", microLamports: 0 });
  assert.equal(sent.length, 2);
  assert.deepEqual(r.txs.map((t) => t.status), ["confirmed", "failed", "skipped"]);
});

test("executor: bundle without Jito falls back to sequential with a note", async () => {
  const { c } = conn();
  const r = await new SolanaExecutor(c, null).run(drafts(2).drafts, { mode: "bundle", microLamports: 0 });
  assert.equal(r.mode, "sequential");
  assert.match(r.note!, /mainnet-only/);
});

test("executor: bundle posts signed base64 txs to Jito; tip goes to a Jito tip account", async () => {
  const calls: { url: string; body: { method: string; params: [string[], unknown] } }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ result: "bundle-123" }), text: async () => "" };
  };
  const { c, sent } = conn();
  const { from, drafts: ds } = drafts(2);
  const withTip = appendTip(ds, tipGroup(from, 50_000, () => 0));
  assert.equal(withTip.length, 2, "tip merged into last tx");
  const r = await new SolanaExecutor(c, new JitoClient("https://jito.test", fetchImpl)).run(withTip, { mode: "bundle", microLamports: 0 });
  assert.equal(sent.length, 0, "bundle does not go through RPC send");
  assert.equal(r.bundleId, "bundle-123");
  assert.equal(calls[0]!.url, "https://jito.test/api/v1/bundles");
  assert.equal(calls[0]!.body.method, "sendBundle");
  const txs = calls[0]!.body.params[0].map((b) => VersionedTransaction.deserialize(Buffer.from(b, "base64")));
  assert.equal(txs.length, 2);
  const keys = txs[1]!.message.staticAccountKeys.map((k) => k.toBase58());
  assert.ok(keys.includes(JITO_TIP_ACCOUNTS[0]!));
  assert.ok(txs.every((t) => t.signatures[0]!.some((b) => b !== 0)), "signed");
});

test("executor: more than 5 txs cannot be bundled", async () => {
  const { c } = conn();
  const jito = new JitoClient("https://jito.test", async () => ({ ok: true, status: 200, json: async () => ({ result: "x" }), text: async () => "" }));
  await assert.rejects(new SolanaExecutor(c, jito).run(drafts(6).drafts, { mode: "bundle", microLamports: 0 }), /at most 5/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { applyBuy, applySell, buyGroup, createAndBuyGroup, freshCurve, quoteBuy, quoteSell, pumpSdk } from "../src/chains/solana/pumpfun.js";
import { MAX_TX_BYTES, MAX_TX_TRACE, appendTip, draftSize, packGroups } from "../src/chains/solana/pack.js";
import { tipGroup } from "../src/chains/solana/jito.js";
import { transferGroup } from "../src/chains/solana/treasury.js";
import { syntheticTable, tableAddresses } from "../src/chains/solana/alt.js";
import { legStates } from "../src/services/trade.js";
import { fakeGlobal } from "./helpers.js";

const p = { global: fakeGlobal(), feeConfig: null };
const LAMPORTS = 500_000_000n;

test("pumpfun: chained quotes give later buyers fewer tokens for the same SOL", () => {
  let curve = freshCurve(p, Keypair.generate().publicKey);
  const outs: bigint[] = [];
  for (let i = 0; i < 6; i++) {
    const t = quoteBuy(p, curve, LAMPORTS);
    outs.push(t);
    curve = applyBuy(curve, t);
  }
  for (let i = 1; i < outs.length; i++) assert.ok(outs[i]! < outs[i - 1]!, "monotonic decreasing");
  // The first buy on a fresh curve matches the SDK's create-time quote.
  assert.equal(quoteBuy(p, null, LAMPORTS), outs[0]);
});

test("legStates: ordered sends chain; parallel sends quote each leg after all the others", () => {
  const start = freshCurve(p, Keypair.generate().publicKey);
  const amounts = [LAMPORTS, 2n * LAMPORTS, 3n * LAMPORTS];
  const step = (c: typeof start, l: bigint) => applyBuy(c, quoteBuy(p, c, l));
  const ordered = legStates(start, amounts, step, false);
  assert.equal(ordered[0], start);
  assert.deepEqual(ordered[2], step(step(start, amounts[0]!), amounts[1]!));
  const parallel = legStates(start, amounts, step, true);
  // Each leg's worst case is every other buy landing first; that is never better than its place in the chain.
  for (const [i, l] of amounts.entries()) {
    assert.ok(quoteBuy(p, parallel[i]!, l) <= quoteBuy(p, ordered[i]!, l), `leg ${i}`);
  }
  assert.equal(quoteBuy(p, parallel[2]!, amounts[2]!), quoteBuy(p, ordered[2]!, amounts[2]!), "the last leg's worst case is its chained state");
  assert.deepEqual(legStates(start, [LAMPORTS], step, true), [start], "a single leg is quoted against the live state");
});

test("pumpfun: buy then sell of the same tokens returns to the same reserves", () => {
  const start = freshCurve(p, PublicKey.default);
  const t = quoteBuy(p, start, LAMPORTS);
  const after = applySell(applyBuy(start, t), t);
  assert.equal(after.virtualTokenReserves.toString(), start.virtualTokenReserves.toString());
  const drift = BigInt(after.virtualQuoteReserves.toString()) - BigInt(start.virtualQuoteReserves.toString());
  assert.ok(drift >= 0n && drift <= 2n, `rounding drift ${drift}`);
  assert.ok(quoteSell(p, applyBuy(start, t), t) < LAMPORTS, "round trip loses fees");
});

test("pumpfun: buying past the curve's real reserves is rejected", () => {
  const curve = freshCurve(p, PublicKey.default);
  assert.throws(() => applyBuy(curve, BigInt(curve.realTokenReserves.toString())), /tokens left/);
});

test("launch packing: create+dev buy alone, bundle buys packed several per tx, tip appended", async () => {
  const dev = Keypair.generate();
  const mint = Keypair.generate();
  let curve = freshCurve(p, dev.publicKey);
  const devTokens = quoteBuy(p, null, LAMPORTS);
  const head = await createAndBuyGroup({ p, mint, name: "Test Token", symbol: "TEST", uri: "https://example.com/meta.json", dev, lamports: LAMPORTS, tokens: devTokens });
  curve = applyBuy(curve, devTokens);
  const groups = [];
  for (let i = 0; i < 12; i++) {
    const user = Keypair.generate();
    const tokens = quoteBuy(p, curve, LAMPORTS);
    groups.push(await buyGroup({ p, mint: mint.publicKey, curve, curveInfo: null, tokenProgram: TOKEN_2022_PROGRAM_ID, user, ataExists: false, lamports: LAMPORTS, tokens, slippageBps: 500, label: `b${i}` }));
    curve = applyBuy(curve, tokens);
  }
  const headDrafts = packGroups([head]);
  assert.equal(headDrafts.length, 1);
  assert.ok(draftSize(headDrafts[0]!) <= MAX_TX_BYTES);
  const buyDrafts = packGroups(groups);
  assert.ok(buyDrafts.length < groups.length, `packed ${groups.length} buys into ${buyDrafts.length} txs`);
  for (const d of buyDrafts) assert.ok(draftSize(d) <= MAX_TX_BYTES);
  const withTip = appendTip([...headDrafts, ...buyDrafts], tipGroup(dev, 10_000, () => 0));
  assert.ok(withTip.length <= headDrafts.length + buyDrafts.length + 1);
  const all = withTip.flatMap((d) => d.instructions.map((ix) => ix.programId.toBase58()));
  assert.ok(all.includes(pumpSdk().PUMP_PROGRAM_ID.toBase58()));
  console.log(`  12 bundle buys → ${buyDrafts.length} txs (${buyDrafts.map((d) => d.label.split(" + ").length).join("/")} per tx)`);
});

test("launch packing: one Jito bundle (≤5 txs) fits create + dev buy + 8 bundle wallets + tip", async () => {
  const count = async (n: number) => {
    const dev = Keypair.generate();
    const mint = Keypair.generate();
    const devTokens = quoteBuy(p, null, LAMPORTS);
    const head = await createAndBuyGroup({ p, mint, name: "Test Token", symbol: "TEST", uri: "https://example.com/meta.json", dev, lamports: LAMPORTS, tokens: devTokens });
    let curve = applyBuy(freshCurve(p, dev.publicKey), devTokens);
    const groups = [];
    for (let i = 0; i < n; i++) {
      const tokens = quoteBuy(p, curve, LAMPORTS / 10n);
      groups.push(await buyGroup({ p, mint: mint.publicKey, curve, curveInfo: null, tokenProgram: TOKEN_2022_PROGRAM_ID, user: Keypair.generate(), ataExists: false, lamports: LAMPORTS / 10n, tokens, slippageBps: 500, label: `b${i}` }));
      curve = applyBuy(curve, tokens);
    }
    return appendTip([...packGroups([head]), ...packGroups(groups)], tipGroup(dev, 10_000)).length;
  };
  assert.equal(await count(8), 5);
  assert.equal(await count(9), 6);
});

test("launch packing with a lookup table: one Jito bundle fits create + dev buy + 18 bundle wallets + tip (trace-limited)", async () => {
  const build = async (n: number) => {
    const dev = Keypair.generate();
    const mint = Keypair.generate();
    const devTokens = quoteBuy(p, null, LAMPORTS);
    const head = await createAndBuyGroup({ p, mint, name: "Test Token", symbol: "TEST", uri: "https://example.com/meta.json", dev, lamports: LAMPORTS, tokens: devTokens });
    let curve = applyBuy(freshCurve(p, dev.publicKey), devTokens);
    const groups = [];
    for (let i = 0; i < n; i++) {
      const tokens = quoteBuy(p, curve, LAMPORTS / 10n);
      groups.push(await buyGroup({ p, mint: mint.publicKey, curve, curveInfo: null, tokenProgram: TOKEN_2022_PROGRAM_ID, user: Keypair.generate(), ataExists: false, lamports: LAMPORTS / 10n, tokens, slippageBps: 500, label: `b${i}` }));
      curve = applyBuy(curve, tokens);
    }
    const tip = tipGroup(dev, 10_000, () => 0);
    const lookupTables = [syntheticTable(tableAddresses([head, ...groups, tip]))];
    return appendTip(packGroups(groups, { head, lookupTables }), tip);
  };
  const drafts = await build(18);
  for (const d of drafts) {
    assert.ok(draftSize(d) <= MAX_TX_BYTES);
    assert.ok(d.trace! <= MAX_TX_TRACE, `${d.label}: trace ${d.trace}`);
  }
  assert.equal(drafts.length, 5, `18 wallets → ${drafts.length} txs`);
  // Head: 2 priority + 31 create/dev buy + 2 × 15 buys = 63; then 4 buys (62) per tx, the tip riding in the last.
  assert.deepEqual(drafts.map((d) => d.label.split(" + ").length), [2 + 2, 4, 4, 4, 4 + 1]);
  assert.equal((await build(19)).length, 6, "the 64-instruction trace limit, not size, caps a table launch");
});

test("pack: the instruction trace limit splits transactions that would fit by size", () => {
  const signer = Keypair.generate();
  const heavy = (i: number) => ({ ...transferGroup(signer, Keypair.generate().publicKey, 1n, `h${i}`), trace: 20 });
  const drafts = packGroups([heavy(0), heavy(1), heavy(2), heavy(3)]);
  assert.deepEqual(drafts.map((d) => d.trace), [62, 22], "2 priority + 3 × 20, then the fourth");
  assert.throws(() => packGroups([{ ...heavy(9), trace: 63 }]), /does not fit/);
});

test("pack: a group too large for one transaction is rejected", () => {
  const signers = Array.from({ length: 20 }, () => Keypair.generate());
  const parts = signers.map((s, i) => transferGroup(s, Keypair.generate().publicKey, 1_000_000n, `t${i}`));
  const huge = { label: "huge", instructions: parts.flatMap((g) => g.instructions), signers, computeUnits: 1 };
  assert.throws(() => packGroups([huge]), /does not fit/);
});

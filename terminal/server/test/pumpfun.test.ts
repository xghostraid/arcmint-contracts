import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { applyBuy, applySell, buyGroup, createAndBuyGroup, freshCurve, quoteBuy, quoteSell, pumpSdk } from "../src/chains/solana/pumpfun.js";
import { MAX_TX_BYTES, appendTip, draftSize, packGroups } from "../src/chains/solana/pack.js";
import { tipGroup } from "../src/chains/solana/jito.js";
import { transferGroup } from "../src/chains/solana/treasury.js";
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

test("pack: a group too large for one transaction is rejected", () => {
  const signers = Array.from({ length: 20 }, () => Keypair.generate());
  const parts = signers.map((s, i) => transferGroup(s, Keypair.generate().publicKey, 1_000_000n, `t${i}`));
  const huge = { label: "huge", instructions: parts.flatMap((g) => g.instructions), signers, computeUnits: 1 };
  assert.throws(() => packGroups([huge]), /does not fit/);
});

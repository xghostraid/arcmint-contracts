import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShareText, shareWithinLimit } from "../../src/api/share.js";

test("share text includes symbol and stays within X limit", () => {
  const { text, intentUrl } = buildShareText({
    chain: { key: "solana-devnet", name: "Solana devnet", family: "solana", testnet: true, nativeSymbol: "SOL" },
    name: "Demo Coin",
    symbol: "DEMO",
    address: "9T2ZGEjbngvadmgZQouQgHRaA2pDFLkcpb3Mo2faikds",
    explorer: "https://explorer.solana.com/address/9T2Z?cluster=devnet",
  });
  assert.match(text, /\$DEMO/);
  assert.match(intentUrl, /^https:\/\/x\.com\/intent\/tweet\?text=/);
  assert.equal(shareWithinLimit(text), true);
});

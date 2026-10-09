/**
 * One sponsored pump.fun launch on Solana devnet (atomic create + fee lock).
 *
 *   PROMPTFUN_SPONSOR_KEY=/path/to/solana-devnet-demo-wallet.json \
 *   PROMPTFUN_EVIDENCE=/path/to/media/pumpfun/devnet-launch.json \
 *     npx tsx scripts/pumpfun-devnet-sponsored.ts
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadConfig } from "../src/config.js";
import { IntentStore } from "../src/intents/store.js";
import { IntentService } from "../src/intents/service.js";
import { PictureStore } from "../src/pictures/store.js";
import { PictureService } from "../src/pictures/service.js";

const keyPath = process.env.PROMPTFUN_SPONSOR_KEY;
if (!keyPath) {
  console.error("Set PROMPTFUN_SPONSOR_KEY to a Solana keypair JSON file.");
  process.exit(1);
}
const sponsor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const evidencePath = process.env.PROMPTFUN_EVIDENCE || "devnet-launch-evidence.json";

const config = loadConfig({
  ...process.env,
  PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
  PROMPTFUN_ENABLE_PUMPFUN_DEVNET: "1",
  PROMPTFUN_SPONSOR_SECRET_KEY: JSON.stringify(Array.from(sponsor.secretKey)),
  PROMPTFUN_SPONSOR_FEE_RECIPIENT: sponsor.publicKey.toBase58(),
  PROMPTFUN_DB: ":memory:",
});

const rpc = config.env.PROMPTFUN_RPC_SOLANA_DEVNET || "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");
const bal = await conn.getBalance(sponsor.publicKey);
if (bal < 0.05 * LAMPORTS_PER_SOL) {
  console.log("Requesting devnet airdrop…");
  const sig = await conn.requestAirdrop(sponsor.publicKey, LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

const store = new IntentStore(config.dbPath);
const pictures = new PictureService(config, new PictureStore(config.dbPath));
const service = new IntentService(config, store, pictures);
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const intent = await service.prepareLaunch({
  chain: "solana-devnet",
  venue: "pumpfun",
  name: `Beam ${tag}`,
  symbol: `BM${tag.slice(0, 3)}`,
  metadataUri: "https://pump.fun/coin-metadata.json",
  description: "Sponsored pump.fun devnet evidence launch",
});

if (intent.status !== "awaiting_confirm") {
  throw new Error(`Expected awaiting_confirm, got ${intent.status}: ${intent.error ?? ""}`);
}

await service.confirmLaunch(intent.id);
let final = await service.get(intent.id);
for (let i = 0; i < 45 && final.status === "submitted"; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  await service.refresh(final.id);
  final = await service.get(final.id);
}
if (final.status !== "confirmed" || !final.submission?.id) {
  throw new Error(`Launch did not confirm: ${final.status} ${final.error ?? ""} tx=${final.submission?.id ?? "none"}`);
}

const evidence = {
  at: new Date().toISOString(),
  chain: "solana-devnet",
  venue: "pumpfun",
  sponsor: sponsor.publicKey.toBase58(),
  feeRecipient: sponsor.publicKey.toBase58(),
  intentId: final.id,
  mint: final.built?.tokenAddress,
  signature: final.submission.id,
  explorer: `https://explorer.solana.com/tx/${final.submission.id}?cluster=devnet`,
  receipt: final.receipt,
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
store.close();

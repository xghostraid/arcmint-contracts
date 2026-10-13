import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadConfig } from "../src/config.js";
import { allChains } from "../src/chains/registry.js";
import { connectionFor, explainSimulationFailure } from "../src/chains/solana/adapter.js";
import { buildPumpfunLaunchSponsored } from "../src/chains/solana/pumpfun.js";
import { resolvePumpfunCreatorFeeLock } from "../src/chains/solana/prompt-tier.js";
import { SOLANA_TX_RAW_MAX, versionedTxWireSize } from "../src/chains/solana/tx-size.js";
import type { Intent, LaunchParams } from "../src/intents/types.js";

const config = loadConfig({});
const chain = allChains(config).find((c) => c.key === "solana-mainnet")!;
const conn = connectionFor(chain);
const sponsor = new PublicKey("5YPhpDDtYtKaKnUgSskb4tXKZL9a7rj8siCuMS7qESpv");

async function run(label: string, shareholders: LaunchParams["feeShareholders"], uri: string) {
  const lock = shareholders
    ? { feeRecipient: shareholders[0]!.address, feeShareholders: shareholders }
    : await resolvePumpfunCreatorFeeLock(config, conn, undefined, sponsor.toBase58());
  const params: LaunchParams = {
    name: "PCAT",
    symbol: "PCAT",
    supply: "1000000000",
    decimals: 6,
    description: "",
    metadataUri: uri,
    fixedSupply: true,
    venue: "pumpfun",
    feeRecipient: lock.feeRecipient,
    feeShareholders: lock.feeShareholders,
  };
  const intent = {
    id: "i",
    kind: "launch_token",
    chain: "solana-mainnet",
    family: "solana",
    params,
    summary: "",
    status: "awaiting_wallet",
    createdAt: "",
    updatedAt: "",
    expiresAt: "",
    built: null,
    submission: null,
    receipt: null,
    error: null,
    events: [],
    idempotencyKey: label,
    executionMode: "wallet",
    instructionFingerprint: null,
  } as Intent;
  const compiled = await buildPumpfunLaunchSponsored(conn, intent, sponsor, Keypair.generate());
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const primaryMsg = new TransactionMessage({ payerKey: sponsor, recentBlockhash: blockhash, instructions: compiled.instructions }).compileToLegacyMessage();
  const primarySim = await conn.simulateTransaction(new VersionedTransaction(primaryMsg), { sigVerify: false, commitment: "confirmed" });
  const followRaw = new VersionedTransaction(
    new TransactionMessage({ payerKey: sponsor, recentBlockhash: blockhash, instructions: compiled.followUpInstructions! }).compileToLegacyMessage(),
  ).serialize().length;
  if (followRaw > SOLANA_TX_RAW_MAX) throw new Error(`${label}: follow-up too large ${followRaw}`);
  const pipeline = [...compiled.instructions, ...compiled.followUpInstructions!];
  const pipelineRaw = versionedTxWireSize(pipeline, sponsor).raw;
  let pipelineOk = true;
  if (pipelineRaw <= SOLANA_TX_RAW_MAX) {
    const pipelineMsg = new TransactionMessage({ payerKey: sponsor, recentBlockhash: blockhash, instructions: pipeline }).compileToLegacyMessage();
    const pipelineSim = await conn.simulateTransaction(new VersionedTransaction(pipelineMsg), { sigVerify: false, commitment: "confirmed" });
    pipelineOk = !pipelineSim.value.err;
    if (!pipelineOk) {
      console.log(label, "pipeline", explainSimulationFailure(pipelineSim.value.logs ?? [], pipelineSim.value.err));
      process.exitCode = 1;
      return;
    }
  }
  const primaryOk = !primarySim.value.err;
  if (!primaryOk) {
    console.log(label, "primary", explainSimulationFailure(primarySim.value.logs ?? [], primarySim.value.err));
    process.exitCode = 1;
    return;
  }
  console.log(label, "OK", `(primary sim, follow ${followRaw}b${pipelineRaw <= SOLANA_TX_RAW_MAX ? ", pipeline sim" : ", pipeline skipped size"})`);
}

await run("treasury", undefined, "https://promptfun.fun/m/pic_c212409640a239286fcba88e");
await run("5050", [
  { address: Keypair.generate().publicKey.toBase58(), shareBps: 5000 },
  { address: sponsor.toBase58(), shareBps: 5000 },
], "https://promptfun.fun/m/pic_test");

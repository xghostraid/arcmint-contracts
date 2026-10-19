#!/usr/bin/env node
// Starts solana-test-validator with the pump.fun programs and config accounts cloned from devnet,
// so launches, buys and sells can be tested end to end with free local SOL.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk");
const amm = require("@pump-fun/pump-swap-sdk");
const { Connection, PublicKey } = require("@solana/web3.js");
const { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");

const source = process.env.CLONE_FROM_RPC ?? "https://api.devnet.solana.com";
const ledger = process.env.LEDGER_DIR ?? ".local-ledger";
const conn = new Connection(source, "confirmed");

const global = await new pump.OnlinePumpSdk(conn).fetchGlobal();
const ammGlobal = await new amm.OnlinePumpAmmSdk(conn).fetchGlobalConfigAccount();
const ammRecipients = [...ammGlobal.protocolFeeRecipients, ...ammGlobal.reservedFeeRecipients, ammGlobal.reservedFeeRecipient, ...ammGlobal.buybackFeeRecipients].filter((k) => !k.equals(PublicKey.default));
const wsolAta = (owner) => getAssociatedTokenAddressSync(NATIVE_MINT, owner, true, TOKEN_PROGRAM_ID);
const programs = [pump.PUMP_PROGRAM_ID, pump.PUMP_FEE_PROGRAM_ID, pump.MAYHEM_PROGRAM_ID, pump.PUMP_AMM_PROGRAM_ID];
const candidates = [
  pump.GLOBAL_PDA,
  pump.PUMP_FEE_CONFIG_PDA,
  pump.GLOBAL_VOLUME_ACCUMULATOR_PDA,
  pump.FEE_PROGRAM_GLOBAL_PDA,
  pump.getGlobalParamsPda(),
  pump.getSolVaultPda(),
  pump.QUOTE_CONTROL_PDA,
  pump.AMM_GLOBAL_PDA,
  pump.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
  global.feeRecipient,
  ...global.feeRecipients,
  global.reservedFeeRecipient,
  ...global.reservedFeeRecipients,
  ...global.buybackFeeRecipients,
  amm.PUMP_AMM_FEE_CONFIG_PDA,
  ...ammRecipients,
  ...ammRecipients.map(wsolAta),
];
const unique = [...new Set(candidates.map((k) => k.toBase58()))];
const infos = await conn.getMultipleAccountsInfo(unique.map((a) => new PublicKey(a)));
const accounts = unique.filter((_, i) => infos[i]);

const args = ["--reset", "--quiet", "--ledger", ledger, "--url", source];
for (const p of programs) args.push("--clone-upgradeable-program", p.toBase58());
for (const a of accounts) args.push("--clone", a);

console.log(`Cloning ${programs.length} programs and ${accounts.length} accounts from ${source}`);
const child = spawn("solana-test-validator", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));

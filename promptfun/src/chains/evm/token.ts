import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { encodeDeployData, keccak256, type Abi, type Hex } from "viem";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = [path.resolve(here, "../../../contracts/PromptfunToken.sol"), path.resolve(here, "../../../../contracts/PromptfunToken.sol")]
  .find((file) => fs.existsSync(file))!;
const OZ_ROOT = path.dirname(require.resolve("@openzeppelin/contracts/package.json"));

/** Pinned so the same source always yields the same bytecode. Paris avoids PUSH0/MCOPY, which not every EVM chain runs. */
export const COMPILER = { version: "0.8.37", evmVersion: "paris", optimizerRuns: 200 } as const;

export interface TokenArtifact {
  abi: Abi;
  bytecode: Hex;
  sourceHash: Hex;
}

let artifact: TokenArtifact | null = null;

/** Compiles contracts/PromptfunToken.sol with OpenZeppelin's ERC20 on first use. No bytecode is checked in. */
export function tokenArtifact(): TokenArtifact {
  if (artifact) return artifact;
  const solc = require("solc") as { compile(input: string, opts: { import(p: string): { contents: string } | { error: string } }): string; version(): string };
  if (!solc.version().startsWith(COMPILER.version)) throw new Error(`solc ${COMPILER.version} is required, found ${solc.version()}.`);
  const source = fs.readFileSync(SOURCE, "utf8");
  const input = {
    language: "Solidity",
    sources: { "PromptfunToken.sol": { content: source } },
    settings: {
      evmVersion: COMPILER.evmVersion,
      optimizer: { enabled: true, runs: COMPILER.optimizerRuns },
      metadata: { bytecodeHash: "none" },
      outputSelection: { "PromptfunToken.sol": { PromptfunToken: ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import(importPath) {
      const prefix = "@openzeppelin/contracts/";
      if (!importPath.startsWith(prefix)) return { error: `Import not allowed: ${importPath}` };
      const file = path.join(OZ_ROOT, importPath.slice(prefix.length));
      return fs.existsSync(file) ? { contents: fs.readFileSync(file, "utf8") } : { error: `Not found: ${importPath}` };
    },
  }));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(`Token contract failed to compile: ${errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n")}`);
  const contract = output.contracts["PromptfunToken.sol"].PromptfunToken;
  artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, sourceHash: keccak256(Buffer.from(source)) };
  return artifact;
}

export function deployData(name: string, symbol: string, decimals: number, supplyBase: bigint): Hex {
  const { abi, bytecode } = tokenArtifact();
  return encodeDeployData({ abi, bytecode, args: [name, symbol, decimals, supplyBase] });
}

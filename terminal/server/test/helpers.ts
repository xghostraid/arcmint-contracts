import { createRequire } from "node:module";
import { PublicKey, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import type { Global } from "@pump-fun/pump-sdk";
import { loadConfig, type Config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { Vault } from "../src/vault.js";
import { WalletStore } from "../src/wallets.js";

export const FAST_KDF = { name: "scrypt" as const, N: 2 ** 10, r: 8, p: 1 };
export const PASS = "correct horse battery";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ TERMINAL_NETWORK: "local", TERMINAL_DATA_DIR: "/tmp/terminal-test", TERMINAL_AUTO_LOCK_MINUTES: "0" }), ...overrides };
}

export async function unlockedStore() {
  const db = openDb(":memory:");
  const vault = new Vault(db, { autoLockMinutes: 0, kdf: FAST_KDF });
  await vault.init(PASS);
  return { db, vault, wallets: new WalletStore(db, vault) };
}

/** Mainnet-shaped pump.fun global config, enough for the SDK's quote math. */
export function fakeGlobal(): Global {
  return {
    initialized: true,
    authority: PublicKey.default,
    feeRecipient: PublicKey.default,
    initialVirtualTokenReserves: new BN("1073000000000000"),
    initialVirtualSolReserves: new BN("30000000000"),
    initialVirtualQuoteReserves: new BN("30000000000"),
    initialRealTokenReserves: new BN("793100000000000"),
    tokenTotalSupply: new BN("1000000000000000"),
    feeBasisPoints: new BN(95),
    creatorFeeBasisPoints: new BN(5),
    withdrawAuthority: PublicKey.default,
    enableMigrate: true,
    poolMigrationFee: new BN(0),
    feeRecipients: [],
    setCreatorAuthority: PublicKey.default,
    adminSetCreatorAuthority: PublicKey.default,
    createV2Enabled: true,
    whitelistPda: PublicKey.default,
    reservedFeeRecipient: PublicKey.default,
    mayhemModeEnabled: false,
    reservedFeeRecipients: [],
    isCashbackEnabled: false,
    buybackFeeRecipients: [],
    buybackBasisPoints: new BN(0),
    whitelistedQuoteMints: [],
  } as unknown as Global;
}

type AnyFn = (...args: never[]) => unknown;
/** A Connection stub: only the methods a test provides exist. */
export function fakeConnection(methods: Record<string, AnyFn>): Connection {
  return new Proxy(methods, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "then") return undefined;
      return () => {
        throw new Error(`fake connection: ${prop} not implemented`);
      };
    },
  }) as unknown as Connection;
}

type IdlField = { name: string; type: unknown };
type Idl = { types: { name: string; type: { fields: IdlField[] } }[]; events: { name: string; discriminator: number[] }[] };

function defaultFor(type: unknown): unknown {
  if (type === "bool") return false;
  if (type === "pubkey") return PublicKey.default;
  if (type === "string") return "";
  if (typeof type === "object" && type && "vec" in type) return [];
  return new BN(0);
}

/** An Anchor event payload (discriminator + borsh) for one of the Pump programs, unspecified fields zeroed. */
export function encodeEvent(program: "pump" | "amm", name: string, values: Record<string, unknown>): Buffer {
  const require = createRequire(import.meta.url);
  const { BorshCoder } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
  const idl = (program === "pump" ? require("@pump-fun/pump-sdk").pumpIdl : require("@pump-fun/pump-swap-sdk").pumpAmmJson) as Idl;
  const def = idl.types.find((t) => t.name === name)!;
  const data: Record<string, unknown> = {};
  for (const f of def.type.fields) data[f.name] = f.name in values ? values[f.name] : defaultFor(f.type);
  const disc = Buffer.from(idl.events.find((e) => e.name === name)!.discriminator);
  return Buffer.concat([disc, new BorshCoder(idl as never).types.encode(name, data)]);
}

export const PUMP_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const AMM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

/** A confirmed transaction response carrying the given logs and inner instructions. */
export function fakeTx(opts: { keys: PublicKey[]; logs?: string[]; inner?: { programIdIndex: number; data: Buffer }[]; slot?: number; blockTime?: number; err?: unknown }): VersionedTransactionResponse {
  return {
    slot: opts.slot ?? 100,
    blockTime: opts.blockTime ?? 1_700_000_000,
    transaction: { message: { staticAccountKeys: opts.keys }, signatures: ["sig"] },
    meta: {
      err: opts.err ?? null,
      logMessages: opts.logs ?? [],
      innerInstructions: opts.inner ? [{ index: 0, instructions: opts.inner.map((i) => ({ programIdIndex: i.programIdIndex, accounts: [], data: bs58.encode(i.data) })) }] : [],
      loadedAddresses: { writable: [], readonly: [] },
    },
  } as unknown as VersionedTransactionResponse;
}

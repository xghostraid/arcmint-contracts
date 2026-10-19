import { PublicKey, type Connection } from "@solana/web3.js";
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

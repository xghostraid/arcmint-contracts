import { createPublicClient, http, isAddress, zeroAddress, type Address } from "viem";
import { factoryAbi, poolAbi } from "./abi";
import { ARC_RPC, FACTORY_ADDRESS, arcMainnet } from "./chain";

export type CatalogToken = {
  token: Address;
  pool: Address;
  creator: Address;
  createdAt: number;
  name: string;
  symbol: string;
  metadataURI: string;
  teamVesting: Address;
  marketCapUsdc: string;
  graduated: boolean;
};

export type CatalogSnapshot = {
  syncedAt: number;
  toBlock: number;
  launchCount: number;
  tokens: CatalogToken[];
  source: "chain";
};

type LaunchTuple = {
  token: Address;
  pool: Address;
  creator: Address;
  createdAt: bigint;
  name: string;
  symbol: string;
  metadataURI: string;
  teamVesting: Address;
};

const client = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC, {
    timeout: 20_000,
    fetchOptions: { headers: { "user-agent": "arcmint-catalog" } },
  }),
});

let cache: { at: number; data: CatalogSnapshot } | null = null;
const CACHE_MS = 8_000;
const MAX_INDEX_SCAN = 500;

function asLaunch(row: LaunchTuple | readonly unknown[]): LaunchTuple {
  if (Array.isArray(row)) {
    return {
      token: row[0] as Address,
      pool: row[1] as Address,
      creator: row[2] as Address,
      createdAt: row[3] as bigint,
      name: String(row[4] ?? ""),
      symbol: String(row[5] ?? ""),
      metadataURI: String(row[6] ?? ""),
      teamVesting: (row[7] as Address) ?? zeroAddress,
    };
  }
  const obj = row as LaunchTuple;
  if (obj.token && obj.pool) return obj;
  const values = Object.values(row as object);
  if (values.length >= 7) {
    return {
      token: values[0] as Address,
      pool: values[1] as Address,
      creator: values[2] as Address,
      createdAt: values[3] as bigint,
      name: String(values[4] ?? ""),
      symbol: String(values[5] ?? ""),
      metadataURI: String(values[6] ?? ""),
      teamVesting: (values[7] as Address) ?? zeroAddress,
    };
  }
  return obj;
}

function isLiveLaunch(row: LaunchTuple): boolean {
  return (
    isAddress(row.token) &&
    isAddress(row.pool) &&
    row.token !== zeroAddress &&
    row.pool !== zeroAddress
  );
}

async function scanLaunchCount(): Promise<bigint> {
  for (let i = 0n; i < BigInt(MAX_INDEX_SCAN); i++) {
    try {
      const token = await client.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "launchByIndex",
        args: [i],
      });
      if (!token || token === zeroAddress) return i;
    } catch {
      return i;
    }
  }
  return BigInt(MAX_INDEX_SCAN);
}

async function readLaunchCount(): Promise<bigint> {
  try {
    const count = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "launchCount",
    });
    if (count > 0n) return count;
  } catch {
    /* live factory may lag this selector */
  }
  try {
    const count = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "getLaunchCount",
    });
    if (count > 0n) return count;
  } catch {
    /* older ABI */
  }
  return scanLaunchCount();
}

async function readViaGetLaunches(count: bigint): Promise<LaunchTuple[] | null> {
  try {
    const infos = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "getLaunches",
      args: [0n, count],
    });
    return (infos as LaunchTuple[]).map((row) => asLaunch(row));
  } catch {
    return null;
  }
}

async function readViaIndex(count: bigint): Promise<LaunchTuple[]> {
  const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const tokens = await Promise.all(
    indexes.map((i) =>
      client.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "launchByIndex",
        args: [i],
      }),
    ),
  );
  const rows = await Promise.all(
    tokens.map((token) =>
      client.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "launches",
        args: [token],
      }),
    ),
  );
  return rows.map((row) => asLaunch(row));
}

async function withPoolStats(rows: LaunchTuple[]): Promise<CatalogToken[]> {
  const live = rows.filter(isLiveLaunch);
  const stats = await Promise.all(
    live.map(async (row) => {
      try {
        const [mcap, graduated] = await Promise.all([
          client.readContract({ address: row.pool, abi: poolAbi, functionName: "marketCapUsdc" }),
          client.readContract({ address: row.pool, abi: poolAbi, functionName: "graduated" }),
        ]);
        return { marketCapUsdc: mcap.toString(), graduated };
      } catch {
        return { marketCapUsdc: "0", graduated: false };
      }
    }),
  );
  return live.map((row, i) => ({
    token: row.token,
    pool: row.pool,
    creator: row.creator,
    createdAt: Number(row.createdAt),
    name: row.name,
    symbol: row.symbol,
    metadataURI: row.metadataURI,
    teamVesting: row.teamVesting,
    marketCapUsdc: stats[i].marketCapUsdc,
    graduated: stats[i].graduated,
  }));
}

export async function loadCatalog(force = false): Promise<CatalogSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const count = await readLaunchCount();
  const blockNumber = await client.getBlockNumber();
  let rows: LaunchTuple[] = [];
  if (count > 0n) {
    const viaPage = await readViaGetLaunches(count);
    rows = viaPage && viaPage.length ? viaPage : await readViaIndex(count);
  }
  const tokens = (await withPoolStats(rows)).reverse();
  const data: CatalogSnapshot = {
    syncedAt: Date.now(),
    toBlock: Number(blockNumber),
    launchCount: Number(count),
    tokens,
    source: "chain",
  };
  cache = { at: Date.now(), data };
  return data;
}

export async function loadToken(address: string): Promise<CatalogToken | null> {
  if (!isAddress(address)) return null;
  const catalog = await loadCatalog();
  const hit = catalog.tokens.find((t) => t.token.toLowerCase() === address.toLowerCase());
  if (hit) return hit;
  try {
    const row = asLaunch(
      await client.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "launches",
        args: [address as Address],
      }),
    );
    if (!isLiveLaunch(row)) return null;
    const [enriched] = await withPoolStats([row]);
    return enriched;
  } catch {
    return null;
  }
}

export function invalidateCatalog() {
  cache = null;
}

export function ipfsToHttp(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("Qm") || uri.startsWith("bafy")) return `https://ipfs.io/ipfs/${uri}`;
  return null;
}

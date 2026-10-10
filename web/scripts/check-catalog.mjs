import { createPublicClient, http } from "viem";

const FACTORY = "0x0F5d0D0271068568134Fa2ca834756f34C485901";
const RPC = "https://rpc.mainnet.arc.io";

const abi = [
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "launchByIndex",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "pool", type: "address" },
      { name: "creator", type: "address" },
      { name: "createdAt", type: "uint256" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "teamVesting", type: "address" },
    ],
  },
];

const client = createPublicClient({
  transport: http(RPC, { timeout: 20_000 }),
});

const count = await client.readContract({ address: FACTORY, abi, functionName: "launchCount" });
if (count === 0n) {
  console.error("launchCount is 0 — factory has no launches");
  process.exit(1);
}

const tokens = [];
for (let i = 0n; i < count; i++) {
  const token = await client.readContract({
    address: FACTORY,
    abi,
    functionName: "launchByIndex",
    args: [i],
  });
  const row = await client.readContract({
    address: FACTORY,
    abi,
    functionName: "launches",
    args: [token],
  });
  const info = Array.isArray(row)
    ? { token: row[0], pool: row[1], creator: row[2], name: row[4], symbol: row[5] }
    : row;
  tokens.push({ token: info.token, name: info.name, symbol: info.symbol, pool: info.pool });
}

console.log(JSON.stringify({ launchCount: Number(count), tokens }, null, 2));
if (tokens.some((t) => !t.token || t.token === "0x0000000000000000000000000000000000000000")) {
  process.exit(1);
}

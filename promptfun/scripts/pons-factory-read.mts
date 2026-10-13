import { createPublicClient, formatEther, http, parseAbi } from "viem";

const factory = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";
const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const abi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function dexConfigCount() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns ((address pairToken,uint256 graduationThreshold,int24 initialTick,uint256 supply,uint16 maxWalletBps,uint16 maxTxBps,uint32 restrictionBlocks,uint24 reservedFee,bool enabled))",
  "function getDexConfig(uint256 id) view returns ((string name,address factory,address positionManager,address swapRouter,uint24 poolFee,int24 tickSpacing,bool enabled))",
]);

const [fee, enabled, dexN, launchN] = await Promise.all([
  client.readContract({ address: factory, abi, functionName: "launchFee" }),
  client.readContract({ address: factory, abi, functionName: "launchEnabled" }),
  client.readContract({ address: factory, abi, functionName: "dexConfigCount" }),
  client.readContract({ address: factory, abi, functionName: "launchConfigCount" }),
]);
console.log(JSON.stringify({ fee: formatEther(fee), enabled, dexN: Number(dexN), launchN: Number(launchN) }, null, 2));
for (let i = 0n; i < launchN; i += 1n) {
  const c = await client.readContract({ address: factory, abi, functionName: "getLaunchConfig", args: [i] });
  console.log("launchConfig", i.toString(), c);
}
for (let i = 0n; i < dexN; i += 1n) {
  const c = await client.readContract({ address: factory, abi, functionName: "getDexConfig", args: [i] });
  console.log("dexConfig", i.toString(), c);
}

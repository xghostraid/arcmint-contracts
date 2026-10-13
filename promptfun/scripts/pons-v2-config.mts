import { createPublicClient, formatEther, http, parseAbi } from "viem";

const factory = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const abi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns ((address pairToken,uint256 graduationThreshold,bool enabled,bytes32 economicsHash))",
]);

const [fee, enabled, n] = await Promise.all([
  client.readContract({ address: factory, abi, functionName: "launchFee" }),
  client.readContract({ address: factory, abi, functionName: "launchEnabled" }),
  client.readContract({ address: factory, abi, functionName: "launchConfigCount" }),
]);
console.log({ fee: formatEther(fee), enabled, n: Number(n) });
for (let i = 0n; i < n; i += 1n) {
  try {
    const c = await client.readContract({ address: factory, abi, functionName: "getLaunchConfig", args: [i] });
    console.log("config", i.toString(), c);
  } catch (e) {
    console.log("config err", i, (e as Error).message);
  }
}

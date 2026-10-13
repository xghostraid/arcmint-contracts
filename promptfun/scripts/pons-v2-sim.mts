import { randomBytes } from "node:crypto";
import { createPublicClient, encodeFunctionData, http, parseAbi, zeroAddress, type Hex } from "viem";

const router = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
const factory = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const signer = "0x618E2D806D8C6826F9e403ffB23cDF629156F521";
const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const factoryAbi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
]);
const routerAbi = parseAbi([
  "function launchAndBuy((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt) params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve,uint256 tokensOut)",
]);
const launchConfigId = 0n;
const pairToken = zeroAddress;
const expectedEconomics = await client.readContract({
  address: factory,
  abi: factoryAbi,
  functionName: "previewLaunchEconomics",
  args: [launchConfigId, pairToken],
});
const launchFee = await client.readContract({ address: factory, abi: factoryAbi, functionName: "launchFee" });
const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
const params = {
  name: "PromptTest",
  symbol: "PTST",
  logo: "https://promptfun.fun/favicon.ico",
  description: "promptfun pons integration test",
  socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
  creatorFeeRecipient: signer as Hex,
  creatorTaxBps: 0,
  buybackEnabled: false,
  expectedEconomics,
  salt,
};
const data = encodeFunctionData({
  abi: routerAbi,
  functionName: "launchAndBuy",
  args: [params, launchConfigId, pairToken, 0n, 0n, signer as Hex, []],
});
try {
  const out = await client.call({ account: signer as Hex, to: router, data, value: launchFee });
  console.log("sim ok", out.data?.slice(0, 130));
} catch (e) {
  console.log("sim err", (e as Error).message.split("\n").slice(0, 3).join(" | "));
}

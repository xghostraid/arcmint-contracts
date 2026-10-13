import { randomBytes } from "node:crypto";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { LaunchParams } from "../../intents/types.js";
import { IntentError } from "../../intents/types.js";

/** Pons launchpad on Robinhood Chain (same product as https://www.ponsfamily.com/launchpad/). */
export const PONS_LAUNCHPAD_URL = "https://www.ponsfamily.com/launchpad/";

export const PONS_SUPPLY = "1000000000";
export const PONS_DECIMALS = 18;

const DEFAULT_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as const;
const DEFAULT_V2_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948" as const;

const factoryAbi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function getLaunchConfig(uint256 id) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))",
]);

const routerAbi = parseAbi([
  "function launchAndBuy((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt) params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve,uint256 tokensOut)",
]);

const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function logo() view returns (string)",
  "function liquidityPool() view returns (address)",
]);

export function ponsTokenUrl(address: string): string {
  return `https://www.ponsfamily.com/token/${address}`;
}

export interface PonsAddresses {
  factory: Address;
  router: Address;
  launchConfigId: bigint;
  pairToken: Address;
}

export function ponsAddresses(env: NodeJS.ProcessEnv = process.env): PonsAddresses {
  const factory = (env.PROMPTFUN_PONS_FACTORY?.trim() || DEFAULT_V2_FACTORY) as Address;
  const router = (env.PROMPTFUN_PONS_ROUTER?.trim() || DEFAULT_V2_ROUTER) as Address;
  const launchConfigId = BigInt(env.PROMPTFUN_PONS_LAUNCH_CONFIG_ID?.trim() || "0");
  const pairToken = (env.PROMPTFUN_PONS_PAIR_TOKEN?.trim() || zeroAddress) as Address;
  return { factory, router, launchConfigId, pairToken };
}

export interface PonsLaunchCall {
  to: Address;
  data: Hex;
  value: bigint;
  salt: Hex;
  expectedEconomics: Hex;
  predictedToken: Address | null;
}

function socials(params: LaunchParams) {
  return {
    twitter: params.x ?? "",
    telegram: "",
    discord: "",
    website: params.website ?? "",
    farcaster: "",
  };
}

export async function buildPonsLaunchCall(
  client: PublicClient,
  params: LaunchParams,
  signer: Address,
  logoUrl: string,
  initialBuyWei: bigint,
): Promise<PonsLaunchCall> {
  const addrs = ponsAddresses();
  const [enabled, launchFee, expectedEconomics] = await Promise.all([
    client.readContract({ address: addrs.factory, abi: factoryAbi, functionName: "launchEnabled" }),
    client.readContract({ address: addrs.factory, abi: factoryAbi, functionName: "launchFee" }),
    client.readContract({
      address: addrs.factory,
      abi: factoryAbi,
      functionName: "previewLaunchEconomics",
      args: [addrs.launchConfigId, addrs.pairToken],
    }),
  ]);
  if (!enabled) {
    throw new IntentError(
      "Pons launchpad is not accepting new launches on chain right now (factory launchEnabled is false). Try again later or launch at https://www.ponsfamily.com/launchpad/create.",
      "pons_disabled",
    );
  }
  if (!logoUrl.startsWith("https://") && !logoUrl.startsWith("ipfs://")) {
    throw new IntentError("pons launches need an https:// or ipfs:// logo URL for the coin image.", "bad_request");
  }
  const salt = params.ponsSalt
    ? (params.ponsSalt as Hex)
    : (`0x${randomBytes(32).toString("hex")}` as Hex);
  const tokenParams = {
    name: params.name,
    symbol: params.symbol,
    logo: logoUrl.slice(0, 512),
    description: (params.description || `Launched via ${PONS_LAUNCHPAD_URL}`).slice(0, 2048),
    socials: socials(params),
    creatorFeeRecipient: signer,
    creatorTaxBps: 0,
    buybackEnabled: false,
    expectedEconomics,
    salt,
  };
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "launchAndBuy",
    args: [
      tokenParams,
      addrs.launchConfigId,
      addrs.pairToken,
      initialBuyWei,
      0n,
      signer,
      [],
    ],
  });
  const value = launchFee + initialBuyWei;
  let predictedToken: Address | null = null;
  try {
    const simulated = await client.call({
      account: signer,
      to: addrs.router,
      data,
      value,
    });
    if (simulated.data && simulated.data !== "0x") {
      const [token] = decodeFunctionResult({ abi: routerAbi, functionName: "launchAndBuy", data: simulated.data });
      predictedToken = token;
    }
  } catch {
    predictedToken = null;
  }
  return { to: addrs.router, data, value, salt, expectedEconomics, predictedToken };
}

export async function readPonsTokenFacts(client: PublicClient, token: Address): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  logo: string;
  pool: Address;
}> {
  const [name, symbol, decimals, totalSupply, logo, pool] = await Promise.all([
    client.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "logo" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "liquidityPool" }),
  ]);
  return { name, symbol, decimals: Number(decimals), totalSupply, logo, pool };
}

export function ponsLaunchSteps(params: LaunchParams, router: Address, launchFee: bigint, initialBuyWei: bigint): string[] {
  const buyLine =
    initialBuyWei > 0n
      ? `Includes ${initialBuyWei} wei initial buy into the new bonding curve (plus the pons launch fee).`
      : "No initial buy; only the pons launch fee is sent with this transaction.";
  return [
    `Call pons launchpad router ${router} on Robinhood Chain (same contracts as ${PONS_LAUNCHPAD_URL}).`,
    `Create "${params.name}" (${params.symbol}) with logo URL on chain; fixed supply ${PONS_SUPPLY} (18 decimals).`,
    buyLine,
    `Launch fee: ${launchFee} wei ETH (0.0005 ETH unless the factory changes it). Liquidity locks on graduation per pons rules.`,
  ];
}

export const ponsRouterAbi = routerAbi;
export const ponsFactoryAbi = factoryAbi;
export const ponsTokenReadAbi = tokenAbi;

/** Stable digest marker for receipt verification. */
export function ponsDigestPayload(call: { to: Address; data: Hex; value: bigint; salt: Hex; expectedEconomics: Hex }): string {
  return JSON.stringify({
    kind: "pons_v2_launch",
    to: call.to,
    data: call.data,
    value: numberToHex(call.value),
    salt: call.salt,
    expectedEconomics: call.expectedEconomics,
  });
}

function numberToHex(n: bigint): Hex {
  return `0x${n.toString(16)}` as Hex;
}

export async function ponsLaunchFee(client: PublicClient, factory: Address): Promise<bigint> {
  return client.readContract({ address: factory, abi: factoryAbi, functionName: "launchFee" });
}

import { decodeAbiParameters, decodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { formatUnits } from "../../util/amount.js";
import type { Step } from "../../intents/types.js";
import { COMPILER, tokenArtifact } from "./token.js";

/** The exact call the wallet is asked to send. `to` is null for a contract deployment. */
export interface EvmCall {
  from: Hex;
  to: Hex | null;
  data: Hex;
  value: Hex;
  chainId: Hex;
}

export type DecodedCall =
  | { kind: "deploy_token"; name: string; symbol: string; decimals: number; supply: bigint; steps: Step[] }
  | { kind: "native_transfer"; to: Hex; amount: bigint; steps: Step[] }
  | { kind: "token_transfer"; token: Hex; to: Hex; amount: bigint; steps: Step[] };

export class UnknownCallError extends Error {}

interface TokenFacts {
  symbol: string;
  decimals: number;
}

const CTOR = [
  { type: "string", name: "name" },
  { type: "string", name: "symbol" },
  { type: "uint8", name: "decimals" },
  { type: "uint256", name: "supply" },
] as const;

/** Turns call bytes back into plain-language steps. Anything that is not one of the three allowed shapes is refused. */
export function decodeCall(call: EvmCall, nativeSymbol: string, tokens: Map<string, TokenFacts>): DecodedCall {
  const value = BigInt(call.value);
  if (call.to === null) {
    const { bytecode } = tokenArtifact();
    if (!call.data.toLowerCase().startsWith(bytecode.toLowerCase())) {
      throw new UnknownCallError("This deployment is not promptfun's fixed-supply token contract.");
    }
    if (value !== 0n) throw new UnknownCallError("A token deployment must not send any coins.");
    const [name, symbol, decimals, supply] = decodeAbiParameters(CTOR, `0x${call.data.slice(bytecode.length)}`);
    return {
      kind: "deploy_token",
      name,
      symbol,
      decimals,
      supply,
      steps: [
        { program: "EVM", text: `Deploy a new ERC-20 token contract from your wallet ${getAddress(call.from)} (OpenZeppelin ERC20, solc ${COMPILER.version}). Its address is assigned when it lands.` },
        { program: "ERC-20", text: `Name "${name}", symbol ${symbol}, ${decimals} decimals.` },
        { program: "ERC-20", text: `Mint ${formatUnits(supply, decimals)} ${symbol} once, to your wallet.` },
        { program: "ERC-20", text: "No owner and no mint function: the supply is fixed forever." },
      ],
    };
  }
  if (call.data === "0x") {
    return {
      kind: "native_transfer",
      to: getAddress(call.to),
      amount: value,
      steps: [{ program: "EVM", text: `Send ${formatUnits(value, 18)} ${nativeSymbol} to ${getAddress(call.to)}.` }],
    };
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
  } catch {
    throw new UnknownCallError("This call is not an ERC-20 transfer.");
  }
  if (decoded.functionName !== "transfer") throw new UnknownCallError(`ERC-20 ${decoded.functionName} is not allowed; only transfer.`);
  if (value !== 0n) throw new UnknownCallError(`A token transfer must not also send ${nativeSymbol}.`);
  const [to, amount] = decoded.args as readonly [Hex, bigint];
  const token = getAddress(call.to);
  const facts = tokens.get(token.toLowerCase());
  const shown = facts ? `${formatUnits(amount, facts.decimals)} ${facts.symbol}` : `${amount} base units`;
  return {
    kind: "token_transfer",
    token,
    to: getAddress(to),
    amount,
    steps: [{ program: "ERC-20", text: `Call transfer on token ${token}: send ${shown} to ${getAddress(to)}.` }],
  };
}

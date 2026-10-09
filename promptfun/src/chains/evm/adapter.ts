import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  numberToHex,
  zeroAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { estimateL1Fee } from "viem/op-stack";
import type { ChainAdapter, SubmitResult } from "../adapter.js";
import { explorerLink, type Chain, type EvmChain } from "../registry.js";
import { formatUnits, parseUnits } from "../../util/amount.js";
import { usdValue } from "../../util/price.js";
import type { Built, Cost, Intent, LaunchParams, Receipt, Simulation, TransferParams } from "../../intents/types.js";
import { IntentError } from "../../intents/types.js";
import { decodeCall, UnknownCallError, type DecodedCall, type EvmCall } from "./decode.js";
import { deployData, tokenArtifact } from "./token.js";

const UINT256_MAX = 2n ** 256n - 1n;
const OP_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

const clients = new Map<string, PublicClient>();

export function clientFor(chain: EvmChain): PublicClient {
  const key = `${chain.chainId}:${chain.rpcUrl}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({
      chain: defineChain({
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [chain.rpcUrl] } },
      }),
      transport: http(chain.rpcUrl, { timeout: 20_000, retryCount: 2 }),
    }) as PublicClient;
    clients.set(key, client);
  }
  return client;
}

function asEvm(chain: Chain): EvmChain {
  if (chain.family !== "evm") throw new Error("not an EVM chain");
  return chain;
}

function native(chain: EvmChain, wei: bigint): string {
  return formatUnits(wei, 18);
}

const ESTIMATE_STEP = 10n ** 10n;

/** Fee estimates are shown to 8 decimals, rounded up so the preview never understates the cost. */
function roundUp(wei: bigint): bigint {
  return ((wei + ESTIMATE_STEP - 1n) / ESTIMATE_STEP) * ESTIMATE_STEP;
}

function gwei(wei: bigint): string {
  return formatUnits(wei, 9);
}

function isWallet(address: string): address is Hex {
  return isAddress(address, { strict: true }) && address.toLowerCase() !== zeroAddress;
}

function resolveAsset(chain: EvmChain, asset: string): "native" | Hex {
  if (asset === "native" || asset.toUpperCase() === chain.nativeSymbol) return "native";
  const known = chain.tokens.find((token) => token.symbol.toUpperCase() === asset.toUpperCase());
  const address = known ? known.address : asset;
  if (!isAddress(address, { strict: true })) throw new IntentError(`"${asset}" is not a token contract address on ${chain.name}.`);
  return getAddress(address);
}

async function tokenFacts(client: PublicClient, token: Hex): Promise<{ symbol: string; decimals: number }> {
  const code = await client.getCode({ address: token });
  if (!code || code === "0x") throw new IntentError(`There is no contract at ${token} on this network.`);
  try {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "tokens"),
    ]);
    return { symbol: String(symbol).slice(0, 16), decimals: Number(decimals) };
  } catch {
    throw new IntentError(`${token} does not look like an ERC-20 token (no decimals()).`);
  }
}

function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.reason ?? revert.shortMessage;
    return err.shortMessage || err.message.split("\n")[0];
  }
  return String((err as Error)?.message ?? err).split("\n")[0];
}

interface Compiled {
  call: EvmCall;
  tokens: Map<string, { symbol: string; decimals: number }>;
  check(decoded: DecodedCall): void;
}

function compile(chain: EvmChain, intent: Intent, signer: Hex, client: PublicClient): Promise<Compiled> | Compiled {
  const chainId = numberToHex(chain.chainId);
  if (intent.kind === "launch_token") {
    const p = intent.params as LaunchParams;
    const supply = parseUnits(p.supply, p.decimals);
    return {
      call: { from: signer, to: null, data: deployData(p.name, p.symbol, p.decimals, supply), value: "0x0", chainId },
      tokens: new Map(),
      check(d) {
        if (d.kind !== "deploy_token" || d.name !== p.name || d.symbol !== p.symbol || d.decimals !== p.decimals || d.supply !== supply) {
          throw new Error("Compiled deployment does not match the request.");
        }
      },
    };
  }
  const p = intent.params as TransferParams;
  const asset = resolveAsset(chain, p.asset);
  const to = getAddress(p.to);
  if (asset === "native") {
    const amount = parseUnits(p.amount, 18);
    return {
      call: { from: signer, to, data: "0x", value: numberToHex(amount), chainId },
      tokens: new Map(),
      check(d) {
        if (d.kind !== "native_transfer" || d.to !== to || d.amount !== amount) throw new Error("Compiled transfer does not match the request.");
      },
    };
  }
  return tokenFacts(client, asset).then((facts) => {
    const amount = parseUnits(p.amount, facts.decimals);
    return {
      call: { from: signer, to: asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), value: "0x0", chainId },
      tokens: new Map([[asset.toLowerCase(), facts]]),
      check(d) {
        if (d.kind !== "token_transfer" || d.token !== asset || d.to !== to || d.amount !== amount) throw new Error("Compiled transfer does not match the request.");
      },
    };
  });
}

interface Digest {
  call: EvmCall;
  /** keccak256 of the runtime code the deployment must leave behind (launches only). */
  codeHash: Hex | null;
}

export const evmAdapter: ChainAdapter = {
  isAddress: isWallet,

  async check(chainArg, intent) {
    const chain = asEvm(chainArg);
    const issues: string[] = [];
    if (intent.kind === "launch_token") {
      const p = intent.params as LaunchParams;
      if (p.venue !== "erc20") issues.push(`${chain.name} launches are ERC-20 tokens; ${p.venue} is not available here.`);
      if (!p.fixedSupply) issues.push("EVM launches are always fixed supply: the contract has no mint function.");
      if (p.metadataUri) issues.push("ERC-20 tokens have no on-chain metadata link. Leave metadataUri out.");
      if (BigInt(p.supply) * 10n ** BigInt(p.decimals) > UINT256_MAX) issues.push("That supply is too large for these decimals.");
      return issues;
    }
    const p = intent.params as TransferParams;
    if (!isWallet(p.to)) issues.push(`"${p.to}" is not a ${chain.name} address (use the 0x… form; mixed case must be a valid checksum).`);
    const asset = resolveAsset(chain, p.asset);
    if (asset !== "native") {
      const facts = await tokenFacts(clientFor(chain), asset);
      try {
        if (parseUnits(p.amount, facts.decimals) <= 0n) issues.push("The amount must be more than zero.");
      } catch (err) {
        issues.push((err as Error).message);
      }
    }
    return issues;
  },

  async build(chainArg, intent, signerText) {
    const chain = asEvm(chainArg);
    if (!isWallet(signerText)) throw new IntentError("The connected account is not an EVM address.");
    const signer = getAddress(signerText);
    const client = clientFor(chain);
    const remoteId = await client.getChainId();
    if (remoteId !== chain.chainId) throw new Error(`RPC for ${chain.name} reports chain ${remoteId}, expected ${chain.chainId}.`);

    const compiled = await compile(chain, intent, signer, client);
    const { call } = compiled;
    let decoded: DecodedCall;
    try {
      decoded = decodeCall(call, chain.nativeSymbol, compiled.tokens);
    } catch (err) {
      if (err instanceof UnknownCallError) throw new IntentError(err.message, "refused");
      throw err;
    }
    compiled.check(decoded);

    const request = { account: signer, to: call.to ?? undefined, data: call.data, value: BigInt(call.value) } as const;
    const at = new Date().toISOString();
    const [balance, block] = await Promise.all([client.getBalance({ address: signer }), client.getBlock({ blockTag: "latest" })]);
    let simulation: Simulation;
    let codeHash: Hex | null = null;
    let gas: bigint;
    try {
      const result = await client.call(request);
      if (call.to === null) {
        if (!result.data || result.data === "0x") throw new Error("The deployment would leave no contract code.");
        codeHash = keccak256(result.data);
      }
      gas = await client.estimateGas(request);
      simulation = { ok: true, error: null, logs: [], unitsConsumed: Number(gas), at };
    } catch (err) {
      const reason = revertReason(err);
      if (BigInt(call.value) > balance) {
        throw new IntentError(`Not enough ${chain.nativeSymbol}: this sends ${native(chain, BigInt(call.value))} and the wallet has ${native(chain, balance)}.`, "insufficient");
      }
      throw new IntentError(`The network says this transaction would fail: ${reason}. Nothing was sent.`, "simulation");
    }

    let feeBasis: string;
    let expected: bigint;
    let maximum: bigint;
    if (block.baseFeePerGas != null) {
      const fees = await client.estimateFeesPerGas();
      const tip = fees.maxPriorityFeePerGas ?? 0n;
      expected = gas * (block.baseFeePerGas + tip);
      maximum = gas * (fees.maxFeePerGas ?? block.baseFeePerGas + tip);
      feeBasis = `eth_estimateGas ${gas} gas × ${gwei(block.baseFeePerGas + tip)} gwei (base fee ${gwei(block.baseFeePerGas)} + tip ${gwei(tip)}) from block ${block.number}.`;
    } else {
      const price = await client.getGasPrice();
      expected = maximum = gas * price;
      feeBasis = `eth_estimateGas ${gas} gas × ${gwei(price)} gwei gas price.`;
    }
    if (chain.stack === "arbitrum-nitro") feeBasis += " On Arbitrum Nitro chains the gas estimate already includes the L1 data cost.";
    if (chain.stack === "op-stack") {
      const l1 = await estimateL1Fee(client as never, { ...request, chain: client.chain, gasPriceOracleAddress: OP_GAS_PRICE_ORACLE } as never);
      expected += l1;
      maximum += l1;
      feeBasis += ` Plus ${native(chain, l1)} ${chain.nativeSymbol} L1 data fee from the GasPriceOracle predeploy.`;
    }

    expected = roundUp(expected);
    maximum = roundUp(maximum);
    const sends = BigInt(call.value);
    const total = expected + sends;
    const usd = await usdValue(chain.nativeSymbol, native(chain, expected), chain.testnet);
    const cost: Cost = {
      label: `Network fee (paid to ${chain.name}, not promptfun)`,
      networkFee: native(chain, expected),
      feeBasis,
      deposits: "0",
      sends: native(chain, sends),
      total: native(chain, total),
      symbol: chain.nativeSymbol,
      balance: native(chain, (balance / ESTIMATE_STEP) * ESTIMATE_STEP),
      enough: balance >= maximum + sends,
      note: maximum > expected
        ? `Estimate at today's gas price. Your wallet sets the final fee; it is capped at about ${native(chain, maximum)} ${chain.nativeSymbol} if the base fee rises before the transaction lands.`
        : "Estimate at today's gas price. Your wallet shows the final fee before you confirm.",
      usd: usd?.usd ?? null,
      usdSource: usd?.source ?? (chain.testnet ? `Testnet ${chain.nativeSymbol} has no market value; no USD shown.` : "No fresh price available; no USD shown."),
      promptfunFee: "0",
    };

    const digest: Digest = { call, codeHash };
    return {
      signer,
      payload: JSON.stringify(call),
      digest: JSON.stringify(digest),
      steps: decoded.steps,
      simulation,
      cost,
      builtAt: at,
      validUntil: null,
      tokenAddress: null,
      extraSigners: [],
    } satisfies Built;
  },

  async submit(chainArg, intent, walletPayload): Promise<SubmitResult> {
    const chain = asEvm(chainArg);
    const built = intent.built;
    if (!built) throw new IntentError("Nothing has been built for this request yet.");
    const hash = walletPayload.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new IntentError("The wallet did not return a transaction hash.");
    const client = clientFor(chain);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const tx = await client.getTransaction({ hash: hash as Hex }).catch(() => null);
      if (tx) {
        if (tx.from.toLowerCase() !== built.signer.toLowerCase()) {
          throw new IntentError("That transaction was not sent by the connected wallet.", "mismatch");
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { id: hash.toLowerCase() };
  },

  async receipt(chainArg, intent): Promise<Receipt | null> {
    const chain = asEvm(chainArg);
    const client = clientFor(chain);
    const hash = intent.submission?.id as Hex | undefined;
    const built = intent.built;
    if (!hash || !built) return null;
    const digest = JSON.parse(built.digest) as Digest;
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) {
      const age = Date.now() - Date.parse(intent.submission!.submittedAt);
      if (age < GIVE_UP_AFTER_MS) return null;
      return {
        id: hash,
        status: "failed",
        slotOrBlock: Number(await client.getBlockNumber()),
        fee: "0",
        feeSymbol: chain.nativeSymbol,
        explorerUrl: explorerLink(chain, "tx", hash),
        verified: ["The transaction was not seen on chain for 24 hours. If your wallet still shows it pending, cancel it there."],
        tokenAddress: null,
        tokenExplorerUrl: null,
        confirmedAt: new Date().toISOString(),
      };
    }
    const tx = await client.getTransaction({ hash });
    const raw = await client.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { l1Fee?: Hex } | null;
    const verified: string[] = [];
    let status: "success" | "failed" = receipt.status === "success" ? "success" : "failed";
    const want = digest.call;
    const fieldChecks: Array<[boolean, string]> = [
      [tx.from.toLowerCase() === want.from.toLowerCase(), `it to be sent from ${getAddress(want.from)}, but it came from ${getAddress(tx.from)}.`],
      [(tx.to?.toLowerCase() ?? null) === (want.to?.toLowerCase() ?? null), want.to ? `it to go to ${getAddress(want.to)}, but it went to ${tx.to ? getAddress(tx.to) : "a new contract"}.` : `a contract deployment, but it went to ${tx.to}.`],
      [tx.input.toLowerCase() === want.data.toLowerCase(), "call data byte-identical to the preview, but it differs."],
      [tx.value === BigInt(want.value), `a value of ${native(chain, BigInt(want.value))} ${chain.nativeSymbol}, but it sent ${native(chain, tx.value)} ${chain.nativeSymbol}.`],
      [tx.chainId === undefined || tx.chainId === Number(BigInt(want.chainId)), `chain ID ${Number(BigInt(want.chainId))}, but it was ${tx.chainId}.`],
    ];
    const differs = fieldChecks.filter(([ok]) => !ok);
    if (differs.length) {
      status = "failed";
      verified.push("MISMATCH: your wallet sent a different transaction than the one previewed.");
      for (const [, text] of differs) verified.push(`MISMATCH: the preview expected ${text}`);
    }
    if (receipt.status !== "success") verified.push("The transaction reverted on chain. Only the network fee was spent.");

    let tokenAddress: Hex | null = null;
    if (status === "success" && intent.kind === "launch_token") {
      const p = intent.params as LaunchParams;
      tokenAddress = receipt.contractAddress ? getAddress(receipt.contractAddress) : null;
      if (!tokenAddress) {
        status = "failed";
        verified.push("MISMATCH: no contract was created.");
      } else {
        const blockNumber = receipt.blockNumber;
        const { abi } = tokenArtifact();
        const read = <T>(functionName: string, args: unknown[] = []) =>
          client.readContract({ address: tokenAddress!, abi, functionName, args, blockNumber } as never) as Promise<T>;
        const [code, name, symbol, decimals, totalSupply, held] = await Promise.all([
          client.getCode({ address: tokenAddress, blockNumber }),
          read<string>("name"),
          read<string>("symbol"),
          read<number>("decimals"),
          read<bigint>("totalSupply"),
          read<bigint>("balanceOf", [want.from]),
        ]);
        const supply = parseUnits(p.supply, p.decimals);
        const checks: Array<[boolean, string]> = [
          [!!code && keccak256(code) === digest.codeHash, "Deployed code is byte-identical to promptfun's fixed-supply token (no owner, no mint function)."],
          [totalSupply === supply, `Supply on chain is ${formatUnits(totalSupply, Number(decimals))} ${symbol}.`],
          [Number(decimals) === p.decimals, `Decimals on chain: ${decimals}.`],
          [held === supply, "Your wallet holds the full supply."],
          [name === p.name && symbol === p.symbol, `Name and symbol on chain: ${name} (${symbol}).`],
        ];
        for (const [ok, text] of checks) verified.push(ok ? text : `MISMATCH: ${text}`);
        if (checks.some(([ok]) => !ok)) status = "failed";
      }
    } else if (status === "success" && intent.kind === "transfer") {
      const p = intent.params as TransferParams;
      const asset = resolveAsset(chain, p.asset);
      const to = getAddress(p.to);
      if (asset === "native") {
        verified.push(`${to} received ${native(chain, tx.value)} ${chain.nativeSymbol} in block ${receipt.blockNumber}.`);
      } else {
        const facts = await tokenFacts(client, asset);
        const amount = parseUnits(p.amount, facts.decimals);
        const moved = receipt.logs.some((log) => {
          if (log.address.toLowerCase() !== asset.toLowerCase()) return false;
          try {
            const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
            return event.eventName === "Transfer" && event.args.from.toLowerCase() === want.from.toLowerCase()
              && event.args.to.toLowerCase() === to.toLowerCase() && event.args.value === amount;
          } catch {
            return false;
          }
        });
        verified.push(moved
          ? `${to} received ${formatUnits(amount, facts.decimals)} ${facts.symbol} (Transfer event from ${asset}).`
          : "MISMATCH: no matching Transfer event from the token contract.");
        if (!moved) status = "failed";
      }
    }

    const l1Fee = raw?.l1Fee ? BigInt(raw.l1Fee) : 0n;
    const paid = receipt.gasUsed * receipt.effectiveGasPrice + l1Fee;
    return {
      id: hash,
      status,
      slotOrBlock: Number(receipt.blockNumber),
      fee: native(chain, paid),
      feeSymbol: chain.nativeSymbol,
      explorerUrl: explorerLink(chain, "tx", hash),
      verified,
      tokenAddress,
      tokenExplorerUrl: tokenAddress ? explorerLink(chain, "address", tokenAddress) : null,
      confirmedAt: new Date().toISOString(),
    };
  },

  async balance(chainArg, address, token) {
    const chain = asEvm(chainArg);
    if (!isAddress(address, { strict: true })) throw new IntentError(`"${address}" is not an EVM address.`);
    const client = clientFor(chain);
    const asset = token ? resolveAsset(chain, token) : "native";
    if (asset === "native") return { amount: native(chain, await client.getBalance({ address: getAddress(address) })), symbol: chain.nativeSymbol };
    const facts = await tokenFacts(client, asset);
    const amount = await client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });
    return { amount: formatUnits(amount, facts.decimals), symbol: facts.symbol };
  },
};

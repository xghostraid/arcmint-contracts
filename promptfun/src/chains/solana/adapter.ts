import { createPublicKey, verify } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAccountLen,
  getAssociatedTokenAddressSync,
  getMint,
  getMintLen,
  getTokenMetadata,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import bs58 from "bs58";
import type { ChainAdapter, SubmitResult } from "../adapter.js";
import { explorerLink, type Chain, type SolanaChain } from "../registry.js";
import { formatUnits, parseUnits } from "../../util/amount.js";
import { usdValue } from "../../util/price.js";
import type { Built, Cost, Intent, LaunchParams, Receipt, Simulation, TransferParams } from "../../intents/types.js";
import { IntentError } from "../../intents/types.js";
import { decodeInstructions, isWalletAddress, type DecodedTx, type MintFacts } from "./decode.js";
import { buildPumpfunLaunch } from "./pumpfun.js";

const connections = new Map<string, Connection>();

export function connectionFor(chain: SolanaChain): Connection {
  let conn = connections.get(chain.rpcUrl);
  if (!conn) {
    conn = new Connection(chain.rpcUrl, { commitment: "confirmed" });
    connections.set(chain.rpcUrl, conn);
  }
  return conn;
}

function asSolana(chain: Chain): SolanaChain {
  if (chain.family !== "solana") throw new Error("not a Solana chain");
  return chain;
}

/** Mint address for a launch: derived from the user's key and the intent, so the user's wallet is the only signer. */
export function launchSeed(intentId: string): string {
  return `pf${intentId.replace(/^int_/, "").slice(0, 24)}`;
}

function sol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

async function tokenProgramOf(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new IntentError(`Token ${mint.toBase58()} does not exist on this network.`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new IntentError(`${mint.toBase58()} is not a token mint.`);
}

function resolveAsset(chain: SolanaChain, asset: string): string {
  if (asset === "native" || asset.toUpperCase() === chain.nativeSymbol) return "native";
  const known = chain.tokens.find((token) => token.symbol.toUpperCase() === asset.toUpperCase());
  return known ? known.address : asset;
}

function verifyEd25519(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey.toBytes()).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

async function simulate(conn: Connection, tx: VersionedTransaction): Promise<Simulation> {
  const at = new Date().toISOString();
  try {
    const result = await conn.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed" });
    const logs = result.value.logs ?? [];
    if (result.value.err) {
      const failing = [...logs].reverse().find((line) => /failed|error|insufficient/i.test(line));
      return {
        ok: false,
        error: failing ?? JSON.stringify(result.value.err),
        logs: logs.slice(-12),
        unitsConsumed: result.value.unitsConsumed ?? null,
        at,
      };
    }
    return { ok: true, error: null, logs: logs.slice(-12), unitsConsumed: result.value.unitsConsumed ?? null, at };
  } catch (err) {
    return { ok: false, error: `Simulation could not run: ${(err as Error).message}`, logs: [], unitsConsumed: null, at };
  }
}

interface Compiled {
  instructions: TransactionInstruction[];
  mints: Map<string, MintFacts>;
  deposits: bigint;
  sendsLamports: bigint;
  tokenAddress: string | null;
  extraSigners?: string[];
  check: (decoded: DecodedTx) => void;
}

async function compileLaunch(chain: SolanaChain, intent: Intent, signer: PublicKey): Promise<Compiled> {
  const conn = connectionFor(chain);
  const params = intent.params as LaunchParams;
  const seed = launchSeed(intent.id);
  const mint = await PublicKey.createWithSeed(signer, seed, TOKEN_2022_PROGRAM_ID);
  const existing = await conn.getAccountInfo(mint, "confirmed");
  if (existing) throw new IntentError(`The token for this request already exists at ${mint.toBase58()}.`, "exists");

  const metadata: TokenMetadata = {
    updateAuthority: signer,
    mint,
    name: params.name,
    symbol: params.symbol,
    uri: params.metadataUri,
    additionalMetadata: [],
  };
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const mintRent = BigInt(await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen));
  const ata = getAssociatedTokenAddressSync(mint, signer, false, TOKEN_2022_PROGRAM_ID);
  const ataRent = BigInt(await conn.getMinimumBalanceForRentExemption(getAccountLen([ExtensionType.ImmutableOwner])));
  const supply = parseUnits(params.supply, params.decimals);

  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccountWithSeed({
      fromPubkey: signer,
      newAccountPubkey: mint,
      basePubkey: signer,
      seed,
      lamports: Number(mintRent),
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(mint, signer, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, params.decimals, signer, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: signer,
      mint,
      mintAuthority: signer,
      name: params.name,
      symbol: params.symbol,
      uri: params.metadataUri,
    }),
    createAssociatedTokenAccountIdempotentInstruction(signer, ata, signer, mint, TOKEN_2022_PROGRAM_ID),
    createMintToCheckedInstruction(mint, ata, signer, supply, params.decimals, [], TOKEN_2022_PROGRAM_ID),
  ];
  if (params.fixedSupply) {
    instructions.push(createSetAuthorityInstruction(mint, signer, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID));
  }

  return {
    instructions,
    mints: new Map([[mint.toBase58(), { decimals: params.decimals, symbol: params.symbol }]]),
    deposits: mintRent + ataRent,
    sendsLamports: 0n,
    tokenAddress: mint.toBase58(),
    check(decoded) {
      const ok =
        decoded.createdMint?.mint === mint.toBase58() &&
        decoded.createdMint.base === signer.toBase58() &&
        decoded.mintInit?.decimals === params.decimals &&
        decoded.mintInit.freezeAuthority === null &&
        decoded.metadata?.name === params.name &&
        decoded.metadata.symbol === params.symbol &&
        decoded.metadata.uri === params.metadataUri &&
        decoded.mintedTo?.account === ata.toBase58() &&
        decoded.mintedTo.amount === supply &&
        decoded.mintAuthorityRevoked === params.fixedSupply;
      if (!ok) throw new Error("Compiled launch does not decode back to the request. Refusing to show it.");
    },
  };
}

async function compileTransfer(chain: SolanaChain, intent: Intent, signer: PublicKey): Promise<Compiled> {
  const conn = connectionFor(chain);
  const params = intent.params as TransferParams;
  const to = new PublicKey(params.to);
  const asset = resolveAsset(chain, params.asset);
  if (asset === "native") {
    const lamports = parseUnits(params.amount, 9);
    return {
      instructions: [SystemProgram.transfer({ fromPubkey: signer, toPubkey: to, lamports })],
      mints: new Map(),
      deposits: 0n,
      sendsLamports: lamports,
      tokenAddress: null,
      check(decoded) {
        const t = decoded.solTransfers;
        if (t.length !== 1 || t[0].to !== to.toBase58() || t[0].lamports !== lamports || t[0].from !== signer.toBase58()) {
          throw new Error("Compiled transfer does not decode back to the request. Refusing to show it.");
        }
      },
    };
  }
  const mint = new PublicKey(asset);
  const programId = await tokenProgramOf(conn, mint);
  const info = await getMint(conn, mint, "confirmed", programId);
  const amount = parseUnits(params.amount, info.decimals);
  const symbol = chain.tokens.find((t) => t.address === mint.toBase58())?.symbol ?? (await symbolOf(conn, mint, programId));
  const source = getAssociatedTokenAddressSync(mint, signer, false, programId);
  const dest = getAssociatedTokenAddressSync(mint, to, false, programId);
  const destInfo = await conn.getAccountInfo(dest, "confirmed");
  const ataRent = destInfo ? 0n : BigInt(await conn.getMinimumBalanceForRentExemption(
    programId.equals(TOKEN_2022_PROGRAM_ID) ? getAccountLen([ExtensionType.ImmutableOwner]) : 165,
  ));
  return {
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(signer, dest, to, mint, programId),
      createTransferCheckedInstruction(source, mint, dest, signer, amount, info.decimals, [], programId),
    ],
    mints: new Map([[mint.toBase58(), { decimals: info.decimals, symbol }]]),
    deposits: ataRent,
    sendsLamports: 0n,
    tokenAddress: null,
    check(decoded) {
      const t = decoded.tokenTransfers;
      if (t.length !== 1 || t[0].destination !== dest.toBase58() || t[0].amount !== amount || t[0].mint !== mint.toBase58() || t[0].owner !== signer.toBase58()) {
        throw new Error("Compiled transfer does not decode back to the request. Refusing to show it.");
      }
    },
  };
}

async function symbolOf(conn: Connection, mint: PublicKey, programId: PublicKey): Promise<string> {
  if (!programId.equals(TOKEN_2022_PROGRAM_ID)) return `${mint.toBase58().slice(0, 4)}…`;
  try {
    const meta = await getTokenMetadata(conn, mint, "confirmed", programId);
    return meta?.symbol || `${mint.toBase58().slice(0, 4)}…`;
  } catch {
    return `${mint.toBase58().slice(0, 4)}…`;
  }
}

export const solanaAdapter: ChainAdapter = {
  isAddress: isWalletAddress,

  async check(chainArg, intent) {
    const chain = asSolana(chainArg);
    const issues: string[] = [];
    if (intent.kind === "transfer") {
      const params = intent.params as TransferParams;
      if (!isWalletAddress(params.to)) issues.push(`"${params.to}" is not a Solana wallet address.`);
      const asset = resolveAsset(chain, params.asset);
      if (asset !== "native") {
        try {
          const mint = new PublicKey(asset);
          await tokenProgramOf(connectionFor(chain), mint);
          if (asset === params.to) issues.push("The recipient is the token itself, not a wallet.");
        } catch (err) {
          issues.push(err instanceof IntentError ? err.message : `"${params.asset}" is not a token on ${chain.name}.`);
        }
      }
    } else {
      const params = intent.params as LaunchParams;
      if (!chain.launchVenues.includes(params.venue as "spl" | "pumpfun")) {
        issues.push(`${chain.name} launches use ${chain.launchVenues.join(" or ")}, not ${params.venue}.`);
      }
    }
    return issues;
  },

  async build(chainArg, intent, signerText, options) {
    const chain = asSolana(chainArg);
    if (!isWalletAddress(signerText)) throw new IntentError("The connected account is not a Solana wallet address.");
    const conn = connectionFor(chain);
    const signer = new PublicKey(signerText);
    const params = intent.params as LaunchParams;

    const compiled = intent.kind === "launch_token"
      ? (params.venue === "pumpfun" ? await buildPumpfunLaunch(conn, intent, signer, options?.mint) : await compileLaunch(chain, intent, signer))
      : await compileTransfer(chain, intent, signer);

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: blockhash,
      instructions: compiled.instructions,
    }).compileToLegacyMessage();
    const tx = new VersionedTransaction(message);

    const decoded = decodeInstructions(TransactionMessage.decompile(message).instructions, compiled.mints);
    compiled.check(decoded);

    const [simulation, feeResult, balanceLamports] = await Promise.all([
      simulate(conn, tx),
      conn.getFeeForMessage(message, "confirmed"),
      conn.getBalance(signer, "confirmed"),
    ]);
    if (feeResult.value == null) throw new IntentError("The network could not price this transaction. Try again.", "fee_unavailable");
    const fee = BigInt(feeResult.value);
    const total = fee + compiled.deposits + compiled.sendsLamports;
    const balance = BigInt(balanceLamports);
    const networkCost = fee + compiled.deposits;
    const usd = await usdValue("SOL", sol(networkCost), chain.testnet);
    const cost: Cost = {
      label: `Network fee (paid to ${chain.name}, not promptfun)`,
      networkFee: sol(fee),
      feeBasis: `getFeeForMessage on this exact message: ${message.header.numRequiredSignatures} signature(s) × ${fee / BigInt(message.header.numRequiredSignatures)} lamports. No priority fee added.`,
      deposits: sol(compiled.deposits),
      sends: sol(compiled.sendsLamports),
      total: sol(total),
      symbol: "SOL",
      balance: sol(balance),
      enough: balance >= total,
      note: compiled.deposits > 0n
        ? "Rent deposits are SOL that Solana requires new accounts to hold. A token account's deposit comes back if you close it; a mint's deposit stays locked with the token. They are network costs, not a promptfun fee."
        : null,
      usd: usd?.usd ?? null,
      usdSource: usd?.source ?? (chain.testnet ? "Testnet SOL has no market value; no USD shown." : "No fresh price available; no USD shown."),
      promptfunFee: "0",
    };

    const built: Built = {
      signer: signer.toBase58(),
      payload: Buffer.from(tx.serialize()).toString("base64"),
      digest: Buffer.from(message.serialize()).toString("base64"),
      steps: decoded.steps,
      simulation,
      cost,
      builtAt: new Date().toISOString(),
      validUntil: lastValidBlockHeight,
      tokenAddress: compiled.tokenAddress,
      extraSigners: compiled.extraSigners ?? [],
    };
    return built;
  },

  async submit(chainArg, intent, walletPayload): Promise<SubmitResult> {
    const chain = asSolana(chainArg);
    const built = intent.built;
    if (!built) throw new IntentError("Nothing has been built for this request yet.");
    let tx: VersionedTransaction;
    let raw: Buffer;
    try {
      raw = Buffer.from(walletPayload, "base64");
      tx = VersionedTransaction.deserialize(raw);
    } catch {
      throw new IntentError("The wallet returned something that is not a Solana transaction.");
    }
    const signedMessage = Buffer.from(tx.message.serialize());
    if (!signedMessage.equals(Buffer.from(built.digest, "base64"))) {
      throw new IntentError(
        "Your wallet signed a different transaction than the one previewed. promptfun did not send it.",
        "mismatch",
      );
    }
    const signer = new PublicKey(built.signer);
    const required = tx.message.header.numRequiredSignatures;
    const keys = tx.message.staticAccountKeys;
    if (!keys[0].equals(signer)) throw new IntentError("The fee payer is not the connected wallet.", "mismatch");
    for (let i = 0; i < required; i += 1) {
      if (!verifyEd25519(keys[i], signedMessage, tx.signatures[i])) {
        throw new IntentError("A signature on this transaction is missing or invalid. promptfun did not send it.", "signature");
      }
    }
    const conn = connectionFor(chain);
    const expected = bs58.encode(tx.signatures[0]);
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
    } catch (err) {
      const message = (err as Error).message || String(err);
      if (/blockhash not found|block height exceeded/i.test(message)) {
        throw new IntentError("The signed transaction went stale before it was sent. Approve again to rebuild it.", "stale");
      }
      throw new IntentError(`The network rejected the transaction: ${message.slice(0, 300)}`, "rejected");
    }
    if (signature !== expected) throw new Error("RPC returned a different signature than the signed transaction.");
    return { id: signature };
  },

  async receipt(chainArg, intent): Promise<Receipt | null> {
    const chain = asSolana(chainArg);
    const conn = connectionFor(chain);
    const signature = intent.submission?.id;
    const built = intent.built;
    if (!signature || !built) return null;
    const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) {
      const height = await conn.getBlockHeight("confirmed");
      if (built.validUntil != null && height > built.validUntil + 10) {
        return {
          id: signature,
          status: "failed",
          slotOrBlock: height,
          fee: "0",
          feeSymbol: "SOL",
          explorerUrl: explorerLink(chain, "tx", signature),
          verified: ["The transaction never landed before its blockhash expired. Nothing was spent."],
          tokenAddress: null,
          tokenExplorerUrl: null,
          confirmedAt: new Date().toISOString(),
        };
      }
      return null;
    }
    const meta = tx.meta;
    const verified: string[] = [];
    let status: "success" | "failed" = meta?.err ? "failed" : "success";
    if (meta?.err) verified.push(`The transaction failed on chain: ${JSON.stringify(meta.err)}.`);

    if (status === "success") {
      if (intent.kind === "launch_token" && built.tokenAddress && (intent.params as LaunchParams).venue === "pumpfun") {
        const params = intent.params as LaunchParams;
        const mint = new PublicKey(built.tokenAddress);
        const programId = await tokenProgramOf(conn, mint);
        const info = await getMint(conn, mint, "confirmed", programId);
        const meta2022 = programId.equals(TOKEN_2022_PROGRAM_ID)
          ? await getTokenMetadata(conn, mint, "confirmed", programId).catch(() => null)
          : null;
        const checks: Array<[boolean, string]> = [
          [info.isInitialized, `The pump.fun coin exists at ${mint.toBase58()}.`],
          [info.decimals === 6, `Decimals on chain: ${info.decimals}.`],
          [!meta2022 || (meta2022.name === params.name && meta2022.symbol === params.symbol), `Name and symbol on chain: ${meta2022?.name ?? "(Metaplex metadata, not read)"} (${meta2022?.symbol ?? "-"}).`],
        ];
        for (const [ok, text] of checks) verified.push(ok ? text : `MISMATCH: ${text}`);
        if (checks.some(([ok]) => !ok)) status = "failed";
      } else if (intent.kind === "launch_token" && built.tokenAddress) {
        const params = intent.params as LaunchParams;
        const mint = new PublicKey(built.tokenAddress);
        const info = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
        const supply = parseUnits(params.supply, params.decimals);
        const meta2022 = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
        const holder = (meta?.postTokenBalances ?? []).find((b) => b.mint === built.tokenAddress && b.owner === built.signer);
        const checks: Array<[boolean, string]> = [
          [info.supply === supply, `Supply on chain is ${formatUnits(info.supply, info.decimals)} ${params.symbol}.`],
          [info.decimals === params.decimals, `Decimals on chain: ${info.decimals}.`],
          [holder?.uiTokenAmount.amount === supply.toString(), `Your wallet holds the full supply.`],
          [meta2022?.name === params.name && meta2022?.symbol === params.symbol, `Name and symbol on chain: ${meta2022?.name} (${meta2022?.symbol}).`],
          [!params.fixedSupply || info.mintAuthority === null, params.fixedSupply ? "Mint authority is revoked; supply is fixed." : "Mint authority stays with your wallet."],
          [info.freezeAuthority === null, "No freeze authority."],
        ];
        for (const [ok, text] of checks) verified.push(ok ? text : `MISMATCH: ${text}`);
        if (checks.some(([ok]) => !ok)) status = "failed";
      } else if (intent.kind === "transfer") {
        const params = intent.params as TransferParams;
        const asset = resolveAsset(chain, params.asset);
        const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
        if (asset === "native") {
          const index = keys.indexOf(params.to);
          const delta = index >= 0 && meta ? BigInt(meta.postBalances[index]) - BigInt(meta.preBalances[index]) : -1n;
          const want = parseUnits(params.amount, 9);
          const ok = delta === want;
          verified.push(ok ? `${params.to} received ${sol(want)} SOL.` : `MISMATCH: recipient balance changed by ${delta} lamports.`);
          if (!ok) status = "failed";
        } else {
          const pre = (meta?.preTokenBalances ?? []).find((b) => b.mint === asset && b.owner === params.to);
          const post = (meta?.postTokenBalances ?? []).find((b) => b.mint === asset && b.owner === params.to);
          const decimals = post?.uiTokenAmount.decimals ?? 0;
          const delta = BigInt(post?.uiTokenAmount.amount ?? "0") - BigInt(pre?.uiTokenAmount.amount ?? "0");
          const want = parseUnits(params.amount, decimals);
          const ok = delta === want;
          verified.push(ok ? `${params.to} received ${formatUnits(want, decimals)} of token ${asset}.` : `MISMATCH: recipient token balance changed by ${delta}.`);
          if (!ok) status = "failed";
        }
      }
    }

    return {
      id: signature,
      status,
      slotOrBlock: tx.slot,
      fee: sol(BigInt(meta?.fee ?? 0)),
      feeSymbol: "SOL",
      explorerUrl: explorerLink(chain, "tx", signature),
      verified,
      tokenAddress: built.tokenAddress,
      tokenExplorerUrl: built.tokenAddress ? explorerLink(chain, "address", built.tokenAddress) : null,
      confirmedAt: new Date().toISOString(),
    };
  },

  async balance(chainArg, address, token) {
    const chain = asSolana(chainArg);
    const conn = connectionFor(chain);
    const owner = new PublicKey(address);
    const asset = token ? resolveAsset(chain, token) : "native";
    if (asset === "native") {
      return { amount: sol(BigInt(await conn.getBalance(owner, "confirmed"))), symbol: "SOL" };
    }
    const mint = new PublicKey(asset);
    const programId = await tokenProgramOf(conn, mint);
    const info = await getMint(conn, mint, "confirmed", programId);
    const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
    const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
    const symbol = chain.tokens.find((t) => t.address === asset)?.symbol ?? (await symbolOf(conn, mint, programId));
    return { amount: formatUnits(BigInt(bal?.value.amount ?? "0"), info.decimals), symbol };
  },
};

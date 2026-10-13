import { createRequire } from "node:module";
import { Keypair, PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";

type PumpSdkModule = typeof import("@pump-fun/pump-sdk");
let pumpSdk: PumpSdkModule | null = null;
/** The SDK's ESM build fails to link (@pump-fun/agent-payments-sdk imports BN from anchor's ESM); its CJS build works. */
function sdk(): PumpSdkModule {
  pumpSdk ??= createRequire(import.meta.url)("@pump-fun/pump-sdk") as PumpSdkModule;
  return pumpSdk;
}
import type { Intent, LaunchParams } from "../../intents/types.js";
import { IntentError } from "../../intents/types.js";
import type { DecodedTx, MintFacts } from "./decode.js";
import { assertVersionedTxFits, SOLANA_TX_RAW_MAX, versionedTxWireSize } from "./tx-size.js";

/** pump.fun mints a fixed 1,000,000,000 supply with 6 decimals on its bonding curve; requests cannot change that. */
export const PUMPFUN_SUPPLY = "1000000000";
export const PUMPFUN_DECIMALS = 6;

export function generatePumpMintKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * pump.fun `create_v2` requires the new mint account to sign. promptfun does not hold that key either:
 * the approval page generates a one-time mint keypair in the browser, sends only its public key here,
 * partially signs with it, and discards it. The server checks every signature before relaying.
 */
export async function buildPumpfunLaunch(conn: Connection, intent: Intent, signer: PublicKey, mintAddress: string | undefined) {
  void conn;
  const params = intent.params as LaunchParams;
  if (!mintAddress) {
    throw new IntentError("pump.fun launches need a one-time mint key from the approval page. Open the approval link to continue.", "needs_mint");
  }
  let mint: PublicKey;
  try {
    mint = new PublicKey(mintAddress);
  } catch {
    throw new IntentError("The mint key from the approval page is not a valid Solana address.");
  }
  if (!params.metadataUri) throw new IntentError("pump.fun needs a metadata link (an IPFS or HTTPS JSON with name, symbol, image).");

  const ix = await sdk().PUMP_SDK.createV2Instruction({
    mint,
    name: params.name,
    symbol: params.symbol,
    uri: params.metadataUri,
    creator: signer,
    user: signer,
    mayhemMode: false,
  });

  return {
    instructions: [ix],
    mints: new Map<string, MintFacts>([[mint.toBase58(), { decimals: PUMPFUN_DECIMALS, symbol: params.symbol }]]),
    deposits: 0n,
    sendsLamports: 0n,
    tokenAddress: mint.toBase58(),
    extraSigners: [mint.toBase58()],
    check(decoded: DecodedTx) {
      const p = decoded.pumpCreate;
      const ok = p && p.mint === mint.toBase58() && p.user === signer.toBase58() && p.creator === signer.toBase58() &&
        p.name === params.name && p.symbol === params.symbol && p.uri === params.metadataUri && !p.mayhem;
      if (!ok) throw new Error("Compiled pump.fun launch does not decode back to the request. Refusing to show it.");
    },
  };
}

/**
 * Atomic sponsored pump.fun launch: create_v2 + fee-sharing config + locked fee shares.
 * Fee payer and on-chain creator for create_v2 are the sponsor; mint key is held server-side.
 */
export async function buildPumpfunLaunchSponsored(
  conn: Connection,
  intent: Intent,
  sponsor: PublicKey,
  mintKeypair: Keypair,
) {
  void conn;
  const params = intent.params as LaunchParams;
  if (!params.metadataUri) throw new IntentError("pump.fun needs a metadata link (an IPFS or HTTPS JSON with name, symbol, image).");

  const mint = mintKeypair.publicKey;
  const defaultRecipient = new PublicKey(params.feeRecipient ?? sponsor.toBase58());
  const shareholderRows =
    params.feeShareholders?.length
      ? params.feeShareholders
      : [{ address: defaultRecipient.toBase58(), shareBps: 10_000 }];
  const shareSum = shareholderRows.reduce((s, r) => s + r.shareBps, 0);
  if (shareSum !== 10_000) {
    throw new IntentError(`Creator fee shares must total 100% (10000 bps), got ${shareSum}.`);
  }
  const shareholders = shareholderRows.map((r) => ({ address: new PublicKey(r.address), shareBps: r.shareBps }));

  const pump = sdk().PUMP_SDK;
  const createIx = await pump.createV2Instruction({
    mint,
    name: params.name,
    symbol: params.symbol,
    uri: params.metadataUri,
    creator: sponsor,
    user: sponsor,
    mayhemMode: false,
  });
  const feeConfigIx = await pump.createFeeSharingConfig({ creator: sponsor, mint, pool: null });
  const feeShareIx = await pump.updateFeeShares({
    authority: sponsor,
    mint,
    currentShareholders: [],
    newShareholders: shareholders,
    bondingCurveComplete: false,
  });

  let instructions = [createIx, feeConfigIx, feeShareIx];
  let followUpInstructions: TransactionInstruction[] | undefined;
  let stagedInterimShareholder: (typeof shareholders)[number] | undefined;
  if (versionedTxWireSize(instructions, sponsor).raw > SOLANA_TX_RAW_MAX) {
    if (shareholders.length <= 1) {
      throw new IntentError(
        "Solana transaction too large for this launch. Shorten the metadata link or use a shorter coin name/symbol.",
        "tx_too_large",
      );
    }
    stagedInterimShareholder = shareholders[0];
    const interimShareIx = await pump.updateFeeShares({
      authority: sponsor,
      mint,
      currentShareholders: [],
      newShareholders: [{ address: stagedInterimShareholder.address, shareBps: 10_000 }],
      bondingCurveComplete: false,
    });
    instructions = [createIx, feeConfigIx, interimShareIx];
    try {
      assertVersionedTxFits(instructions, sponsor);
    } catch (err) {
      throw new IntentError((err as Error).message, "tx_too_large");
    }
    followUpInstructions = [
      await pump.updateFeeShares({
        authority: sponsor,
        mint,
        currentShareholders: [stagedInterimShareholder.address],
        newShareholders: shareholders,
        bondingCurveComplete: false,
      }),
    ];
    try {
      assertVersionedTxFits(followUpInstructions, sponsor);
    } catch (err) {
      throw new IntentError((err as Error).message, "tx_too_large");
    }
  } else {
    try {
      assertVersionedTxFits(instructions, sponsor);
    } catch (err) {
      throw new IntentError((err as Error).message, "tx_too_large");
    }
  }

  return {
    instructions,
    followUpInstructions,
    stagedInterimShareholder,
    mints: new Map<string, MintFacts>([[mint.toBase58(), { decimals: PUMPFUN_DECIMALS, symbol: params.symbol }]]),
    deposits: 0n,
    sendsLamports: 0n,
    tokenAddress: mint.toBase58(),
    extraSigners: [mint.toBase58()],
    mintKeypair,
    check(decoded: DecodedTx) {
      const p = decoded.pumpCreate;
      const ok = p && p.mint === mint.toBase58() && p.user === sponsor.toBase58() && p.creator === sponsor.toBase58() &&
        p.name === params.name && p.symbol === params.symbol && p.uri === params.metadataUri && !p.mayhem;
      if (!ok) throw new Error("Compiled pump.fun launch does not decode back to the request. Refusing to show it.");
      const fs = decoded.pumpFeeSharing;
      if (!fs?.created || !fs.updated) throw new Error("Fee-sharing instructions missing from decoded transaction.");
      if (stagedInterimShareholder) {
        const interim = fs.recipients.find(
          (r) => r.address === stagedInterimShareholder!.address.toBase58() && r.shareBps === 10_000,
        );
        if (!interim) throw new Error("Interim creator fee share missing from staged launch transaction.");
      } else {
        for (const row of shareholderRows) {
          const share = fs.recipients.find((r) => r.address === row.address && r.shareBps === row.shareBps);
          if (!share) throw new Error(`Creator fee share missing for ${row.address} (${row.shareBps} bps).`);
        }
      }
    },
  };
}

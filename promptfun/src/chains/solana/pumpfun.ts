import { createRequire } from "node:module";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";

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
import { assertVersionedTxFits } from "./tx-size.js";

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
 * Atomic sponsored pump.fun launch: create_v2 + fee-sharing config + locked 100% share to `feeRecipient`.
 * Fee payer and on-chain creator for create_v2 are the sponsor; mint key is held server-side.
 */
export async function buildPumpfunLaunchSponsored(
  conn: Connection,
  intent: Intent,
  sponsor: PublicKey,
  feeRecipient: PublicKey,
  mintKeypair: Keypair,
) {
  void conn;
  const params = intent.params as LaunchParams;
  if (!params.metadataUri) throw new IntentError("pump.fun needs a metadata link (an IPFS or HTTPS JSON with name, symbol, image).");

  const mint = mintKeypair.publicKey;
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
  const shareholders = [{ address: feeRecipient, shareBps: 10_000 }];
  const feeShareIx = await pump.updateFeeShares({
    authority: sponsor,
    mint,
    currentShareholders: [],
    newShareholders: shareholders,
    bondingCurveComplete: false,
  });

  const instructions = [createIx, feeConfigIx, feeShareIx];
  try {
    assertVersionedTxFits(instructions, sponsor);
  } catch (err) {
    throw new IntentError((err as Error).message, "tx_too_large");
  }

  return {
    instructions,
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
      const share = fs.recipients.find((r) => r.address === feeRecipient.toBase58() && r.shareBps === 10_000);
      if (!share) throw new Error("Creator fee share does not match the intended recipient.");
    },
  };
}

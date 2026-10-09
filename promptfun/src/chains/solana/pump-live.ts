import { createRequire } from "node:module";
import { PublicKey } from "@solana/web3.js";
import type { Config } from "../../config.js";
import type { Chain } from "../registry.js";
import type { CreatorFees, FeeRecipient, FeeSplit } from "../../api/types.js";
import { formatUnits } from "../../util/amount.js";
import { connectionFor } from "./adapter.js";
import type { CoinRecord } from "../../indexer/record.js";

const pumpMod = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const { PUMP_SDK, feeSharingConfigPda, OnlinePumpSdk } = pumpMod;

function lamportsToSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

function roleForAddress(config: Config, address: string, sponsorPubkey: string | null): FeeRecipient["role"] {
  const sponsorRecipient = config.sponsorFeeRecipient?.trim() || sponsorPubkey;
  if (sponsorRecipient && address === sponsorRecipient) return "promptfun";
  return "creator";
}

export async function readPumpfunLive(
  config: Config,
  chain: Chain,
  record: CoinRecord,
  sponsorPubkey: string | null,
): Promise<{ creatorFees: CreatorFees; feeSplit: FeeSplit }> {
  const readAt = new Date().toISOString();
  const conn = connectionFor(chain as never);
  const mint = new PublicKey(record.address);
  const sharingPda = feeSharingConfigPda(mint);
  const sharingInfo = await conn.getAccountInfo(sharingPda, "confirmed");
  if (!sharingInfo?.data) {
    return {
      creatorFees: {
        symbol: chain.nativeSymbol,
        paid: null,
        waiting: null,
        payouts: null,
        lastPaidAt: null,
        complete: false,
        source: null,
        reason: "No pump.fun fee-sharing config on chain for this mint yet.",
        readAt,
      },
      feeSplit: {
        recipients: null,
        locked: null,
        source: null,
        reason: "Fee sharing has not been configured on chain.",
        readAt,
      },
    };
  }

  const sharing = PUMP_SDK.decodeSharingConfig(sharingInfo);
  const recipients: FeeRecipient[] = sharing.shareholders.map((sh) => ({
    address: sh.address.toBase58(),
    shareBps: sh.shareBps,
    role: roleForAddress(config, sh.address.toBase58(), sponsorPubkey),
    paid: null,
  }));
  const locked = recipients.reduce((sum, r) => sum + r.shareBps, 0) === 10_000;

  let waiting: string | null = null;
  let canPay = false;
  let feeSource: string | null = "pump.fun get_minimum_distributable_fee (simulated)";
  try {
    const online = new OnlinePumpSdk(conn);
    const min = await online.getMinimumDistributableFee(mint);
    const waitingLamports = BigInt(min.distributableFees.toString());
    waiting = lamportsToSol(waitingLamports);
    canPay = min.canDistribute;
    if (!canPay && waitingLamports === 0n) {
      feeSource = "pump.fun creator vault (on chain)";
    }
  } catch (err) {
    feeSource = null;
    waiting = null;
  }

  const audit = record.feePayoutAudit;
  const paidLamports = audit ? BigInt(audit.totalLamports) : 0n;

  return {
    creatorFees: {
      symbol: chain.nativeSymbol,
      paid: paidLamports > 0n ? lamportsToSol(paidLamports) : null,
      waiting,
      payouts: audit?.payouts ?? null,
      lastPaidAt: audit?.lastPaidAt ?? null,
      complete: canPay === false && waiting === "0" ? true : !canPay,
      source: feeSource,
      reason:
        waiting === null
          ? `Could not read distributable creator fees: ${feeSource ? "" : "RPC or pump.fun SDK error."}`
          : canPay
            ? "Enough fees are waiting; payout cron may distribute on the next tick."
            : null,
      readAt,
    },
    feeSplit: {
      recipients,
      locked,
      source: "pump.fun sharing config account",
      reason: locked ? null : "Shareholders do not sum to 100% on chain.",
      readAt,
    },
  };
}

import type { ActionKind, Family } from "../chains/registry.js";

export interface LaunchParams {
  name: string;
  symbol: string;
  /** Whole tokens, decimal string. */
  supply: string;
  decimals: number;
  description: string;
  metadataUri: string;
  /** Optional https:// link shown on pump.fun metadata JSON. */
  website?: string;
  /** Optional X profile or post URL (stored as `twitter` in metadata JSON). */
  x?: string;
  /** Revoke the mint authority after minting, so supply can never grow. */
  fixedSupply: boolean;
  venue: "spl" | "pumpfun" | "erc20";
}

export interface TransferParams {
  /** "native" or a token address / mint. */
  asset: string;
  amount: string;
  to: string;
}

export type IntentStatus =
  | "awaiting_wallet"
  | "awaiting_confirm"
  | "built"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export type ExecutionMode = "wallet" | "sponsor";

export interface Step {
  /** One plain-language line decoded from the transaction bytes. */
  text: string;
  program: string;
}

export interface Simulation {
  ok: boolean;
  /** Short reason when not ok. */
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
  at: string;
}

/** Network costs only, paid to the chain. promptfun charges nothing. */
export interface Cost {
  /** Always "Network fee (paid to <chain>, not promptfun)". */
  label: string;
  /** Native-unit amounts as decimal strings. */
  networkFee: string;
  /** How the fee was computed from live chain data. */
  feeBasis: string;
  deposits: string;
  /** Amount sent to someone else (native transfers). */
  sends: string;
  total: string;
  symbol: string;
  balance: string | null;
  enough: boolean | null;
  note: string | null;
  /** Approximate USD of `total`, mainnet only, from a real price feed; null otherwise. */
  usd: string | null;
  usdSource: string | null;
  promptfunFee: "0";
}

export interface Built {
  signer: string;
  /** Family-specific payload the wallet signs (Solana: base64 wire tx; EVM: JSON call). */
  payload: string;
  /** Solana: base64 message bytes the signature must cover. EVM: canonical call JSON. */
  digest: string;
  steps: Step[];
  simulation: Simulation;
  cost: Cost;
  builtAt: string;
  /** Solana: last valid block height for the blockhash. */
  validUntil: number | null;
  /** Address of the token that will exist after a launch. */
  tokenAddress: string | null;
  /** Additional signers the approval page holds in the browser (pump.fun one-time mint key). */
  extraSigners: string[];
}

export interface Receipt {
  id: string;
  status: "success" | "failed";
  slotOrBlock: number;
  fee: string;
  feeSymbol: string;
  explorerUrl: string | null;
  verified: string[];
  tokenAddress: string | null;
  tokenExplorerUrl: string | null;
  confirmedAt: string;
}

export interface IntentEvent {
  at: string;
  type: string;
  detail: string;
}

export interface Intent {
  id: string;
  kind: ActionKind;
  chain: string;
  family: Family;
  params: LaunchParams | TransferParams;
  summary: string;
  status: IntentStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  built: Built | null;
  submission: { id: string; submittedAt: string } | null;
  receipt: Receipt | null;
  error: string | null;
  events: IntentEvent[];
  idempotencyKey: string;
  executionMode: ExecutionMode;
  instructionFingerprint: string | null;
}

export class IntentError extends Error {
  constructor(message: string, readonly code = "invalid") {
    super(message);
  }
}

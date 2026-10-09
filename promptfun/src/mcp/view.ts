import { findChain } from "../chains/registry.js";
import type { Config } from "../config.js";
import type { Intent } from "../intents/types.js";

export interface IntentView {
  intentId: string;
  kind: Intent["kind"];
  status: Intent["status"];
  summary: string;
  chain: string;
  chainName: string;
  chainStatus: string;
  params: Intent["params"];
  approveUrl: string;
  expiresAt: string;
  preview: {
    signer: string;
    steps: string[];
    simulationOk: boolean;
    simulationError: string | null;
    feeLabel: string;
    networkFee: string;
    feeBasis: string;
    deposits: string;
    total: string;
    symbol: string;
    usd: string | null;
    usdSource: string | null;
    promptfunFee: "0";
    balance: string | null;
    enough: boolean | null;
    tokenAddress: string | null;
  } | null;
  transaction: { id: string; submittedAt: string; explorerUrl: string | null } | null;
  receipt: Intent["receipt"];
  error: string | null;
  nextStep: string;
}

function nextStep(intent: Intent, approveUrl: string): string {
  switch (intent.status) {
    case "awaiting_wallet":
    case "built":
      return `Nothing has been sent. The user must open ${approveUrl}, connect their wallet, review the decoded transaction, and approve it in the wallet.`;
    case "submitted":
      return "Signed by the user's wallet and sent. Waiting for the network to confirm; call get_action_status again shortly.";
    case "confirmed":
      return "Confirmed on chain. The receipt below was read from the chain, not assumed.";
    case "failed":
      return "It did not succeed. See the error and receipt. Prepare a new request to try again.";
    case "expired":
      return "Expired before approval. Nothing was sent. Prepare a new request if the user still wants this.";
  }
}

export function intentView(config: Config, intent: Intent, approveUrl: string): IntentView {
  const chain = findChain(config, intent.chain);
  const built = intent.built;
  const explorer = intent.receipt?.explorerUrl ?? null;
  return {
    intentId: intent.id,
    kind: intent.kind,
    status: intent.status,
    summary: intent.summary,
    chain: intent.chain,
    chainName: chain?.name ?? intent.chain,
    chainStatus: chain?.status ?? "unknown",
    params: intent.params,
    approveUrl,
    expiresAt: intent.expiresAt,
    preview: built
      ? {
          signer: built.signer,
          steps: built.steps.map((s) => s.text),
          simulationOk: built.simulation.ok,
          simulationError: built.simulation.error,
          feeLabel: built.cost.label,
          networkFee: built.cost.networkFee,
          feeBasis: built.cost.feeBasis,
          deposits: built.cost.deposits,
          total: built.cost.total,
          symbol: built.cost.symbol,
          usd: built.cost.usd,
          usdSource: built.cost.usdSource,
          promptfunFee: "0",
          balance: built.cost.balance,
          enough: built.cost.enough,
          tokenAddress: built.tokenAddress,
        }
      : null,
    transaction: intent.submission ? { ...intent.submission, explorerUrl: explorer ?? (chain ? explorerFor(chain, intent.submission.id) : null) } : null,
    receipt: intent.receipt,
    error: intent.error,
    nextStep: nextStep(intent, approveUrl),
  };
}

function explorerFor(chain: NonNullable<ReturnType<typeof findChain>>, id: string): string | null {
  if (chain.family !== "solana") return chain.explorerUrl ? `${chain.explorerUrl}/tx/${id}` : null;
  const base = `https://explorer.solana.com/tx/${id}`;
  if (chain.cluster === "mainnet-beta") return base;
  if (chain.cluster === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(chain.rpcUrl)}`;
}

export function intentText(view: IntentView): string {
  const lines = [`${view.summary}`, `Status: ${view.status}. Chain: ${view.chainName} (${view.chainStatus}).`];
  if (view.chainStatus !== "verified") {
    lines.push(view.chainStatus === "gated"
      ? "Warning: real-money network behind an explicit flag; promptfun has not verified this path end to end."
      : "Note: this chain is configured but promptfun has not verified it end to end yet.");
  }
  if (view.preview) {
    lines.push("Decoded transaction:", ...view.preview.steps.map((s) => `- ${s}`));
    const p = view.preview;
    lines.push(`Simulation: ${p.simulationOk ? "passed" : `FAILED (${p.simulationError})`}.`);
    lines.push(`${p.feeLabel}: ${p.networkFee} ${p.symbol}${p.deposits !== "0" ? ` + ${p.deposits} ${p.symbol} rent deposits` : ""}${p.usd ? ` (≈ $${p.usd}; ${p.usdSource})` : ""}. promptfun fee: none.`);
  }
  if (view.transaction) lines.push(`Transaction: ${view.transaction.id}${view.transaction.explorerUrl ? ` (${view.transaction.explorerUrl})` : ""}`);
  if (view.receipt) {
    lines.push(`Receipt (read from chain, slot/block ${view.receipt.slotOrBlock}, fee ${view.receipt.fee} ${view.receipt.feeSymbol}):`, ...view.receipt.verified.map((v) => `- ${v}`));
    if (view.receipt.tokenAddress) lines.push(`Token: ${view.receipt.tokenAddress}${view.receipt.tokenExplorerUrl ? ` (${view.receipt.tokenExplorerUrl})` : ""}`);
  }
  if (view.error) lines.push(`Error: ${view.error}`);
  if (view.status === "awaiting_wallet" || view.status === "built") lines.push(`Approval link (send this to the user): ${view.approveUrl}`);
  lines.push(view.nextStep);
  return lines.join("\n");
}

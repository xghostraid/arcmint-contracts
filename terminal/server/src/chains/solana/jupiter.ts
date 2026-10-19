import { VersionedTransaction, type PublicKey } from "@solana/web3.js";
import type { FetchLike } from "./jito.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
  [k: string]: unknown;
}

type GetLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** Jupiter Swap API v1 (mainnet only). Routes graduated pump.fun coins through PumpSwap, Raydium, Meteora and others. */
export class JupiterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getImpl: GetLike = fetch as unknown as GetLike,
    private readonly postImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<JupiterQuote> {
    const q = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: "true" });
    const res = await this.getImpl(`${this.baseUrl}/quote?${q}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Jupiter quote failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as JupiterQuote;
  }

  async swapTransaction(quote: JupiterQuote, user: PublicKey, priorityLamports: number): Promise<VersionedTransaction> {
    const res = await this.postImpl(`${this.baseUrl}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: user.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: priorityLamports > 0 ? { priorityLevelWithMaxLamports: { maxLamports: priorityLamports, priorityLevel: "high" } } : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { swapTransaction?: string; error?: string };
    if (!res.ok || !body.swapTransaction) throw new Error(`Jupiter swap build failed (${res.status}): ${body.error ?? "no transaction"}`);
    return VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
  }
}

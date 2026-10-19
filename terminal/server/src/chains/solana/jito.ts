import { PublicKey, SystemProgram, type Keypair } from "@solana/web3.js";
import type { IxGroup } from "./pack.js";

/** Jito's published mainnet tip accounts; one is picked at random per bundle to spread write locks. */
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const MAX_BUNDLE_TXS = 5;
export const MIN_JITO_TIP_LAMPORTS = 1_000;

export function tipGroup(payer: Keypair, lamports: number, random: () => number = Math.random): IxGroup {
  const account = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(random() * JITO_TIP_ACCOUNTS.length)]!);
  return {
    label: "jito tip",
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: account, lamports })],
    signers: [payer],
    computeUnits: 500,
  };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class JitoClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  private async rpc<T>(path: string, method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
    if (!res.ok || body.error) throw new Error(`Jito ${method} failed (${res.status}): ${body.error?.message ?? "no result"}`);
    return body.result as T;
  }

  /** Bundles execute atomically and in order within one slot, or not at all. */
  sendBundle(base64Txs: string[]): Promise<string> {
    if (base64Txs.length === 0 || base64Txs.length > MAX_BUNDLE_TXS) throw new Error(`A Jito bundle holds 1–${MAX_BUNDLE_TXS} transactions`);
    return this.rpc<string>("/api/v1/bundles", "sendBundle", [base64Txs, { encoding: "base64" }]);
  }

  async inflightStatus(bundleId: string): Promise<string | null> {
    const r = await this.rpc<{ value: { bundle_id: string; status: string }[] }>("/api/v1/getInflightBundleStatuses", "getInflightBundleStatuses", [[bundleId]]);
    return r.value[0]?.status ?? null;
  }
}

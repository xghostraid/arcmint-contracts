import { z } from "zod";

const walletIds = z.array(z.number().int().positive()).min(1).max(100);
const exec = {
  slippageBps: z.number().int().min(0).max(5_000).default(500),
  priorityMicroLamports: z.number().int().min(0).max(50_000_000).optional(),
  mode: z.enum(["parallel", "sequential", "bundle"]).default("parallel"),
};
const solNum = z.number().positive().max(1_000);

export const dcaConfig = z
  .object({
    side: z.enum(["buy", "sell"]),
    walletIds,
    /** Buys: SOL from each wallet per run. */
    solPerWallet: solNum.optional(),
    /** Sells: percent of each wallet's current balance per run. */
    percentPerRun: z.number().gt(0).max(100).optional(),
    intervalSec: z.number().int().min(10).max(7 * 86_400),
    runs: z.number().int().min(1).max(10_000),
    ...exec,
  })
  .refine((c) => (c.side === "buy" ? c.solPerWallet !== undefined : c.percentPerRun !== undefined), { message: "Buys need solPerWallet; sells need percentPerRun" });

export const limitConfig = z
  .object({
    side: z.enum(["buy", "sell"]),
    walletIds,
    trigger: z.object({
      /** marketCapSol: market cap in SOL; priceSol: SOL per whole token. */
      metric: z.enum(["marketCapSol", "priceSol"]),
      op: z.enum(["gte", "lte"]),
      value: z.number().positive(),
    }),
    solPerWallet: solNum.optional(),
    percent: z.number().gt(0).max(100).optional(),
    checkSec: z.number().int().min(2).max(3_600).default(5),
    /** Unix ms; the order is dropped after this. */
    expiresAt: z.number().int().positive().optional(),
    ...exec,
  })
  .refine((c) => (c.side === "buy" ? c.solPerWallet !== undefined : c.percent !== undefined), { message: "Buys need solPerWallet; sells need percent" });

export const counterConfig = z.object({
  walletIds,
  /** Which outside trades to answer: outside buys are answered with sells, outside sells with buys. */
  reactTo: z.enum(["buys", "sells", "both"]),
  minTradeSol: z.number().positive(),
  /** Share of the outside trade's SOL value to trade back. */
  sharePct: z.number().gt(0).max(100),
  maxPerReactionSol: solNum,
  cooldownSec: z.number().int().min(1).max(86_400).default(15),
  /** Whole tokens each wallet always keeps. */
  minTokensPerWallet: z.number().min(0).default(0),
  ...exec,
});

export const snipeConfig = z.object({
  walletIds,
  /** Stop once the user's wallets together hold this share of supply. */
  targetSupplyPct: z.number().gt(0).max(90),
  /** Stop once the market cap (SOL) reaches this. */
  maxMarketCapSol: z.number().positive(),
  solPerBuy: solNum,
  intervalSec: z.number().int().min(2).max(3_600).default(5),
  ...exec,
});

export type DcaConfig = z.infer<typeof dcaConfig>;
export type LimitConfig = z.infer<typeof limitConfig>;
export type CounterConfig = z.infer<typeof counterConfig>;
export type SnipeConfig = z.infer<typeof snipeConfig>;

export const strategyInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dca"), config: dcaConfig }),
  z.object({ kind: z.literal("limit"), config: limitConfig }),
  z.object({ kind: z.literal("counter"), config: counterConfig }),
  z.object({ kind: z.literal("snipe"), config: snipeConfig }),
]);

export type StrategyKind = "dca" | "limit" | "counter" | "snipe";
export type StrategyStatus = "running" | "paused" | "stopped" | "completed" | "failed";
export type StrategyConfig = DcaConfig | LimitConfig | CounterConfig | SnipeConfig;

export interface Strategy {
  id: number;
  kind: StrategyKind;
  name: string;
  mint: string;
  config: StrategyConfig;
  status: StrategyStatus;
  budgetLamports: string;
  spentLamports: string;
  receivedLamports: string;
  runs: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  state: { failures?: number; cursor?: number; round?: number; [k: string]: unknown };
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyIntent {
  id: number;
  strategyId: number;
  key: string;
  side: "buy" | "sell";
  status: "pending" | "ok" | "failed" | "unknown";
  detail: unknown;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Strategies that spend SOL and so need a budget. */
export function spendsSol(kind: StrategyKind, config: StrategyConfig): boolean {
  if (kind === "dca" || kind === "limit") return (config as DcaConfig | LimitConfig).side === "buy";
  if (kind === "counter") return (config as CounterConfig).reactTo !== "buys";
  return true;
}

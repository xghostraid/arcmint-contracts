import path from "node:path";

export type NetworkKey = "local" | "devnet" | "mainnet";

export interface Config {
  network: NetworkKey;
  rpcUrl: string;
  wsUrl: string | undefined;
  allowMainnet: boolean;
  jitoUrl: string;
  jupiterUrl: string;
  pumpIpfsUrl: string;
  maxSolPerAction: number;
  dataDir: string;
  host: string;
  port: number;
  autoLockMinutes: number;
  webDir: string | undefined;
  defaultPriorityMicroLamports: number;
  defaultJitoTipLamports: number;
  /** Strategy engine: global cap on bot orders per rolling minute. */
  botMaxActionsPerMinute: number;
  /** Alert when a bot wallet's SOL drops below this. */
  lowBalanceSol: number;
  ingestPollSeconds: number;
  ingestBackfill: number;
  ingestWebsocket: boolean;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
}

const DEFAULT_RPC: Record<NetworkKey, string> = {
  local: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${value}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (env.TERMINAL_NETWORK ?? "devnet").trim() as NetworkKey;
  if (!["local", "devnet", "mainnet"].includes(network)) {
    throw new Error(`TERMINAL_NETWORK must be local, devnet or mainnet (got "${network}")`);
  }
  const allowMainnet = env.TERMINAL_ALLOW_MAINNET === "1";
  if (network === "mainnet" && !allowMainnet) {
    throw new Error("TERMINAL_NETWORK=mainnet moves real funds. Set TERMINAL_ALLOW_MAINNET=1 to confirm.");
  }
  const dataDir = path.resolve(env.TERMINAL_DATA_DIR ?? "./data");
  return {
    network,
    rpcUrl: env.TERMINAL_RPC_URL?.trim() || DEFAULT_RPC[network],
    wsUrl: env.TERMINAL_WS_URL?.trim() || undefined,
    allowMainnet,
    jitoUrl: env.TERMINAL_JITO_URL?.trim() || "https://mainnet.block-engine.jito.wtf",
    jupiterUrl: env.TERMINAL_JUPITER_URL?.trim() || "https://lite-api.jup.ag/swap/v1",
    pumpIpfsUrl: env.TERMINAL_PUMP_IPFS_URL?.trim() || "https://pump.fun/api/ipfs",
    maxSolPerAction: num(env.TERMINAL_MAX_SOL_PER_ACTION, 5),
    dataDir,
    host: env.TERMINAL_HOST?.trim() || "127.0.0.1",
    port: num(env.TERMINAL_PORT, 8787),
    autoLockMinutes: num(env.TERMINAL_AUTO_LOCK_MINUTES, 30),
    webDir: env.TERMINAL_WEB_DIR?.trim() || undefined,
    defaultPriorityMicroLamports: num(env.TERMINAL_PRIORITY_MICROLAMPORTS, 100_000),
    defaultJitoTipLamports: num(env.TERMINAL_JITO_TIP_LAMPORTS, 1_000_000),
    botMaxActionsPerMinute: num(env.TERMINAL_BOT_MAX_ACTIONS_PER_MINUTE, 30),
    lowBalanceSol: num(env.TERMINAL_LOW_BALANCE_SOL, 0.05),
    ingestPollSeconds: num(env.TERMINAL_INGEST_POLL_SECONDS, 10),
    ingestBackfill: num(env.TERMINAL_INGEST_BACKFILL, 1000),
    ingestWebsocket: env.TERMINAL_INGEST_WEBSOCKET !== "0",
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    telegramChatId: env.TELEGRAM_CHAT_ID?.trim() || undefined,
  };
}

import path from "node:path";

export interface Config {
  host: string;
  port: number;
  publicUrl: string;
  dbPath: string;
  enableLocalnet: boolean;
  enablePumpfunMainnet: boolean;
  enableEvmMainnets: boolean;
  intentTtlMs: number;
  maxIntentsPerHour: number;
  env: NodeJS.ProcessEnv;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT || 8787);
  const host = env.HOST || "127.0.0.1";
  const publicUrl = (env.PROMPTFUN_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  return {
    host,
    port,
    publicUrl,
    dbPath: env.PROMPTFUN_DB || path.resolve(process.cwd(), "data/promptfun.sqlite"),
    enableLocalnet: flag(env.PROMPTFUN_ENABLE_LOCALNET),
    enablePumpfunMainnet: flag(env.PROMPTFUN_ENABLE_PUMPFUN_MAINNET),
    enableEvmMainnets: flag(env.PROMPTFUN_ENABLE_EVM_MAINNETS),
    intentTtlMs: Number(env.PROMPTFUN_INTENT_TTL_MS || 15 * 60 * 1000),
    maxIntentsPerHour: Number(env.PROMPTFUN_MAX_INTENTS_PER_HOUR || 120),
    env,
  };
}

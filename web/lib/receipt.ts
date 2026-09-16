import { decodeEventLog, type Address, type Hash, type Log } from "viem";
import { factoryAbi } from "./abi";

/** Live v7 / v4 Launched(token, pool, creator, name, symbol) */
export const LAUNCHED_TOPIC =
  "0xc5a807b0033def274292e9d3ba676e6fcfb69d9d383ccf9b69112237bd95def9" as const;

export type LaunchedAddresses = {
  token: Address;
  pool: Address;
  creator: Address;
};

function topicAddress(topic: string | undefined): Address | null {
  if (!topic || topic.length < 66) return null;
  return `0x${topic.slice(-40)}` as Address;
}

export function launchedFromLogs(logs: readonly Log[]): LaunchedAddresses | null {
  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 === LAUNCHED_TOPIC) {
      const token = topicAddress(log.topics[1]);
      const pool = topicAddress(log.topics[2]);
      const creator = topicAddress(log.topics[3]);
      if (token && pool && creator) return { token, pool, creator };
    }
    try {
      const decoded = decodeEventLog({
        abi: factoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "Launched" && decoded.args.token && decoded.args.pool) {
        return {
          token: decoded.args.token,
          pool: decoded.args.pool,
          creator: decoded.args.creator,
        };
      }
    } catch {
      /* other logs */
    }
  }
  return null;
}

export function asTxHash(value: string): Hash | null {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as Hash) : null;
}

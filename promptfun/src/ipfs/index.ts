import type { Config } from "../config.js";
import { KuboIpfsPinner } from "./kubo.js";
import { MemoryIpfsPinner } from "./memory.js";
import { PinataIpfsPinner } from "./pinata.js";
import type { IpfsPinner } from "./pinner.js";

export type { IpfsPinResult, IpfsPinner } from "./pinner.js";
export { ipfsUri } from "./pinner.js";
export { KuboIpfsPinner } from "./kubo.js";
export { MemoryIpfsPinner } from "./memory.js";
export { PinataIpfsPinner } from "./pinata.js";

export function createIpfsPinner(config: Config): IpfsPinner {
  const kubo = config.env.PROMPTFUN_KUBO_API_URL?.trim();
  if (kubo) return new KuboIpfsPinner(kubo);
  const pinata = config.env.PROMPTFUN_PINATA_JWT?.trim();
  if (pinata) return new PinataIpfsPinner(pinata);
  return new MemoryIpfsPinner();
}

export function usesPublicIpfsPinner(config: Config): boolean {
  return Boolean(config.env.PROMPTFUN_KUBO_API_URL?.trim() || config.env.PROMPTFUN_PINATA_JWT?.trim());
}

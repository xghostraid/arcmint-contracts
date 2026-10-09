/** Pluggable IPFS pin: memory (tests) or Kubo HTTP API. */
export interface IpfsPinResult {
  cid: string;
  size: number;
}

export interface IpfsPinner {
  pin(name: string, data: Uint8Array): Promise<IpfsPinResult>;
}

export function ipfsUri(cid: string): string {
  return `ipfs://${cid}`;
}

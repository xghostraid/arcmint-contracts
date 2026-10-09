import type { IpfsPinResult, IpfsPinner } from "./pinner.js";

type HashFn = (content: Uint8Array) => Promise<string>;

async function loadHash(): Promise<HashFn> {
  const mod = await import("ipfs-only-hash");
  const of = (mod as { of?: HashFn; default?: { of?: HashFn } }).of ?? mod.default?.of;
  if (typeof of !== "function") throw new Error("ipfs-only-hash export missing");
  return of;
}

/** Deterministic CID for tests without a Kubo node. Bytes are served via /api/img?cid=. */
export class MemoryIpfsPinner implements IpfsPinner {
  readonly blobs = new Map<string, Buffer>();

  private hashFn: HashFn | null = null;

  private async hash(data: Uint8Array): Promise<string> {
    if (!this.hashFn) this.hashFn = await loadHash();
    return this.hashFn(data);
  }

  async pin(_name: string, data: Uint8Array): Promise<IpfsPinResult> {
    const cid = await this.hash(data);
    this.blobs.set(cid, Buffer.from(data));
    return { cid, size: data.byteLength };
  }
}

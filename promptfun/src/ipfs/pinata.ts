import type { IpfsPinResult, IpfsPinner } from "./pinner.js";

/** Pinata pinFileToIPFS — set PROMPTFUN_PINATA_JWT (JWT from pinata.cloud API keys). */
export class PinataIpfsPinner implements IpfsPinner {
  constructor(private readonly jwt: string) {}

  async pin(name: string, data: Uint8Array): Promise<IpfsPinResult> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(data)]), name);
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Pinata pin failed (${res.status}): ${await res.text()}`);
    const parsed = (await res.json()) as { IpfsHash?: string; PinSize?: number };
    if (!parsed.IpfsHash) throw new Error("Pinata response missing IpfsHash");
    return { cid: parsed.IpfsHash, size: parsed.PinSize ?? data.byteLength };
  }
}

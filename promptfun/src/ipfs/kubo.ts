import type { IpfsPinResult, IpfsPinner } from "./pinner.js";

/** Kubo (go-ipfs) HTTP API — set PROMPTFUN_KUBO_API_URL e.g. http://127.0.0.1:5001 */
export class KuboIpfsPinner implements IpfsPinner {
  constructor(private readonly apiUrl: string) {}

  async pin(name: string, data: Uint8Array): Promise<IpfsPinResult> {
    const base = this.apiUrl.replace(/\/+$/, "");
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(data)]), name);
    const res = await fetch(`${base}/api/v0/add?pin=true&cid-version=1`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Kubo add failed (${res.status}): ${await res.text()}`);
    const line = (await res.text()).trim().split("\n").pop();
    if (!line) throw new Error("Kubo add returned empty body");
    const parsed = JSON.parse(line) as { Hash?: string; Size?: string };
    if (!parsed.Hash) throw new Error("Kubo add response missing Hash");
    return { cid: parsed.Hash, size: Number(parsed.Size ?? data.byteLength) };
  }
}

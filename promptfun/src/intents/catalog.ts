import { list, put } from "@vercel/blob";
import type { Intent } from "./types.js";

/** Cross-instance intent lookup when BLOB_READ_WRITE_TOKEN is set (Vercel Blob). */
export interface IntentRemoteStore {
  enabled(): boolean;
  mirror(intent: Intent): Promise<void>;
  load(id: string): Promise<Intent | null>;
}

export class IntentCatalog implements IntentRemoteStore {
  constructor(private readonly token: string | null) {}

  enabled(): boolean {
    return Boolean(this.token?.trim());
  }

  async mirror(intent: Intent): Promise<void> {
    const token = this.token?.trim();
    if (!token) return;
    await put(`intents/${intent.id}.json`, JSON.stringify(intent), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
  }

  async load(id: string): Promise<Intent | null> {
    const token = this.token?.trim();
    if (!token) return null;
    const pathname = `intents/${id}.json`;
    const found = await list({ prefix: pathname, token });
    const blob = found.blobs.find((b) => b.pathname === pathname);
    if (!blob) return null;
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    try {
      return (await res.json()) as Intent;
    } catch {
      return null;
    }
  }
}

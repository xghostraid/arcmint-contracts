import { list, put } from "@vercel/blob";
import type { Intent } from "./types.js";

/** Cross-instance intent lookup when BLOB_READ_WRITE_TOKEN is set (Vercel Blob). */
export interface IntentRemoteStore {
  enabled(): boolean;
  mirror(intent: Intent): Promise<void>;
  load(id: string): Promise<Intent | null>;
  /** Best-effort scan of mirrored intents (Vercel Blob) for explore rehydration after ephemeral SQLite. */
  listMirrored?(max?: number): Promise<Intent[]>;
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

  async listMirrored(max = 400): Promise<Intent[]> {
    const token = this.token?.trim();
    if (!token) return [];
    const out: Intent[] = [];
    let cursor: string | undefined;
    while (out.length < max) {
      const page = await list({ prefix: "intents/", limit: 100, cursor, token });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith(".json")) continue;
        try {
          const res = await fetch(blob.url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          out.push((await res.json()) as Intent);
        } catch {
          // skip unreadable blob
        }
        if (out.length >= max) break;
      }
      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
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

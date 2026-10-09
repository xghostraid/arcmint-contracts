import { createHash, randomBytes } from "node:crypto";
import { list, put } from "@vercel/blob";
import type { SavedPicture } from "./service.js";

export type LastPictureHandoff = SavedPicture & { savedAt: string; handoffSessionId?: string };

export function newHandoffSessionId(): string {
  return `hs_${randomBytes(12).toString("hex")}`;
}

function blobPath(scopeKey: string): string {
  const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
  return `picture-handoffs/${digest}.json`;
}

function scopeKey(scope: string, handoffSessionId?: string): string {
  const session = (handoffSessionId ?? "").trim();
  return session ? `${scope}::${session}` : scope;
}

/** Cross-instance last-picture handoff (panel Save → get_last_picture on serverless). */
export class PictureHandoffStore {
  private readonly memory = new Map<string, LastPictureHandoff>();

  constructor(private readonly token: string | null) {}

  enabled(): boolean {
    return Boolean(this.token?.trim());
  }

  remember(scope: string, record: LastPictureHandoff, handoffSessionId?: string): void {
    const session = (handoffSessionId ?? "").trim();
    if (session) {
      this.memory.set(scopeKey(scope, session), record);
      this.memory.set(scope, record);
    } else {
      this.memory.set(scope, record);
    }
  }

  recall(scope: string, handoffSessionId?: string): LastPictureHandoff | null {
    const session = (handoffSessionId ?? "").trim();
    if (session) {
      const hit = this.memory.get(scopeKey(scope, session));
      if (hit) return hit;
    }
    return this.memory.get(scope) ?? null;
  }

  async persist(scope: string, record: LastPictureHandoff, handoffSessionId?: string): Promise<void> {
    this.remember(scope, record, handoffSessionId);
    const token = this.token?.trim();
    if (!token) return;
    const payload = JSON.stringify({ ...record, scope, handoffSessionId: handoffSessionId ?? null });
    await put(blobPath(scopeKey(scope, handoffSessionId)), payload, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
    if (handoffSessionId) {
      await put(blobPath(scope), payload, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        token,
      });
    }
  }

  async load(scope: string, handoffSessionId?: string): Promise<LastPictureHandoff | null> {
    const mem = this.recall(scope, handoffSessionId);
    if (mem) return mem;
    const token = this.token?.trim();
    if (!token) return null;
    const session = (handoffSessionId ?? "").trim();
    const keys = session ? [scopeKey(scope, session), scope] : [scope];
    for (const key of keys) {
      const pathname = blobPath(key);
      const found = await list({ prefix: pathname, token });
      const blob = found.blobs.find((b) => b.pathname === pathname);
      if (!blob) continue;
      const res = await fetch(blob.url);
      if (!res.ok) continue;
      try {
        const parsed = (await res.json()) as LastPictureHandoff & { scope?: string };
        const { scope: _s, ...rest } = parsed;
        this.remember(scope, rest, handoffSessionId);
        return rest;
      } catch {
        continue;
      }
    }
    return null;
  }
}

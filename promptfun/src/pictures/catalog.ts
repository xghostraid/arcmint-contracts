import { list, put } from "@vercel/blob";
import type { PictureRow } from "./store.js";

export interface PictureManifest {
  id: string;
  mime: string;
  imageCid: string | null;
  expiresAt: number;
  imageUrl: string;
}

/** Cross-instance picture lookup when PROMPTFUN_BLOB_READ_WRITE_TOKEN is set (Vercel Blob). */
export class PictureCatalog {
  constructor(private readonly token: string | null) {}

  enabled(): boolean {
    return Boolean(this.token?.trim());
  }

  async mirror(row: PictureRow, data: Buffer): Promise<void> {
    const token = this.token?.trim();
    if (!token) return;
    const image = await put(`pictures/${row.id}`, data, {
      access: "public",
      contentType: row.mime,
      addRandomSuffix: false,
      token,
    });
    const manifest: PictureManifest = {
      id: row.id,
      mime: row.mime,
      imageCid: row.imageCid,
      expiresAt: row.expiresAt,
      imageUrl: image.url,
    };
    await put(`pictures/${row.id}.json`, JSON.stringify(manifest), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
  }

  async updateManifestCid(id: string, imageCid: string): Promise<void> {
    const token = this.token?.trim();
    if (!token) return;
    const existing = await this.loadManifest(id);
    if (!existing) return;
    existing.imageCid = imageCid;
    await put(`pictures/${id}.json`, JSON.stringify(existing), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
  }

  async loadManifest(id: string): Promise<PictureManifest | null> {
    const token = this.token?.trim();
    if (!token) return null;
    const prefix = `pictures/${id}.json`;
    const found = await list({ prefix, token });
    const blob = found.blobs.find((b) => b.pathname === prefix);
    if (!blob) return null;
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    try {
      const parsed = (await res.json()) as PictureManifest;
      if (parsed.expiresAt <= Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async publishMetadata(pictureId: string, jsonBytes: Buffer): Promise<string> {
    const token = this.token?.trim();
    if (!token) throw new Error("Blob store not configured");
    const path = `metadata/${pictureId}.json`;
    const blob = await put(path, jsonBytes, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
    if (blob.url.length > 200) throw new Error("The metadata link must be under 200 characters.");
    return blob.url;
  }

  async loadBytes(id: string): Promise<{ mime: string; data: Buffer } | null> {
    const token = this.token?.trim();
    if (!token) return null;
    const prefix = `pictures/${id}`;
    const found = await list({ prefix, token });
    const blob = found.blobs.find((b) => b.pathname === prefix);
    if (!blob) return null;
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    return { mime, data };
  }
}

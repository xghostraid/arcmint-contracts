import type { Config } from "../config.js";

const HOSTED_META = /\/m\/(pic_[a-f0-9]{24})(?:\?|$|\/)/i;

/** pictureId from promptfun hosted metadata URI (`…/m/pic_…`). */
export function pictureIdFromMetadataUri(metadataUri: string): string | null {
  const trimmed = metadataUri.trim();
  if (!trimmed) return null;
  try {
    const path = trimmed.startsWith("http") ? new URL(trimmed).pathname : trimmed;
    const m = HOSTED_META.exec(path);
    return m?.[1] ?? null;
  } catch {
    const m = HOSTED_META.exec(trimmed);
    return m?.[1] ?? null;
  }
}

export function pictureApiUrl(publicUrl: string, pictureId: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/api/pictures/${pictureId}`;
}

/** Fast path: hosted `/m/pic_*` → `/api/pictures/pic_*` (no network). */
export function syncImageUrlFromMetadataUri(config: Config, metadataUri: string | null | undefined): string | null {
  if (!metadataUri?.trim()) return null;
  const pictureId = pictureIdFromMetadataUri(metadataUri);
  if (pictureId) return pictureApiUrl(config.publicUrl, pictureId);
  return null;
}

function metadataFetchUrl(config: Config, metadataUri: string): string | null {
  const trimmed = metadataUri.trim();
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!cid) return null;
    return `${config.ipfsGateway.replace(/\/+$/, "")}/${cid}`;
  }
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function imageFromMetadataJson(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const image = (body as { image?: unknown }).image;
  if (typeof image !== "string" || !image.trim()) return null;
  const url = image.trim();
  if (/^https:\/\//i.test(url) || url.startsWith("ipfs://")) return url;
  return null;
}

/** Fetch pump/SPL JSON metadata and read the `image` field when not hosted on promptfun. */
export async function resolveImageUrlFromMetadata(
  config: Config,
  metadataUri: string | null | undefined,
): Promise<string | null> {
  const sync = syncImageUrlFromMetadataUri(config, metadataUri);
  if (sync) return sync;
  if (!metadataUri?.trim()) return null;
  const fetchUrl = metadataFetchUrl(config, metadataUri);
  if (!fetchUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 256 * 1024) return null;
    const parsed = JSON.parse(buf.toString("utf8")) as unknown;
    const raw = imageFromMetadataJson(parsed);
    if (!raw) return null;
    if (raw.startsWith("ipfs://")) {
      const cid = raw.slice("ipfs://".length).replace(/^ipfs\//, "");
      return cid ? `${config.ipfsGateway.replace(/\/+$/, "")}/${cid}` : null;
    }
    return raw;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichRecordImageUrl(config: Config, record: { metadataUri: string | null; imageUrl: string | null }): Promise<string | null> {
  if (record.imageUrl) return record.imageUrl;
  const sync = syncImageUrlFromMetadataUri(config, record.metadataUri);
  if (sync) return sync;
  return resolveImageUrlFromMetadata(config, record.metadataUri);
}

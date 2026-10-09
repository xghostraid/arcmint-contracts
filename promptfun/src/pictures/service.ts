import type { Config } from "../config.js";
import { buildTokenMetadataBytes, metadataUriFromCid } from "../metadata/build.js";
import type { TokenMetadataFields } from "../metadata/build.js";
import { createIpfsPinner, type IpfsPinner, MemoryIpfsPinner, usesPublicIpfsPinner } from "../ipfs/index.js";
import { IntentError } from "../intents/types.js";
import { PictureCatalog } from "./catalog.js";
import { PictureStore, type PictureRow } from "./store.js";
import { sanitizeImage } from "./sanitize.js";

const DATA_URL = /^data:image\/(jpeg|png);base64,/i;

export type SavedPicture = { pictureId: string; mime: string; bytes: number; imageCid?: string | null };

export class PictureService {
  readonly pinner: IpfsPinner;
  readonly catalog: PictureCatalog;

  constructor(readonly config: Config, readonly store: PictureStore) {
    this.pinner = createIpfsPinner(config);
    this.catalog = new PictureCatalog(config.env.BLOB_READ_WRITE_TOKEN ?? config.env.PROMPTFUN_BLOB_READ_WRITE_TOKEN ?? null);
  }

  memoryBlobs(): Map<string, Buffer> | null {
    return this.pinner instanceof MemoryIpfsPinner ? this.pinner.blobs : null;
  }

  async saveFromBase64(dataUrlOrB64: string): Promise<SavedPicture> {
    const raw = parseImagePayload(dataUrlOrB64);
    const { mime, data } = await sanitizeImage(raw);
    return this.saveBuffer(mime, data);
  }

  async saveBuffer(mime: string, data: Buffer): Promise<SavedPicture> {
    const row = this.store.create(mime, data, this.config.pictureTtlMs);
    let imageCid: string | null = null;
    if (usesPublicIpfsPinner(this.config)) {
      imageCid = await this.pinBytes(row.id, mime, data);
      this.store.setImageCid(row.id, imageCid);
      await this.catalog.updateManifestCid(row.id, imageCid);
    }
    await this.catalog.mirror({ ...row, imageCid }, data);
    return { pictureId: row.id, mime, bytes: data.length, imageCid };
  }

  async getBytes(id: string): Promise<{ mime: string; data: Buffer }> {
    const row = await this.resolveRow(id);
    if (!row) throw new IntentError("That picture expired or was not found. Upload again.", "not_found");
    return { mime: row.mime, data: row.data };
  }

  async saveFromRaw(_contentType: string, raw: Buffer): Promise<SavedPicture> {
    const { mime, data } = await sanitizeImage(raw);
    return this.saveBuffer(mime, data);
  }

  imageUrlForMetadata(pictureId: string, imageCid: string): string {
    if (this.pinner instanceof MemoryIpfsPinner) {
      return `${this.config.publicUrl}/api/pictures/${pictureId}`;
    }
    return `${this.config.ipfsGateway}/${imageCid}`;
  }

  async ensureImagePinned(pictureId: string): Promise<string> {
    const row = await this.resolveRow(pictureId);
    if (!row) throw new IntentError("That picture expired or was not found. Upload again.", "not_found");
    if (row.imageCid) return row.imageCid;
    if (usesPublicIpfsPinner(this.config)) {
      const ext = row.mime === "image/png" ? "png" : "jpg";
      const { cid } = await this.pinner.pin(`${pictureId}.${ext}`, row.data);
      this.store.setImageCid(pictureId, cid);
      await this.catalog.updateManifestCid(pictureId, cid);
      return cid;
    }
    if (this.catalog.enabled()) return pictureId;
    this.assertPublicPinningConfigured();
    const ext = row.mime === "image/png" ? "png" : "jpg";
    const { cid } = await this.pinner.pin(`${pictureId}.${ext}`, row.data);
    this.store.setImageCid(pictureId, cid);
    return cid;
  }

  async buildMetadataUri(input: TokenMetadataFields & { pictureId: string }): Promise<{ metadataUri: string; imageCid: string }> {
    const imageCid = await this.ensureImagePinned(input.pictureId);
    const image = this.imageUrlForMetadata(input.pictureId, imageCid);
    const bytes = buildTokenMetadataBytes({ ...input, image });
    if (usesPublicIpfsPinner(this.config)) {
      const { cid } = await this.pinner.pin("metadata.json", bytes);
      return { metadataUri: metadataUriFromCid(cid), imageCid };
    }
    if (this.catalog.enabled()) {
      try {
        const metadataUri = await this.catalog.publishMetadata(input.pictureId, bytes);
        return { metadataUri, imageCid };
      } catch (err) {
        throw new IntentError((err as Error).message, "bad_request");
      }
    }
    this.assertPublicPinningConfigured();
    const { cid } = await this.pinner.pin("metadata.json", bytes);
    return { metadataUri: metadataUriFromCid(cid), imageCid };
  }

  private assertPublicPinningConfigured(): void {
    if (usesPublicIpfsPinner(this.config) || this.catalog.enabled()) return;
    if (this.config.env.NODE_ENV === "production") {
      throw new IntentError(
        "Picture storage is not configured for production. Set BLOB_READ_WRITE_TOKEN, PROMPTFUN_KUBO_API_URL, or PROMPTFUN_PINATA_JWT.",
        "bad_request",
      );
    }
  }

  private async pinBytes(pictureId: string, mime: string, data: Buffer): Promise<string> {
    const ext = mime === "image/png" ? "png" : "jpg";
    const { cid } = await this.pinner.pin(`${pictureId}.${ext}`, data);
    return cid;
  }

  private async resolveRow(id: string): Promise<PictureRow | null> {
    const local = this.store.get(id);
    if (local) return local;
    const manifest = await this.catalog.loadManifest(id);
    if (!manifest) return null;
    const bytes = await this.catalog.loadBytes(id);
    if (!bytes) return null;
    return {
      id: manifest.id,
      mime: manifest.mime,
      data: bytes.data,
      imageCid: manifest.imageCid,
      createdAt: manifest.expiresAt - this.config.pictureTtlMs,
      expiresAt: manifest.expiresAt,
    };
  }
}

function parseImagePayload(value: string): Buffer {
  const v = value.trim();
  if (!v) throw new IntentError("Send image data as a base64 data URL or raw base64.", "bad_request");
  let b64 = v;
  const m = DATA_URL.exec(v);
  if (m) b64 = v.slice(m[0].length);
  try {
    const buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
    if (!buf.length) throw new Error("empty");
    return buf;
  } catch {
    throw new IntentError("Could not decode the image (expect base64 JPEG or PNG).", "bad_request");
  }
}

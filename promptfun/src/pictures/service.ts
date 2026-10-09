import type { Config } from "../config.js";
import { buildTokenMetadataBytes, metadataUriFromCid } from "../metadata/build.js";
import type { TokenMetadataFields } from "../metadata/build.js";
import { createIpfsPinner, type IpfsPinner, MemoryIpfsPinner } from "../ipfs/index.js";
import { IntentError } from "../intents/types.js";
import { PictureStore } from "./store.js";
import { sanitizeImage } from "./sanitize.js";

const DATA_URL = /^data:image\/(jpeg|png);base64,/i;

export class PictureService {
  readonly pinner: IpfsPinner;

  constructor(readonly config: Config, readonly store: PictureStore) {
    this.pinner = createIpfsPinner(config);
  }

  memoryBlobs(): Map<string, Buffer> | null {
    return this.pinner instanceof MemoryIpfsPinner ? this.pinner.blobs : null;
  }

  async saveFromBase64(dataUrlOrB64: string): Promise<{ pictureId: string; mime: string; bytes: number }> {
    const raw = parseImagePayload(dataUrlOrB64);
    const { mime, data } = await sanitizeImage(raw);
    const row = this.store.create(mime, data, this.config.pictureTtlMs);
    return { pictureId: row.id, mime, bytes: data.length };
  }

  getBytes(id: string): { mime: string; data: Buffer } {
    const row = this.store.get(id);
    if (!row) throw new IntentError("That picture expired or was not found. Upload again.", "not_found");
    return { mime: row.mime, data: row.data };
  }

  imageUrlForMetadata(pictureId: string, imageCid: string): string {
    const serve = this.config.ipfsImageServePath;
    if (serve && this.pinner instanceof MemoryIpfsPinner) {
      return `${this.config.publicUrl}${serve}?cid=${encodeURIComponent(imageCid)}`;
    }
    return `${this.config.ipfsGateway}/${imageCid}`;
  }

  async ensureImagePinned(pictureId: string): Promise<string> {
    const row = this.store.get(pictureId);
    if (!row) throw new IntentError("That picture expired or was not found. Upload again.", "not_found");
    if (row.imageCid) return row.imageCid;
    const ext = row.mime === "image/png" ? "png" : "jpg";
    const { cid } = await this.pinner.pin(`${pictureId}.${ext}`, row.data);
    this.store.setImageCid(pictureId, cid);
    return cid;
  }

  async buildMetadataUri(input: TokenMetadataFields & { pictureId: string }): Promise<{ metadataUri: string; imageCid: string }> {
    const imageCid = await this.ensureImagePinned(input.pictureId);
    const image = this.imageUrlForMetadata(input.pictureId, imageCid);
    const bytes = buildTokenMetadataBytes({ ...input, image });
    const { cid } = await this.pinner.pin("metadata.json", bytes);
    return { metadataUri: metadataUriFromCid(cid), imageCid };
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

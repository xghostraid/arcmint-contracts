import { IntentError } from "../intents/types.js";

export const MAX_PICTURE_BYTES = 15 * 1024 * 1024;

export type SanitizedImage = { mime: "image/jpeg" | "image/png"; data: Buffer };

function sniffMime(buf: Buffer): "image/jpeg" | "image/png" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

/** Re-encode JPEG/PNG to drop EXIF and other metadata. */
export async function sanitizeImage(raw: Buffer): Promise<SanitizedImage> {
  if (raw.length > MAX_PICTURE_BYTES) {
    throw new IntentError(`Images must be at most ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`, "bad_request");
  }
  const kind = sniffMime(raw);
  if (!kind) throw new IntentError("Only JPEG and PNG images are supported.", "bad_request");
  if (kind === "image/jpeg") {
    const jpeg = await import("jpeg-js");
    const decoded = jpeg.decode(raw, { useTArray: true });
    if (!decoded?.data) throw new IntentError("Could not read that JPEG.", "bad_request");
    const out = jpeg.encode({ data: decoded.data, width: decoded.width, height: decoded.height }, 92);
    if (out.data.length > MAX_PICTURE_BYTES) {
      throw new IntentError(`After processing, the image is still over ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`, "bad_request");
    }
    return { mime: "image/jpeg", data: Buffer.from(out.data) };
  }
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(raw);
  const out = PNG.sync.write(png);
  if (out.length > MAX_PICTURE_BYTES) {
    throw new IntentError(`After processing, the image is still over ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`, "bad_request");
  }
  return { mime: "image/png", data: out };
}

import type http from "node:http";
import { IntentError } from "../intents/types.js";

/** Read a raw request body up to maxBytes (for binary picture uploads). */
export async function readRawBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new IntentError(`Image must be at most ${Math.floor(maxBytes / (1024 * 1024))} MB.`, "bad_request");
    chunks.push(chunk as Buffer);
  }
  const buf = Buffer.concat(chunks);
  if (!buf.length) throw new IntentError("Empty upload.", "bad_request");
  return buf;
}

import type http from "node:http";
import type { PictureService } from "./service.js";
import { readRawBody } from "./read-body.js";
import { MAX_PICTURE_BYTES } from "./sanitize.js";
import { IntentError } from "../intents/types.js";

/** Host chat UIs that embed the picture panel and POST raw bytes cross-origin. */
const WIDGET_ORIGIN_SUFFIXES = [".claude.ai", ".claude.com", ".chatgpt.com", ".openai.com"] as const;

function isWidgetOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    return WIDGET_ORIGIN_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export function applyPictureApiCors(req: http.IncomingMessage, res: http.ServerResponse, publicOrigin: string): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && (origin === publicOrigin || isWidgetOrigin(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export async function handlePictureApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  publicUrl: string,
  pictures: PictureService,
  sendJson: (status: number, body: unknown) => void,
  sendBytes: (status: number, type: string, body: Buffer) => void,
): Promise<boolean> {
  const publicOrigin = new URL(publicUrl).origin;
  const isUpload = pathname === "/api/pictures/upload";
  const picMatch = /^\/api\/pictures\/(pic_[a-f0-9]{24})$/.exec(pathname);
  if (!isUpload && !picMatch) return false;

  applyPictureApiCors(req, res, publicOrigin);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (isUpload && req.method === "POST") {
    const ct = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (ct !== "image/jpeg" && ct !== "image/png") {
      sendJson(400, { error: "Content-Type must be image/jpeg or image/png." });
      return true;
    }
    const raw = await readRawBody(req, MAX_PICTURE_BYTES);
    const saved = await pictures.saveFromRaw(ct, raw);
    sendJson(200, saved);
    return true;
  }

  if (picMatch && req.method === "GET") {
    try {
      const { mime, data } = await pictures.getBytes(picMatch[1]);
      res.setHeader("Cache-Control", "public, max-age=300");
      sendBytes(200, mime, data);
      return true;
    } catch (err) {
      if (err instanceof IntentError && err.code === "not_found") {
        sendJson(404, { error: err.message });
        return true;
      }
      throw err;
    }
  }

  sendJson(405, { error: "Method not allowed." });
  return true;
}

import dns from "node:dns/promises";
import net from "node:net";
import { IntentError } from "../intents/types.js";
import { MAX_PICTURE_BYTES } from "./sanitize.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google",
  "metadata.goog",
  "169.254.169.254",
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    if (n === "::1" || n === "::") return true;
    if (n.startsWith("fc") || n.startsWith("fd")) return true;
    if (n.startsWith("fe80:")) return true;
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host)) {
    throw new IntentError("That image URL is not allowed.", "bad_request");
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    throw new IntentError("That image URL is not allowed.", "bad_request");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new IntentError("That image URL is not allowed.", "bad_request");
    return;
  }
  let addrs: string[];
  try {
    addrs = await dns.resolve4(host);
  } catch {
    try {
      addrs = await dns.resolve6(host);
    } catch {
      throw new IntentError("Could not resolve the image host.", "bad_request");
    }
  }
  for (const ip of addrs) {
    if (isPrivateIp(ip)) throw new IntentError("That image URL is not allowed.", "bad_request");
  }
}

/** Fetch JPEG/PNG bytes from a public HTTPS URL (server-side; for Claude chat attachments). */
export async function fetchImageFromUrl(imageUrl: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(imageUrl.trim());
  } catch {
    throw new IntentError("Image URL must be a valid https:// link.", "bad_request");
  }
  if (url.protocol !== "https:") {
    throw new IntentError("Image URL must use https://.", "bad_request");
  }
  if (!url.hostname) throw new IntentError("Image URL must include a host.", "bad_request");
  await assertPublicHost(url.hostname);

  const res = await fetch(url.href, {
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    headers: { Accept: "image/jpeg,image/png,*/*" },
  });
  if (!res.ok) {
    throw new IntentError(`Could not download the image (HTTP ${res.status}).`, "bad_request");
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_PICTURE_BYTES) {
    throw new IntentError(`Images must be at most ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`, "bad_request");
  }
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > MAX_PICTURE_BYTES) {
    throw new IntentError(`Images must be at most ${MAX_PICTURE_BYTES / (1024 * 1024)} MB.`, "bad_request");
  }
  if (!raw.length) throw new IntentError("Downloaded image was empty.", "bad_request");
  return raw;
}

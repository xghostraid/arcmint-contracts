import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

export const HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  let rel = clean.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) {
    rel = `${rel}index.html`;
  } else if (!extname(rel)) {
    rel = `${rel}/index.html`;
  }
  const full = normalize(join(ROOT, rel));
  return full.startsWith(ROOT) ? full : null;
}

export function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...HEADERS, Allow: "GET, HEAD" }).end();
    return;
  }
  let file;
  try {
    file = resolvePath(req.url || "/");
  } catch {
    file = null;
  }
  if (!file) {
    res.writeHead(400, HEADERS).end();
    return;
  }
  readFile(file).then(
    (body) => {
      const ext = extname(file);
      const cache =
        ext === ".html"
          ? "no-cache, must-revalidate"
          : ext === ".css" || ext === ".js"
            ? "public, max-age=3600, must-revalidate"
            : "public, max-age=86400";
      res.writeHead(200, {
        ...HEADERS,
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": cache,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    },
    () => {
      res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer(handler);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error("Port 4321 in use — run: lsof -ti :4321 | xargs kill -9");
      console.error("Or pick another port: PORT=8765 npm start");
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    console.log(`promptfun.fun site on http://${HOST}:${PORT}`);
  });
}

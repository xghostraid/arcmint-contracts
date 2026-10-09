import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { encode } from "jpeg-js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

function tinyJpeg(): Buffer {
  const { data } = encode({ data: new Uint8Array(4 * 4 * 4).fill(255), width: 4, height: 4 }, 80);
  return Buffer.from(data);
}

function request(
  base: string,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: Buffer },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${opts.path}`, { method: opts.method, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (opts.body) req.end(opts.body);
    else req.end();
  });
}

const testEnv = {
  PROMPTFUN_DB: ":memory:",
  PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
  PORT: "0",
  PROMPTFUN_PINATA_JWT: "",
  BLOB_READ_WRITE_TOKEN: "",
  PROMPTFUN_BLOB_READ_WRITE_TOKEN: "",
};

test("OPTIONS /api/pictures/upload returns CORS for claude.ai", async () => {
  const config = loadConfig(testEnv);
  const app = createApp(config);
  await app.listen();
  const base = app.config.publicUrl;

  const res = await request(base, {
    method: "OPTIONS",
    path: "/api/pictures/upload",
    headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://claude.ai");
  assert.match(String(res.headers["access-control-allow-methods"]), /POST/);
  assert.match(String(res.headers["access-control-allow-headers"]), /Content-Type/i);
  await app.close();
});

test("POST /api/pictures/upload echoes Allow-Origin for claude.com widget", async () => {
  const config = loadConfig(testEnv);
  const app = createApp(config);
  await app.listen();
  const base = app.config.publicUrl;

  const res = await request(base, {
    method: "POST",
    path: "/api/pictures/upload",
    headers: { Origin: "https://claude.com", "Content-Type": "image/jpeg" },
    body: tinyJpeg(),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "https://claude.com");
  const saved = JSON.parse(res.body) as { pictureId: string };
  assert.match(saved.pictureId, /^pic_[a-f0-9]{24}$/);
  await app.close();
});

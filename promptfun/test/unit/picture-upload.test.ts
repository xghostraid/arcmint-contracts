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

test("POST /api/pictures/upload accepts raw JPEG without MCP JSON body", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_PUBLIC_URL: "http://127.0.0.1:9999" });
  const app = createApp(config);
  await app.listen();
  const base = app.config.publicUrl;
  const jpeg = tinyJpeg();

  const saved = await new Promise<{ pictureId: string; bytes: number }>((resolve, reject) => {
    const req = http.request(`${base}/api/pictures/upload`, { method: "POST", headers: { "Content-Type": "image/jpeg" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => {
        try {
          assert.equal(res.statusCode, 200);
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.end(jpeg);
  });

  assert.match(saved.pictureId, /^pic_[a-f0-9]{24}$/);
  assert.ok(saved.bytes > 0);

  const fetched = await new Promise<Buffer>((resolve, reject) => {
    http.get(`${base}/api/pictures/${saved.pictureId}`, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error(String(res.statusCode)));
        else resolve(Buffer.concat(chunks));
      });
    }).on("error", reject);
  });
  assert.ok(fetched.length > 0);
  await app.close();
});

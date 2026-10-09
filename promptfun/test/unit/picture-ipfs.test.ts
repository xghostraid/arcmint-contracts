import assert from "node:assert/strict";
import { test } from "node:test";
import { encode } from "jpeg-js";
import { loadConfig } from "../../src/config.js";
import { MemoryIpfsPinner } from "../../src/ipfs/memory.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";
import { MAX_PICTURE_BYTES, sanitizeImage } from "../../src/pictures/sanitize.js";

function tinyJpeg(): Buffer {
  const { data } = encode({ data: new Uint8Array(4 * 4 * 4).fill(255), width: 4, height: 4 }, 80);
  return Buffer.from(data);
}

test("sanitize re-encodes JPEG and enforces size cap", async () => {
  const out = await sanitizeImage(tinyJpeg());
  assert.equal(out.mime, "image/jpeg");
  assert.ok(out.data.length > 0 && out.data.length < MAX_PICTURE_BYTES);
});

test("picture service pins image and metadata with memory IPFS", async () => {
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_PUBLIC_URL: "http://127.0.0.1:9999" });
  const store = new PictureStore(":memory:");
  const svc = new PictureService(config, store);
  const b64 = tinyJpeg().toString("base64");
  const saved = await svc.saveFromBase64(`data:image/jpeg;base64,${b64}`);
  assert.match(saved.pictureId, /^pic_[a-f0-9]{24}$/);
  const { metadataUri, imageCid } = await svc.buildMetadataUri({
    pictureId: saved.pictureId,
    name: "Test",
    symbol: "TST",
    description: "Hello",
    website: "https://example.com",
    x: "https://x.com/test",
  });
  assert.match(metadataUri, /^ipfs:\/\//);
  assert.ok(metadataUri.length <= 200);
  const blobs = svc.memoryBlobs();
  assert.ok(blobs?.has(imageCid));
});

test("memory pinner returns stable CID for same bytes", async () => {
  const p = new MemoryIpfsPinner();
  const data = new Uint8Array([1, 2, 3]);
  const a = await p.pin("a.bin", data);
  const b = await p.pin("b.bin", data);
  assert.equal(a.cid, b.cid);
});

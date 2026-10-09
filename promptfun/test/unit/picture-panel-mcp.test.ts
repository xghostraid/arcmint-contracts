import assert from "node:assert/strict";
import { test } from "node:test";
import { encode } from "jpeg-js";
import { startHarness } from "../e2e/harness.js";

function tinyJpeg(): Buffer {
  const { data } = encode({ data: new Uint8Array(8 * 8 * 4).fill(255), width: 8, height: 8 }, 80);
  return Buffer.from(data);
}

test("upload_picture_bytes accepts panel-sized base64 data URL", async () => {
  const h = await startHarness({
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
    PROMPTFUN_PINATA_JWT: "",
    BLOB_READ_WRITE_TOKEN: "",
    PROMPTFUN_BLOB_READ_WRITE_TOKEN: "",
  });
  const b64 = tinyJpeg().toString("base64");
  const r = await h.call("upload_picture_bytes", { imageBase64: `data:image/jpeg;base64,${b64}` });
  assert.equal(r.isError, false);
  assert.match(r.data.pictureId, /^pic_[a-f0-9]{24}$/);
  assert.ok(r.data.bytes > 0);
  await h.close();
});

test("picture panel HTML uses MCP upload_picture_bytes, not fetch upload", async () => {
  const h = await startHarness({ PROMPTFUN_PUBLIC_URL: "https://promptfun.fun" });
  const resource: any = await h.client.readResource({ uri: "ui://promptfun/picture-v1.html" });
  const html = resource.contents[0].text as string;
  assert.match(html, /upload_picture_bytes/);
  assert.doesNotMatch(html, /fetch\([^)]*\/api\/pictures\/upload/);
  await h.close();
});

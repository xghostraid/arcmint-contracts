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

test("picture panel HTML notifies host via redundant handoff channels after save", async () => {
  const h = await startHarness({ PROMPTFUN_PUBLIC_URL: "https://promptfun.fun" });
  const resource: any = await h.client.readResource({ uri: "ui://promptfun/picture-v1.html" });
  const html = resource.contents[0].text as string;
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.match(html, /ui\/update-model-context/);
  assert.match(html, /ui\/message/);
  assert.match(html, /pic-id-row/);
  assert.match(html, /handoffSessionId/);
  assert.match(html, /Launch ready/);
  await h.close();
});

test("open_picture_panel returns handoffSessionId in structured content and plain text", async () => {
  const h = await startHarness({ PROMPTFUN_PUBLIC_URL: "https://promptfun.fun" });
  const r = await h.call("open_picture_panel", {});
  assert.match(r.data.handoffSessionId, /^hs_[a-f0-9]{24}$/);
  assert.match(r.text, /handoffSessionId hs_/);
  assert.match(r.text, /prepare_launch/);
  await h.close();
});

test("get_last_picture returns the most recent panel upload", async () => {
  const h = await startHarness({
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
    PROMPTFUN_PINATA_JWT: "",
    BLOB_READ_WRITE_TOKEN: "",
    PROMPTFUN_BLOB_READ_WRITE_TOKEN: "",
  });
  const empty = await h.call("get_last_picture", {});
  assert.equal(empty.isError, true);
  const b64 = tinyJpeg().toString("base64");
  const saved = await h.call("upload_picture_bytes", { imageBase64: `data:image/jpeg;base64,${b64}` });
  assert.equal(saved.isError, false);
  const last = await h.call("get_last_picture", {});
  assert.equal(last.isError, false);
  assert.equal(last.data.pictureId, saved.data.pictureId);
  assert.match(last.data.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  await h.close();
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { PictureHandoffStore, matchHandoffBlobPath, newHandoffSessionId } from "../../src/pictures/handoff-store.js";

test("newHandoffSessionId format", () => {
  assert.match(newHandoffSessionId(), /^hs_[a-f0-9]{24}$/);
});

test("matchHandoffBlobPath accepts exact pathname or digest suffix", () => {
  const expected = "picture-handoffs/abc123def4567890abcdef1234567890.json";
  assert.equal(matchHandoffBlobPath(expected, expected), true);
  assert.equal(matchHandoffBlobPath("picture-handoffs/nested/abc123def4567890abcdef1234567890.json", expected), true);
  assert.equal(matchHandoffBlobPath("picture-handoffs/other.json", expected), false);
});

test("PictureHandoffStore remembers by scope and session in memory", async () => {
  const store = new PictureHandoffStore(null);
  const session = newHandoffSessionId();
  const saved = {
    pictureId: "pic_0123456789abcdef01234567",
    mime: "image/jpeg",
    bytes: 42,
    savedAt: "2026-01-01T00:00:00.000Z",
  };
  await store.persist("anonymous", saved, session);
  const bySession = await store.load("anonymous", session);
  assert.equal(bySession?.pictureId, saved.pictureId);
  const byScope = await store.load("anonymous");
  assert.equal(byScope?.pictureId, saved.pictureId);
});

test("get_last_picture with handoffSessionId after panel upload", async () => {
  const { startHarness } = await import("../e2e/harness.js");
  const { encode } = await import("jpeg-js");
  const h = await startHarness({
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
    PROMPTFUN_PINATA_JWT: "",
    BLOB_READ_WRITE_TOKEN: "",
    PROMPTFUN_BLOB_READ_WRITE_TOKEN: "",
  });
  const panel: any = await h.call("open_picture_panel", {});
  assert.match(panel.data.handoffSessionId, /^hs_/);
  const { data } = encode({ data: new Uint8Array(8 * 8 * 4).fill(255), width: 8, height: 8 }, 80);
  const b64 = Buffer.from(data).toString("base64");
  const saved = await h.call("upload_picture_bytes", {
    imageBase64: `data:image/jpeg;base64,${b64}`,
    handoffSessionId: panel.data.handoffSessionId,
  });
  assert.equal(saved.isError, false);
  const last = await h.call("get_last_picture", { handoffSessionId: panel.data.handoffSessionId });
  assert.equal(last.isError, false);
  assert.equal(last.data.pictureId, saved.data.pictureId);
  await h.close();
});

test("prepare_launch resolves pictureId via handoffSessionId after panel upload", async () => {
  const { startHarness } = await import("../e2e/harness.js");
  const { encode } = await import("jpeg-js");
  const h = await startHarness({
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_PINATA_JWT: "",
    BLOB_READ_WRITE_TOKEN: "",
    PROMPTFUN_BLOB_READ_WRITE_TOKEN: "",
  });
  const panel: any = await h.call("open_picture_panel", {});
  const { data } = encode({ data: new Uint8Array(8 * 8 * 4).fill(255), width: 8, height: 8 }, 80);
  await h.call("upload_picture_bytes", {
    imageBase64: `data:image/jpeg;base64,${Buffer.from(data).toString("base64")}`,
    handoffSessionId: panel.data.handoffSessionId,
  });
  const prep = await h.call("prepare_launch", {
    name: "Handoff",
    symbol: "HF",
    handoffSessionId: panel.data.handoffSessionId,
  });
  assert.equal(prep.isError, false);
  assert.ok((prep.data as { params?: { metadataUri?: string } }).params?.metadataUri);
  await h.close();
});

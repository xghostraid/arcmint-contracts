import assert from "node:assert/strict";
import { test } from "node:test";
import { blobReadWriteToken, logBlobStorageStartup } from "../../src/blob/token.js";

test("blobReadWriteToken prefers BLOB_READ_WRITE_TOKEN then alias", () => {
  assert.equal(blobReadWriteToken({ BLOB_READ_WRITE_TOKEN: " vercel " }), "vercel");
  assert.equal(blobReadWriteToken({ PROMPTFUN_BLOB_READ_WRITE_TOKEN: "alias" }), "alias");
  assert.equal(blobReadWriteToken({ BLOB_READ_WRITE_TOKEN: "primary", PROMPTFUN_BLOB_READ_WRITE_TOKEN: "alias" }), "primary");
  assert.equal(blobReadWriteToken({}), null);
});

test("logBlobStorageStartup warns once when token missing", () => {
  const lines: string[] = [];
  logBlobStorageStartup({}, { warn: (msg) => lines.push(msg) });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /BLOB_READ_WRITE_TOKEN is unset/);
  logBlobStorageStartup({ BLOB_READ_WRITE_TOKEN: "x" }, { warn: (msg) => lines.push(msg) });
  assert.equal(lines.length, 1);
});

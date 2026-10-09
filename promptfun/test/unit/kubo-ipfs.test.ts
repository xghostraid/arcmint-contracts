import assert from "node:assert/strict";
import { test } from "node:test";
import { KuboIpfsPinner } from "../../src/ipfs/kubo.js";

const kuboUrl = process.env.PROMPTFUN_KUBO_API_URL?.trim();

test("Kubo pinner adds bytes when PROMPTFUN_KUBO_API_URL is set", { skip: kuboUrl ? false : "Set PROMPTFUN_KUBO_API_URL to run" }, async () => {
  const p = new KuboIpfsPinner(kuboUrl!);
  const { cid, size } = await p.pin("hello.txt", new TextEncoder().encode("hello kubo"));
  assert.ok(cid.length > 10);
  assert.ok(size > 0);
});

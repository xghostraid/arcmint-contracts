import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { encode } from "jpeg-js";
import { loadConfig } from "../../src/config.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";
import { fetchImageFromUrl } from "../../src/pictures/fetch-url.js";

function tinyJpeg(): Buffer {
  const { data } = encode({ data: new Uint8Array(4 * 4 * 4).fill(255), width: 4, height: 4 }, 80);
  return Buffer.from(data);
}

test("fetchImageFromUrl rejects non-https URLs", async () => {
  await assert.rejects(fetchImageFromUrl("http://example.com/x.jpg"), /https/);
  await assert.rejects(fetchImageFromUrl("file:///etc/passwd"), /https/);
});

test("fetchImageFromUrl rejects localhost", async () => {
  await assert.rejects(fetchImageFromUrl("https://localhost/photo.jpg"), /not allowed/);
});

test("PictureService.saveFromUrl imports a public JPEG", async () => {
  const jpeg = tinyJpeg();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(jpeg);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const config = loadConfig({ PROMPTFUN_DB: ":memory:", PROMPTFUN_PUBLIC_URL: "http://127.0.0.1:9999" });
  const svc = new PictureService(config, new PictureStore(":memory:"));

  await assert.rejects(svc.saveFromUrl(`https://127.0.0.1:${port}/coin.jpg`), /not allowed/);

  server.close();
});

test("prepare_launch accepts imageUrl on pump.fun mainnet path", async () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_PUBLIC_URL: "http://127.0.0.1:9999",
  });
  const { IntentService } = await import("../../src/intents/service.js");
  const { IntentStore } = await import("../../src/intents/store.js");
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const jpeg = tinyJpeg();
  const saved = await pictures.saveBuffer("image/jpeg", jpeg);
  const service = new IntentService(config, new IntentStore(":memory:"), pictures);

  await assert.rejects(
    service.prepareLaunch({ chain: "solana-mainnet", name: "Rocket", symbol: "RKT" }),
    /open_picture_panel/,
  );

  const intent = await service.prepareLaunch({
    chain: "solana-mainnet",
    name: "Rocket",
    symbol: "RKT",
    pictureId: saved.pictureId,
  });
  assert.equal(intent.kind, "launch_token");
  assert.ok((intent.params as { metadataUri?: string }).metadataUri);
});

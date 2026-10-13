import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";
import { buildTokenMetadataJson } from "../../src/metadata/build.js";

test("blob-only image refs use HTTPS picture API URLs in metadata JSON", () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_PUBLIC_URL: "https://promptfun.fun",
  });
  const svc = new PictureService(config, new PictureStore(":memory:"));
  const pictureId = "pic_000000000000000000000000";
  const image = svc.imageUrlForMetadata(pictureId, pictureId);
  assert.equal(image, `https://promptfun.fun/api/pictures/${pictureId}`);
  const json = buildTokenMetadataJson({
    name: "Cat",
    symbol: "CAT",
    description: "",
    image,
  });
  assert.match(String(json.image), /^https:\/\/promptfun\.fun\/api\/pictures\/pic_/);
  assert.doesNotMatch(String(json.image), /ipfs\.io/);
});

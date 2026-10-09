import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMetadataUriLength, buildTokenMetadataJson, metadataUriFromCid } from "../../src/metadata/build.js";

test("metadata JSON includes website and twitter from x", () => {
  const json = buildTokenMetadataJson({
    name: "Moon",
    symbol: "MOON",
    description: "A test coin",
    image: "https://example.com/i.png",
    website: "https://moon.example",
    x: "https://x.com/mooncoin",
  });
  assert.equal(json.website, "https://moon.example");
  assert.equal(json.twitter, "https://x.com/mooncoin");
  assert.equal(json.description, "A test coin");
});

test("ipfs metadata URI stays under 200 characters for typical CIDs", () => {
  const uri = metadataUriFromCid("bafybeigdyrzt5sfp7udm17uh4l0y5qenqwf2jq4vxqjq4vxqjq4vxqjq4");
  assert.match(uri, /^ipfs:\/\//);
  assert.doesNotThrow(() => assertMetadataUriLength(uri));
});

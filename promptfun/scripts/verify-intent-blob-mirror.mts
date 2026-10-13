#!/usr/bin/env npx tsx
/**
 * Ops check: list mirrored launch intents on Vercel Blob (intents/*.json).
 * Requires BLOB_READ_WRITE_TOKEN or PROMPTFUN_BLOB_READ_WRITE_TOKEN in env.
 * Does not print secrets.
 */
import { blobReadWriteToken } from "../src/blob/token.js";
import { IntentCatalog } from "../src/intents/catalog.js";

const token = blobReadWriteToken(process.env);
if (!token) {
  console.error("Missing BLOB_READ_WRITE_TOKEN (or PROMPTFUN_BLOB_READ_WRITE_TOKEN).");
  process.exit(1);
}

const max = Number(process.env.PROMPTFUN_BLOB_LIST_MAX || "50");
const catalog = new IntentCatalog(token);
const intents = await catalog.listMirrored(max);
const launches = intents.filter((i) => i.kind === "launch_token");
const confirmed = launches.filter((i) => i.status === "confirmed" && i.receipt?.status === "success");

console.log(
  JSON.stringify(
    {
      blobPrefix: "intents/",
      totalMirrored: intents.length,
      launchIntents: launches.length,
      confirmedMainnetReady: confirmed.length,
      sampleIds: intents.slice(0, 10).map((i) => ({ id: i.id, status: i.status, chain: i.chain })),
    },
    null,
    2,
  ),
);

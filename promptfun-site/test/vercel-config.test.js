import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vercel = JSON.parse(
  await readFile(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
);

test("vercel.json proxies MCP/API via PROMPTFUN_BACKEND_URL (no hardcoded host)", () => {
  const blob = JSON.stringify(vercel);
  assert.doesNotMatch(blob, /fly\.dev/i, "backend host must come from env, not a placeholder URL");
  assert.doesNotMatch(blob, /YOUR-MCP-BACKEND/i);
  const routes = vercel.routes ?? [];
  const mcp = routes.find((r) => r.src === "/mcp");
  assert.ok(mcp, "missing /mcp route");
  assert.match(mcp.dest, /\$\{PROMPTFUN_BACKEND_URL\}/);
  assert.deepEqual(mcp.env, ["PROMPTFUN_BACKEND_URL"]);
  const api = routes.find((r) => r.src === "/api/(.*)");
  assert.ok(api, "missing /api proxy route");
  assert.match(api.dest, /\$\{PROMPTFUN_BACKEND_URL\}/);
  assert.ok(routes.some((r) => r.handle === "filesystem"), "static files need filesystem handler");
});

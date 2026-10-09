import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../src/config.js";
import { EXAMPLE_USER_PROMPTS, launchPlaybook, serverInstructions } from "../../src/mcp/launch-playbook.js";

test("launch playbook tells models not to ask for tool names or pasted URLs", () => {
  const config = loadConfig({
    PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1",
    PROMPTFUN_ENABLE_SPONSORED_LAUNCHES: "1",
    PROMPTFUN_ENABLE_SPONSORED_MAINNET: "1",
    PROMPTFUN_SPONSOR_SECRET_KEY: "dummy",
  });
  const lines = launchPlaybook(config);
  const joined = lines.join("\n");
  assert.match(joined, /Never ask them to name MCP tools/);
  assert.match(joined, /import_picture_from_url/);
  assert.match(joined, /get_last_picture/);
  assert.match(joined, /solana-mainnet/);
  assert.match(joined, /Launch it/);
});

test("server instructions mention short prompts and launchPlaybook", () => {
  const config = loadConfig({ PROMPTFUN_ENABLE_PUMPFUN_MAINNET: "1" });
  const text = serverInstructions(config);
  assert.match(text, /Short prompts work/);
  assert.match(text, /launchPlaybook/);
  assert.match(text, /Launch TEST on mainnet/);
});

test("example user prompts are short one-liners", () => {
  assert.equal(EXAMPLE_USER_PROMPTS.length, 3);
  for (const p of EXAMPLE_USER_PROMPTS) {
    assert.ok(p.length < 80, p);
    assert.doesNotMatch(p, /open_picture_panel|import_picture/i);
  }
});

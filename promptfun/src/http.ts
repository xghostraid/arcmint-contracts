import { createApp } from "./app.js";
import { BRAND } from "./brand.js";
import { loadConfig } from "./config.js";

const app = createApp(loadConfig());
const url = await app.listen();
console.error(`${BRAND} listening on ${url} (MCP at ${url}/mcp, approvals at ${app.config.publicUrl}/approve/<id>)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

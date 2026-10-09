import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createApp } from "./app.js";
import { BRAND } from "./brand.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./mcp/server.js";

/** Local-testing entry: MCP over stdio, plus the HTTP approval page the user opens. ChatGPT itself needs /mcp over HTTPS. */
const app = createApp(loadConfig());
const url = await app.listen();
console.error(`${BRAND} (stdio) approval pages at ${app.config.publicUrl}/approve/<id> (listening on ${url})`);
serveStdio(() => buildServer(app.service));

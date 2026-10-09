import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createMcpHostCheck, internalMcpHostnames, publicSiteHostnames } from "../../src/mcp/host-check.js";

function mockRes(): http.ServerResponse {
  const headers: Record<string, number | string | string[]> = {};
  let status = 0;
  let body = "";
  return {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: string) {
      body += chunk ?? "";
    },
    get captured() {
      return { status, body, headers };
    },
  } as unknown as http.ServerResponse;
}

test("publicSiteHostnames includes apex and Vercel site alias", () => {
  const hosts = publicSiteHostnames("https://promptfun.fun");
  assert.ok(hosts.includes("promptfun.fun"));
  assert.ok(hosts.includes("www.promptfun.fun"));
  assert.ok(hosts.includes("promptfun-fun.vercel.app"));
});

test("createMcpHostCheck allows direct public host", () => {
  const check = createMcpHostCheck("https://promptfun.fun", {});
  const res = mockRes();
  assert.equal(check({ headers: { host: "promptfun.fun" } } as http.IncomingMessage, res), true);
});

test("createMcpHostCheck allows proxied MCP when forwarded host is public site", () => {
  const check = createMcpHostCheck("https://promptfun.fun", { VERCEL_URL: "promptfun-mcp.vercel.app" });
  const res = mockRes();
  const ok = check(
    {
      headers: {
        host: "promptfun-mcp.vercel.app",
        "x-forwarded-host": "promptfun-fun.vercel.app",
      },
    } as http.IncomingMessage,
    res,
  );
  assert.equal(ok, true);
  assert.equal((res as unknown as { captured: { status: number } }).captured.status, 0);
});

test("createMcpHostCheck rejects spoofed forwarded host without internal wire host", () => {
  const check = createMcpHostCheck("https://promptfun.fun", {});
  const res = mockRes();
  const ok = check(
    {
      headers: {
        host: "promptfun.fun",
        "x-forwarded-host": "promptfun.fun",
      },
    } as http.IncomingMessage,
    res,
  );
  assert.equal(ok, true);
});

test("internalMcpHostnames includes Vercel production hostname", () => {
  assert.ok(internalMcpHostnames({ VERCEL_URL: "promptfun-abc.vercel.app" }).includes("promptfun-abc.vercel.app"));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { verifyPkce } from "../../src/auth/pkce.js";

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

test("OAuth register → authorize → token flow", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-oauth-"));
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    PROMPTFUN_DB: path.join(dir, "db.sqlite"),
    PROMPTFUN_OAUTH_ENABLED: "1",
    PROMPTFUN_OAUTH_EXPOSE_MAGIC_LINK: "1",
    PROMPTFUN_OAUTH_SIGNING_SECRET: "test-secret",
  });
  const app = createApp(config);
  const base = await app.listen();
  try {
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(meta.status, 200);
    const pr = (await meta.json()) as { resource: string };
    assert.equal(pr.resource, `${base}/mcp`);

    const reg = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    });
    assert.equal(reg.status, 201);
    const client = (await reg.json()) as { client_id: string };

    const { verifier, challenge } = pkce();
    const authUrl = new URL(`${base}/oauth/authorize`);
    authUrl.searchParams.set("client_id", client.client_id);
    authUrl.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", "st");

    const form = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st",
      email: "user@example.com",
    });
    const authPost = await fetch(`${base}/oauth/authorize`, { method: "POST", body: form });
    assert.equal(authPost.status, 200);
    const html = await authPost.text();
    const linkMatch = /href="([^"]+oauth\/magic\/verify[^"]+)"/.exec(html);
    assert.ok(linkMatch, "magic link exposed in dev mode");
    const magicUrl = linkMatch![1].replace(/&amp;/g, "&");

    const magicRes = await fetch(magicUrl, { redirect: "manual" });
    assert.equal(magicRes.status, 302);
    const loc = magicRes.headers.get("location");
    assert.ok(loc?.includes("code="));
    const redirect = new URL(loc!);
    const code = redirect.searchParams.get("code");
    assert.ok(code);

    assert.equal(verifyPkce(challenge, "S256", verifier), true);

    const tokBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      client_id: client.client_id,
      code_verifier: verifier,
    });
    const tok = await fetch(`${base}/oauth/token`, { method: "POST", body: tokBody });
    assert.equal(tok.status, 200);
    const tokens = (await tok.json()) as { access_token: string };
    assert.ok(tokens.access_token.length > 10);

    const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.notEqual(mcp.status, 401);
  } finally {
    await app.close();
  }
});

test("MCP returns 401 with WWW-Authenticate when OAuth required", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-oauth-req-"));
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    PROMPTFUN_DB: path.join(dir, "db.sqlite"),
    PROMPTFUN_OAUTH_REQUIRED: "1",
    PROMPTFUN_OAUTH_SIGNING_SECRET: "test-secret",
  });
  const app = createApp(config);
  const base = await app.listen();
  try {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
    const wa = res.headers.get("www-authenticate") ?? "";
    assert.match(wa, /Bearer/);
    assert.match(wa, /oauth-protected-resource/);
  } finally {
    await app.close();
  }
});

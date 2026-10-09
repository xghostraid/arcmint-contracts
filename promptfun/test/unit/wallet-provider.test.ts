import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { loadConfig } from "../../src/config.js";
import { PlatformStore, platformDbPath } from "../../src/platform/store.js";
import { ClaimLaterWalletProvider, platformSubFromEmail } from "../../src/wallets/claim-later.js";
import { PrivyApiClient, solanaEmbeddedAddress } from "../../src/wallets/privy-api.js";
import { createApp } from "../../src/app.js";
import { IntentService } from "../../src/intents/service.js";
import { IntentStore } from "../../src/intents/store.js";
import { PictureService } from "../../src/pictures/service.js";
import { PictureStore } from "../../src/pictures/store.js";

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function mockPrivyFetch(handlers: Record<string, (init?: RequestInit) => unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      return new Response(JSON.stringify({ error: "unexpected", key }), { status: 500 });
    }
    const body = handler(init);
    if (body === null) return new Response("", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("solanaEmbeddedAddress finds embedded Solana wallet", () => {
  const addr = solanaEmbeddedAddress({
    id: "did:privy:abc",
    linked_accounts: [
      { type: "email", address: "a@b.co" },
      { type: "wallet", chain_type: "solana", connector_type: "embedded", address: SOL },
    ],
  });
  assert.equal(addr, SOL);
});

test("ClaimLaterWalletProvider caches and creates via Privy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-wallet-"));
  const platform = new PlatformStore(platformDbPath(path.join(dir, "db.sqlite")));
  const email = "creator@example.com";
  const sub = platformSubFromEmail(email);
  let createCalls = 0;
  const privy = new PrivyApiClient(
    "app-id",
    "app-secret",
    mockPrivyFetch({
      [`POST https://api.privy.io/v1/users/email/address`]: () => null,
      [`POST https://api.privy.io/v1/users`]: () => {
        createCalls += 1;
        return {
          id: "did:privy:new",
          linked_accounts: [{ type: "wallet", chain_type: "solana", connector_type: "embedded", address: SOL }],
        };
      },
    }),
  );
  const config = loadConfig({
    PROMPTFUN_PUBLIC_URL: "https://promptfun.test",
    PROMPTFUN_PRIVY_APP_ID: "app-id",
    PROMPTFUN_PRIVY_APP_SECRET: "app-secret",
  });
  const provider = new ClaimLaterWalletProvider(config, platform, privy);
  const first = await provider.ensureSolanaWallet(sub, email);
  const second = await provider.ensureSolanaWallet(sub, email);
  assert.equal(first.solanaAddress, SOL);
  assert.equal(second.solanaAddress, SOL);
  assert.equal(createCalls, 1);
  platform.close();
});

test("prepare_launch binds feeRecipient to claim wallet for signed-in caller", async () => {
  const config = loadConfig({
    PROMPTFUN_DB: ":memory:",
    PROMPTFUN_ENABLE_LOCALNET: "1",
    PROMPTFUN_PUBLIC_URL: "https://promptfun.test",
    PROMPTFUN_PRIVY_APP_ID: "app-id",
    PROMPTFUN_PRIVY_APP_SECRET: "app-secret",
  });
  const platform = new PlatformStore(":memory:");
  const privy = new PrivyApiClient(
    "app-id",
    "app-secret",
    mockPrivyFetch({
      [`POST https://api.privy.io/v1/users/email/address`]: () => ({
        id: "did:privy:existing",
        linked_accounts: [{ type: "wallet", chain_type: "solana", connector_type: "embedded", address: SOL }],
      }),
    }),
  );
  const claimProvider = new ClaimLaterWalletProvider(config, platform, privy);
  const pictures = new PictureService(config, new PictureStore(":memory:"));
  const s = new IntentService(config, new IntentStore(":memory:"), pictures, platform, claimProvider);
  const email = "launch@example.com";
  const sub = createHash("sha256").update(`promptfun:${email}`).digest("hex").slice(0, 32);
  s.setCaller({ sub, email });
  const intent = await s.prepareLaunch({
    chain: "solana-localnet",
    name: "Test",
    symbol: "TST",
    metadataUri: "https://example.com/m.json",
    venue: "spl",
  });
  assert.equal((intent.params as { feeRecipient?: string }).feeRecipient, SOL);
  platform.close();
});

test("POST /claim returns magic link in dev mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-claim-http-"));
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    PROMPTFUN_DB: path.join(dir, "db.sqlite"),
    PROMPTFUN_OAUTH_ENABLED: "1",
    PROMPTFUN_OAUTH_EXPOSE_MAGIC_LINK: "1",
    PROMPTFUN_PRIVY_APP_ID: "app-id",
    PROMPTFUN_PRIVY_APP_SECRET: "app-secret",
  });
  const app = createApp(config);
  const base = await app.listen();
  try {
    const form = new URLSearchParams({ email: "claim@example.com" });
    const post = await fetch(`${base}/claim`, { method: "POST", body: form });
    assert.equal(post.status, 200);
    const html = await post.text();
    assert.match(html, /claim\/verify\?token=/);
  } finally {
    await app.close();
  }
});

test("GET /api/claim/wallet requires Bearer token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-claim-api-"));
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    PROMPTFUN_DB: path.join(dir, "db.sqlite"),
    PROMPTFUN_OAUTH_ENABLED: "1",
    PROMPTFUN_PRIVY_APP_ID: "app-id",
    PROMPTFUN_PRIVY_APP_SECRET: "app-secret",
    PROMPTFUN_OAUTH_SIGNING_SECRET: "test-secret",
  });
  const app = createApp(config);
  const base = await app.listen();
  try {
    const anon = await fetch(`${base}/api/claim/wallet`);
    assert.equal(anon.status, 401);
  } finally {
    await app.close();
  }
});

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { insertCoin, LOCAL_MINT, LOCAL_WALLET, seedLocalCoin } from "../server/db.js";
import { launchLimit } from "../server/desk.js";
import { createServer } from "../server/index.js";
import { launchCoin } from "../server/launch.js";
import { encodeBase58, walletFromPublicKey } from "../server/solana.js";
import { DESK_EMPTY } from "../shared/copy.js";

const BANNED = [
  "balanceSol",
  "SOCKET_LAUNCH_KEY",
  "treasuryKey",
  "secretKey",
  "privateKey",
];

function mint(label) {
  return (`${label}Mint` + "1".repeat(40)).slice(0, 44);
}

function keypair() {
  const keys = generateKeyPairSync("ed25519");
  return { ...keys, wallet: walletFromPublicKey(keys.publicKey) };
}

function signNonce(privateKey, nonce) {
  return encodeBase58(sign(null, Buffer.from(nonce), privateKey));
}

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  const server = createServer({ dbPath: path.join(dir, "t.sqlite") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    db: server.db,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      server.db.close();
    },
  };
}

async function post(base, pathname, body, headers = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

function rpc(id, name, args) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

test("a throwaway signature opens only that wallet, and a bad signature is rejected", async () => {
  const app = await start();
  try {
    const owner = keypair();
    const other = keypair();
    insertCoin(app.db, {
      mint: mint("Own"),
      name: "Owned Lamp",
      ticker: "OWN",
      createdAt: "2026-10-08T12:00:00.000Z",
      wallet: owner.wallet,
      paidToCreatorSol: 0.2,
      status: "confirmed",
      live: true,
    });
    launchCoin(app.db, {
      name: "Missed",
      ticker: "MISS",
      wallet: owner.wallet,
      idempotency_key: "owner-failed-job",
    });
    launchCoin(app.db, {
      name: "Hidden fail",
      ticker: "HIDE",
      wallet: other.wallet,
      idempotency_key: "other-failed-job",
    });

    const issued = await post(app.base, "/api/desk/nonce", { wallet: owner.wallet });
    assert.equal(issued.json.ok, true);
    const signature = signNonce(owner.privateKey, issued.json.nonce);
    const opened = await post(app.base, "/mcp", rpc(1, "list_wallet_coins", {
      wallet: owner.wallet,
      nonce: issued.json.nonce,
      signature,
    }));
    assert.equal(opened.json.result.isError, undefined);
    const desk = opened.json.result.structuredContent;
    assert.equal(desk.wallet, owner.wallet);
    assert.equal(desk.paidSol, 0.2);
    assert.deepEqual(desk.coins.map((coin) => coin.ticker), ["OWN"]);
    assert.equal(desk.failed.some((job) => job.ticker === "MISS"), true);
    assert.equal(desk.failed.some((job) => job.ticker === "HIDE"), false);
    assert.equal(JSON.stringify(desk).includes(other.wallet), false);
    for (const word of BANNED) assert.equal(JSON.stringify(desk).includes(word), false, word);

    const again = await post(app.base, "/mcp", rpc(2, "list_wallet_coins", {
      wallet: owner.wallet,
      nonce: issued.json.nonce,
      signature,
    }));
    assert.equal(again.json.result.isError, true);
    assert.equal(again.json.result.content[0].text, "That signature was rejected.");
    assert.equal(again.json.result.content[0].text.includes("HIDE"), false);
    assert.equal(again.json.result.content[0].text.includes("MISS"), false);

    const second = await post(app.base, "/api/desk/nonce", { wallet: owner.wallet });
    const bad = await post(app.base, "/api/desk/verify", {
      wallet: owner.wallet,
      nonce: second.json.nonce,
      signature: signNonce(other.privateKey, second.json.nonce),
    });
    assert.equal(bad.res.status, 401);
    assert.equal(bad.json.error, "rejected");
    assert.equal(bad.res.headers.get("set-cookie"), null);
    const locked = await fetch(`${app.base}/api/desk`);
    assert.equal(locked.status, 401);

    const third = await post(app.base, "/api/desk/nonce", { wallet: owner.wallet });
    const good = await post(app.base, "/api/desk/verify", {
      wallet: owner.wallet,
      nonce: third.json.nonce,
      signature: signNonce(owner.privateKey, third.json.nonce),
    });
    assert.equal(good.json.ok, true);
    const cookie = good.res.headers.get("set-cookie").split(";")[0];
    const authed = await fetch(`${app.base}/api/desk`, { headers: { cookie } });
    const body = await authed.json();
    assert.equal(authed.status, 200);
    assert.deepEqual(body.coins.map((coin) => coin.name), ["Owned Lamp"]);
    assert.equal(body.failed.some((job) => job.ticker === "HIDE"), false);
  } finally {
    await app.close();
  }
});

test("wallet caps sit inside the global cap", async () => {
  const app = await start();
  try {
    const owner = keypair();
    const now = new Date("2026-10-08T12:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      insertCoin(app.db, {
        mint: mint(`Hour${i}`),
        name: "Hour",
        ticker: "HR",
        createdAt: "2026-10-08T11:30:00.000Z",
        wallet: owner.wallet,
        status: "confirmed",
        live: true,
      });
    }
    const hourly = launchCoin(app.db, {
      name: "Sixth",
      ticker: "SIX",
      wallet: owner.wallet,
      idempotency_key: "sixth-hour",
    }, { now });
    assert.equal(hourly.structuredContent.error, "wallet-hourly");
    assert.equal(hourly.content[0].text, "This wallet is at its hourly launch cap.");
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM coins WHERE wallet = ? AND status = 'confirmed'`).get(owner.wallet).n, 5);

    const dailyWallet = keypair();
    for (let i = 0; i < 20; i += 1) {
      insertCoin(app.db, {
        mint: mint(`Day${i}`),
        name: "Day",
        ticker: "DAY",
        createdAt: "2026-10-08T02:00:00.000Z",
        wallet: dailyWallet.wallet,
        status: "confirmed",
        live: true,
      });
    }
    const daily = launchCoin(app.db, {
      name: "Twenty",
      ticker: "TWY",
      wallet: dailyWallet.wallet,
      idempotency_key: "twenty-day",
    }, { now });
    assert.equal(daily.structuredContent.error, "wallet-daily");

    const fresh = keypair();
    for (let i = 0; i < 200; i += 1) {
      insertCoin(app.db, {
        mint: mint(`All${i}`),
        name: "All",
        ticker: "ALL",
        createdAt: "2026-10-08T02:10:00.000Z",
        wallet: "Glob11111111111111111111111111111111111111",
        status: "confirmed",
        live: false,
      });
    }
    assert.equal(launchLimit(app.db, fresh.wallet, now), "daily");
    const full = launchCoin(app.db, {
      name: "Global",
      ticker: "GLOB",
      wallet: fresh.wallet,
      idempotency_key: "global-day",
    }, { now });
    assert.equal(full.content[0].text, "The launch cap is full.");
    assert.equal(full.structuredContent.error, "daily");
  } finally {
    await app.close();
  }
});

test("the local desk preview shows Chamber Lamp and the empty line", async () => {
  const app = await start();
  try {
    seedLocalCoin(app.db);
    const filled = await fetch(`${app.base}/preview/desk`);
    const filledHtml = await filled.text();
    assert.equal(filled.status, 200);
    assert.ok(filledHtml.includes("Chamber Lamp"));
    assert.ok(filledHtml.includes(LOCAL_MINT));
    assert.ok(filledHtml.includes(LOCAL_WALLET));
    assert.ok(filledHtml.includes("0.0123"));
    assert.ok(filledHtml.includes('src="/assets/seed-face.png"'));
    assert.ok(filledHtml.includes("5 an hour"));
    assert.equal(filledHtml.includes("75%"), false);
    assert.ok(filledHtml.includes('id="chamber"'));

    const empty = await fetch(`${app.base}/preview/desk/empty`);
    const emptyHtml = await empty.text();
    assert.ok(emptyHtml.includes(DESK_EMPTY));
    assert.equal(emptyHtml.includes("Chamber Lamp"), false);

    const home = await fetch(`${app.base}/`);
    const homeHtml = await home.text();
    assert.equal(homeHtml.includes("/preview/desk"), false);
    assert.ok(homeHtml.includes('href="/desk"'));
    assert.ok(homeHtml.includes("From the chat"));
  } finally {
    await app.close();
  }
});

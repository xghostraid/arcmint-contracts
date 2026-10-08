import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { insertCoin } from "../server/db.js";
import { createServer } from "../server/index.js";
import { launchCoin } from "../server/launch.js";
import { lowFloatAlert, opsStatus } from "../server/ops.js";
import { PICTURE_MAX_BYTES } from "../server/picture.js";
import { buildQuote } from "../server/quote.js";
import { decodeBase58, encodeBase58, isOnCurve, isOrdinaryWallet, walletFromPublicKey } from "../server/solana.js";
import { STATUS_KEYS, publicStatus } from "../server/status.js";
import { DAILY_CAP, HOURLY_CAP } from "../shared/copy.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function mint(label) {
  return (`${label}Mint` + "1".repeat(40)).slice(0, 44);
}

function keypair() {
  const keys = generateKeyPairSync("ed25519");
  return { ...keys, wallet: walletFromPublicKey(keys.publicKey) };
}

function offCurveAddress() {
  const program = decodeBase58(TOKEN_PROGRAM);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash("sha256").update(Buffer.concat([
      Buffer.from("socket-fee"),
      Buffer.from([bump]),
      program,
      Buffer.from("ProgramDerivedAddress"),
    ])).digest();
    if (!isOnCurve(hash)) return encodeBase58(hash);
  }
  throw new Error("no off-curve address");
}

async function start(env = process.env) {
  const dir = mkdtempSync(path.join(tmpdir(), "socket-"));
  const server = createServer({ dbPath: path.join(dir, "t.sqlite"), env });
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

test("a blocked name cannot impersonate Socket", async () => {
  const app = await start();
  try {
    const owner = keypair();
    const now = new Date("2026-10-08T12:00:00.000Z");
    const blocked = launchCoin(app.db, {
      name: "Socket",
      ticker: "LAMP",
      wallet: owner.wallet,
      idempotency_key: "block-socket-name",
    }, { now });
    assert.equal(blocked.structuredContent.error, "blocked");
    assert.equal(blocked.structuredContent.status, "failed");
    assert.equal(blocked.content[0].text, "That name cannot impersonate Socket.");
    assert.equal(blocked.isError, true);

    const leet = launchCoin(app.db, {
      name: "$S0CKET coin",
      ticker: "LAMP",
      wallet: owner.wallet,
      idempotency_key: "block-socket-leet",
    }, { now });
    assert.equal(leet.structuredContent.error, "blocked");

    const ticker = launchCoin(app.db, {
      name: "Chamber Lamp",
      ticker: "SOCKET",
      wallet: owner.wallet,
      idempotency_key: "block-socket-ticker",
    }, { now });
    assert.equal(ticker.structuredContent.error, "blocked");

    const allowed = buildQuote(app.db, {
      name: "Chamber Lamp",
      ticker: "LAMP",
      wallet: owner.wallet,
    }, now);
    assert.equal(allowed.issues.some((issue) => issue.error === "blocked"), false);
    assert.equal(allowed.name, "Chamber Lamp");
    assert.equal(allowed.houseToken, false);
  } finally {
    await app.close();
  }
});

test("a fee address that is not an ordinary wallet is rejected", async () => {
  const app = await start();
  try {
    const owner = keypair();
    const now = new Date("2026-10-08T12:00:00.000Z");
    assert.equal(isOrdinaryWallet(owner.wallet), true);
    assert.equal(isOrdinaryWallet(TOKEN_PROGRAM), false);
    assert.equal(isOrdinaryWallet(SYSTEM_PROGRAM), false);
    const pda = offCurveAddress();
    assert.equal(isOrdinaryWallet(pda), false);

    for (const [key, wallet] of [
      ["reject-token-program", TOKEN_PROGRAM],
      ["reject-system-program", SYSTEM_PROGRAM],
      ["reject-pda", pda],
      ["reject-garbled", "not-a-wallet"],
    ]) {
      const rejected = launchCoin(app.db, {
        name: "Chamber Lamp",
        ticker: "LAMP",
        wallet,
        idempotency_key: key,
      }, { now });
      assert.equal(rejected.structuredContent.error, "wallet", wallet);
      assert.equal(rejected.content[0].text, "That fee address is not an ordinary wallet.");
      assert.equal(rejected.structuredContent.status, "failed");
    }

    const quoted = buildQuote(app.db, {
      name: "Chamber Lamp",
      ticker: "LAMP",
      wallet: TOKEN_PROGRAM,
    }, now);
    assert.equal(quoted.wallet, null);
    assert.ok(quoted.issues.some((issue) => issue.field === "wallet" && issue.error === "wallet"));

    const ordinary = launchCoin(app.db, {
      name: "Chamber Lamp",
      ticker: "LAMP",
      wallet: owner.wallet,
      idempotency_key: "ordinary-wallet-paused",
    }, { now });
    assert.equal(ordinary.structuredContent.error, "paused");
  } finally {
    await app.close();
  }
});

test("the global cap is 30 an hour and 200 a day", async () => {
  const app = await start();
  try {
    assert.equal(HOURLY_CAP, 30);
    assert.equal(DAILY_CAP, 200);
    const owner = keypair();
    const now = new Date("2026-10-08T12:00:00.000Z");
    for (let i = 0; i < 30; i += 1) {
      insertCoin(app.db, {
        mint: mint(`Glob${i}`),
        name: "Glob",
        ticker: "GLB",
        createdAt: "2026-10-08T11:30:00.000Z",
        wallet: "Glob11111111111111111111111111111111111111",
        status: "confirmed",
        live: false,
      });
    }
    const full = launchCoin(app.db, {
      name: "Past the hour",
      ticker: "FULL",
      wallet: owner.wallet,
      idempotency_key: "global-hour",
    }, { now });
    assert.equal(full.structuredContent.error, "hourly");
    assert.equal(full.content[0].text, "The launch cap is full.");
    assert.equal(full.structuredContent.status, "failed");
    const status = publicStatus(app.db, now);
    assert.equal(status.launchesLeftThisHour, 0);
    assert.equal(status.hourlyCap, 30);
    assert.equal(status.dailyCap, 200);
    assert.equal(Object.hasOwn(status, "canPay"), false);
    assert.equal(Object.hasOwn(status, "alert"), false);
  } finally {
    await app.close();
  }
});

test("ops status and the low-float alert stay behind the cron secret", async () => {
  assert.equal(PICTURE_MAX_BYTES, 4_000_000);
  const low = { SOCKET_LAUNCH_BALANCE_SOL: "0.001" };
  const covered = { SOCKET_LAUNCH_BALANCE_SOL: "1" };
  assert.equal(lowFloatAlert(low).text, "The float cannot cover one launch.");
  assert.equal(lowFloatAlert(covered), null);
  assert.equal(lowFloatAlert({}).text, "The float cannot cover one launch.");
  assert.equal(opsStatus(low).canPay, false);
  assert.equal(opsStatus(covered).canPay, false);
  assert.equal(opsStatus(covered).alert, null);
  assert.equal(JSON.stringify(opsStatus(low)).includes("balanceSol"), false);
  assert.equal(JSON.stringify(opsStatus(low)).includes("SOCKET_LAUNCH"), false);

  const secret = "stub-cron-secret";
  const env = { CRON_SECRET: secret, SOCKET_LAUNCH_BALANCE_SOL: "0.001" };
  const app = await start(env);
  try {
    const closed = await fetch(`${app.base}/api/ops`);
    assert.equal(closed.status, 401);
    const closedBody = await closed.json();
    assert.deepEqual(closedBody, { ok: false, error: "rejected" });

    const wrong = await fetch(`${app.base}/api/ops`, { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);

    const opened = await fetch(`${app.base}/api/ops`, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(opened.status, 200);
    const body = await opened.json();
    assert.equal(body.canPay, false);
    assert.equal(body.alert, "The float cannot cover one launch.");
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(body).includes("balanceSol"), false);

    const status = await fetch(`${app.base}/api/status`);
    const pub = await status.json();
    assert.deepEqual(Object.keys(pub), [...STATUS_KEYS]);
    assert.equal(Object.hasOwn(pub, "canPay"), false);
    assert.equal(Object.hasOwn(pub, "alert"), false);
    assert.equal(JSON.stringify(pub).includes("balanceSol"), false);
    assert.equal(JSON.stringify(pub).includes(secret), false);
  } finally {
    await app.close();
  }
});

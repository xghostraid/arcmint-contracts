import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { insertCoin, insertWaitingFee, listPayouts, LOCAL_MINT, seedLocalCoin, unpushedSol } from "../server/db.js";
import { createServer } from "../server/index.js";
import { PAYOUT_MIN_SOL, watchPayouts } from "../server/payout.js";

const BANNED = [
  "balanceSol",
  "launchesItCanPay",
  "keyMatchesWallet",
  "SOCKET_LAUNCH_KEY",
  "SOCKET_LAUNCH_BALANCE_SOL",
  "treasuryKey",
  "secretKey",
  "privateKey",
];
const SIG = "1".repeat(88);
const OTHER = "Mint11111111111111111111111111111111111111";

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

function coin(db, mint, pendingColumn = 0) {
  insertCoin(db, {
    mint,
    name: "Held",
    ticker: "HELD",
    createdAt: "2026-10-08T12:00:00.000Z",
    paidToCreatorSol: 0.01,
    pendingFeeSol: pendingColumn,
    status: "confirmed",
    live: true,
  });
}

test("the live card reads the unpaid figure from the ledger", async () => {
  const app = await start();
  try {
    assert.equal(seedLocalCoin(app.db), true);
    app.db.prepare(`UPDATE coins SET pending_fee_sol = 9 WHERE mint = ?`).run(LOCAL_MINT);
    assert.equal(unpushedSol(app.db, LOCAL_MINT), 0.0012);
    const card = await fetch(`${app.base}/card/live`);
    const html = await card.text();
    assert.ok(html.includes("0.0012 SOL detected, not yet pushed"));
    assert.ok(html.includes(`${PAYOUT_MIN_SOL}`.replace(/0+$/, "") ) || html.includes("0.003 SOL"));
    assert.equal(html.includes("9 SOL"), false);
    const status = await (await fetch(`${app.base}/api/status`)).json();
    const blob = JSON.stringify(status);
    for (const word of BANNED) assert.equal(blob.includes(word), false, word);
    assert.equal(status.launchesOn, false);
  } finally {
    await app.close();
  }
});

test("the watcher records a payout only when a key and a signature exist", async () => {
  const app = await start();
  try {
    coin(app.db, LOCAL_MINT, 9);
    insertWaitingFee(app.db, { mint: LOCAL_MINT, amountSol: 0.004, at: "2026-10-08T12:06:00.000Z" });
    const calls = [];
    const paused = watchPayouts(app.db, {
      env: {},
      now: new Date("2026-10-08T12:07:00.000Z"),
      submit(job) {
        calls.push(job);
        return SIG;
      },
    });
    assert.equal(paused.paused, true);
    assert.deepEqual(paused.recorded, []);
    assert.deepEqual(calls, []);
    assert.equal(listPayouts(app.db, LOCAL_MINT).length, 0);
    assert.equal(unpushedSol(app.db, LOCAL_MINT), 0.004);
    for (const word of BANNED) assert.equal(JSON.stringify(paused).includes(word), false, word);

    app.db.prepare(`DELETE FROM fee_ledger WHERE mint = ?`).run(LOCAL_MINT);
    insertWaitingFee(app.db, { mint: LOCAL_MINT, amountSol: 0.0029, at: "2026-10-08T12:08:30.000Z" });
    const under = watchPayouts(app.db, {
      env: { SOCKET_LAUNCH_KEY: "present", SOCKET_LAUNCH_BALANCE_SOL: "1" },
      now: new Date("2026-10-08T12:09:00.000Z"),
      submit(job) {
        calls.push(job);
        return SIG;
      },
    });
    assert.equal(under.paused, false);
    assert.deepEqual(under.recorded, []);
    assert.deepEqual(calls, []);

    app.db.prepare(`DELETE FROM fee_ledger WHERE mint = ?`).run(LOCAL_MINT);
    insertWaitingFee(app.db, { mint: LOCAL_MINT, amountSol: PAYOUT_MIN_SOL, at: "2026-10-08T12:10:00.000Z" });
    const held = watchPayouts(app.db, {
      env: { SOCKET_LAUNCH_KEY: "present" },
      now: new Date("2026-10-08T12:11:00.000Z"),
    });
    assert.deepEqual(held.recorded, []);
    assert.equal(listPayouts(app.db, LOCAL_MINT).length, 0);

    const pushed = watchPayouts(app.db, {
      env: { SOCKET_LAUNCH_KEY: "present" },
      now: new Date("2026-10-08T12:12:00.000Z"),
      submit(job) {
        calls.push(job);
        return SIG;
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mint, LOCAL_MINT);
    assert.equal(calls[0].amountSol, PAYOUT_MIN_SOL);
    assert.equal(pushed.recorded.length, 1);
    const rows = listPayouts(app.db, LOCAL_MINT);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["amountSol", "at", "mint", "signature"]);
    assert.equal(rows[0].signature, SIG);
    assert.equal(rows[0].at, "2026-10-08T12:12:00.000Z");
    assert.equal(unpushedSol(app.db, LOCAL_MINT), 0);
    const paid = app.db.prepare(`SELECT paid_to_creator_sol AS n FROM coins WHERE mint = ?`).get(LOCAL_MINT);
    assert.equal(paid.n, 0.013);
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM burns`).get().n, 0);
    assert.equal(JSON.stringify(pushed).includes("present"), false);

    const again = watchPayouts(app.db, {
      env: { SOCKET_LAUNCH_KEY: "present" },
      now: new Date("2026-10-08T12:13:00.000Z"),
      submit() {
        calls.push("again");
        return "2".repeat(88);
      },
    });
    assert.deepEqual(again.recorded, []);
    assert.equal(calls.includes("again"), false);

    coin(app.db, OTHER);
    insertWaitingFee(app.db, { mint: OTHER, amountSol: 0.0012, at: "2026-10-08T12:14:00.000Z" });
    const card = await fetch(`${app.base}/card/live`);
    const html = await card.text();
    assert.equal(html.includes("9 SOL"), false);
  } finally {
    await app.close();
  }
});

test("the payout watcher does not open the network", () => {
  const source = readFileSync(new URL("../server/payout.js", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("SOLANA_RPC"), false);
  assert.equal(/buy|burn/i.test(source), false);
});

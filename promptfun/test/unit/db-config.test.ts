import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { resolvePromptfunDb, sqlitePathForAuxStores } from "../../src/db/resolve.js";

test("resolvePromptfunDb prefers Postgres when POSTGRES_URL is set", () => {
  const cfg = resolvePromptfunDb({
    POSTGRES_URL: "postgres://user:pass@host/db",
    TURSO_DATABASE_URL: "libsql://ignored.turso.io",
    PROMPTFUN_DB: "./local.sqlite",
  });
  assert.equal(cfg.driver, "postgres");
  if (cfg.driver === "postgres") assert.equal(cfg.connectionString, "postgres://user:pass@host/db");
});

test("resolvePromptfunDb uses Turso when only libSQL env is set", () => {
  const cfg = resolvePromptfunDb({
    TURSO_DATABASE_URL: "libsql://promptfun-myorg.turso.io",
    TURSO_AUTH_TOKEN: "tok",
  });
  assert.equal(cfg.driver, "libsql");
  if (cfg.driver === "libsql") {
    assert.equal(cfg.url, "libsql://promptfun-myorg.turso.io");
    assert.equal(cfg.authToken, "tok");
  }
});

test("resolvePromptfunDb falls back to SQLite file path", () => {
  const cfg = resolvePromptfunDb({});
  assert.equal(cfg.driver, "sqlite-file");
  if (cfg.driver === "sqlite-file") {
    assert.ok(cfg.path.endsWith(`${path.sep}data${path.sep}promptfun.sqlite`));
  }
});

test("resolvePromptfunDb honors PROMPTFUN_DB :memory:", () => {
  const cfg = resolvePromptfunDb({ PROMPTFUN_DB: ":memory:" });
  assert.equal(cfg.driver, "sqlite-file");
  if (cfg.driver === "sqlite-file") assert.equal(cfg.path, ":memory:");
});

test("sqlitePathForAuxStores uses shared file when primary is remote", () => {
  const pg = resolvePromptfunDb({ POSTGRES_URL: "postgres://x" });
  const aux = sqlitePathForAuxStores(pg, {});
  assert.ok(aux.endsWith(`${path.sep}data${path.sep}promptfun.sqlite`));
});

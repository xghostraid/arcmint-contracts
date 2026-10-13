import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient, type Client } from "@libsql/client";
import { createPool, type VercelPool } from "@vercel/postgres";
import type { PromptfunDbConfig, PromptfunDbDriver } from "./resolve.js";

export interface DbRow {
  [key: string]: unknown;
}

export interface PreparedStatement {
  run(...params: unknown[]): Promise<void>;
  get(...params: unknown[]): Promise<DbRow | undefined>;
  all(...params: unknown[]): Promise<DbRow[]>;
}

export interface MainDb {
  readonly driver: PromptfunDbDriver;
  exec(sql: string): Promise<void>;
  prepare(sql: string): PreparedStatement;
  close(): Promise<void>;
}

class SqliteFileMainDb implements MainDb {
  readonly driver = "sqlite-file" as const;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run: async (...params: unknown[]) => {
        stmt.run(...(params as Parameters<typeof stmt.run>));
      },
      get: async (...params: unknown[]) => stmt.get(...(params as Parameters<typeof stmt.get>)) as DbRow | undefined,
      all: async (...params: unknown[]) => stmt.all(...(params as Parameters<typeof stmt.all>)) as DbRow[],
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class LibsqlMainDb implements MainDb {
  readonly driver = "libsql" as const;
  private readonly client: Client;

  constructor(url: string, authToken: string | null) {
    this.client = createClient({ url, authToken: authToken ?? undefined });
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  prepare(sql: string): PreparedStatement {
    return {
      run: async (...params: unknown[]) => {
        await this.client.execute({ sql, args: params as (string | number | null)[] });
      },
      get: async (...params: unknown[]) => {
        const rs = await this.client.execute({ sql, args: params as (string | number | null)[] });
        return rs.rows[0] as DbRow | undefined;
      },
      all: async (...params: unknown[]) => {
        const rs = await this.client.execute({ sql, args: params as (string | number | null)[] });
        return rs.rows as DbRow[];
      },
    };
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

class PostgresMainDb implements MainDb {
  readonly driver = "postgres" as const;
  private readonly pool: VercelPool;

  constructor(connectionString: string) {
    this.pool = createPool({ connectionString });
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  prepare(sql: string): PreparedStatement {
    const pool = this.pool;
    let paramIndex = 0;
    const toPg = (s: string) =>
      s.replace(/\?/g, () => {
        paramIndex += 1;
        return `$${paramIndex}`;
      });
    const pgSql = toPg(sql);
    return {
      run: async (...params: unknown[]) => {
        await pool.query(pgSql, params as (string | number | null)[]);
      },
      get: async (...params: unknown[]) => {
        const rs = await pool.query(pgSql, params as (string | number | null)[]);
        return rs.rows[0] as DbRow | undefined;
      },
      all: async (...params: unknown[]) => {
        const rs = await pool.query(pgSql, params as (string | number | null)[]);
        return rs.rows as DbRow[];
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function openMainDb(config: PromptfunDbConfig): Promise<MainDb> {
  switch (config.driver) {
    case "sqlite-file":
      return new SqliteFileMainDb(config.path);
    case "libsql":
      return new LibsqlMainDb(config.url, config.authToken);
    case "postgres":
      return new PostgresMainDb(config.connectionString);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown db driver: ${(_exhaustive as PromptfunDbConfig).driver}`);
    }
  }
}

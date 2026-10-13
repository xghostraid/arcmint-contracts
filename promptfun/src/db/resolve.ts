import path from "node:path";

export type PromptfunDbDriver = "sqlite-file" | "libsql" | "postgres";

export interface SqliteFileDbConfig {
  driver: "sqlite-file";
  path: string;
}

export interface LibsqlDbConfig {
  driver: "libsql";
  url: string;
  authToken: string | null;
}

export interface PostgresDbConfig {
  driver: "postgres";
  connectionString: string;
}

export type PromptfunDbConfig = SqliteFileDbConfig | LibsqlDbConfig | PostgresDbConfig;

function trim(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function isLibsqlUrl(url: string): boolean {
  return (
    url.startsWith("libsql:") ||
    url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("wss://") ||
    url.startsWith("ws://")
  );
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

/**
 * Resolves durable storage for intents + coin index.
 * Priority: Postgres (Vercel) → Turso/libSQL → local SQLite file path.
 */
export function resolvePromptfunDb(env: NodeJS.ProcessEnv = process.env): PromptfunDbConfig {
  const postgres =
    trim(env.POSTGRES_URL) ||
    trim(env.POSTGRES_POSTGRES_URL) ||
    trim(env.PROMPTFUN_POSTGRES_URL) ||
    trim(env.DATABASE_URL);
  if (postgres && isPostgresUrl(postgres)) {
    return { driver: "postgres", connectionString: postgres };
  }

  const libsqlUrl = trim(env.TURSO_DATABASE_URL) || trim(env.LIBSQL_URL);
  if (libsqlUrl) {
    return {
      driver: "libsql",
      url: libsqlUrl,
      authToken: trim(env.TURSO_AUTH_TOKEN) || trim(env.LIBSQL_AUTH_TOKEN),
    };
  }

  const promptfunDb = trim(env.PROMPTFUN_DB);
  if (promptfunDb) {
    if (promptfunDb === ":memory:") {
      return { driver: "sqlite-file", path: ":memory:" };
    }
    if (isLibsqlUrl(promptfunDb)) {
      return {
        driver: "libsql",
        url: promptfunDb,
        authToken: trim(env.TURSO_AUTH_TOKEN) || trim(env.LIBSQL_AUTH_TOKEN),
      };
    }
    if (isPostgresUrl(promptfunDb)) {
      return { driver: "postgres", connectionString: promptfunDb };
    }
    return {
      driver: "sqlite-file",
      path: path.isAbsolute(promptfunDb) ? promptfunDb : path.resolve(process.cwd(), promptfunDb),
    };
  }

  return {
    driver: "sqlite-file",
    path: path.resolve(process.cwd(), "data/promptfun.sqlite"),
  };
}

/** Legacy path for picture/platform SQLite (file mode only). */
export function sqlitePathForAuxStores(config: PromptfunDbConfig, env: NodeJS.ProcessEnv): string {
  if (config.driver === "sqlite-file") return config.path;
  const override = trim(env.PROMPTFUN_DB);
  if (override && override !== ":memory:" && !isLibsqlUrl(override) && !isPostgresUrl(override)) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.resolve(process.cwd(), "data/promptfun.sqlite");
}

import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import type { AiProvider } from "../src/ai/provider.js";
import { TEST_DB_URL } from "./global-setup.js";

export const PASSWORD = "Test-Password-123";
export const ORIGIN = "http://localhost:3000";

export interface TestEnv {
  app: FastifyInstance;
  db: ReturnType<typeof createDb>["db"];
  sql: ReturnType<typeof createDb>["sql"];
  ids: Record<string, string>;
  close(): Promise<void>;
}

export async function startTestEnv(opts: { ai?: AiProvider; env?: Record<string, string> } = {}): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    RATE_LIMIT_MAX: "100000",
    LOGIN_RATE_LIMIT_MAX: "100000",
    WEB_ORIGINS: ORIGIN,
    ...opts.env,
  } as NodeJS.ProcessEnv);
  const { db, sql } = createDb(TEST_DB_URL, { max: 5 });
  const ids = await seed(db, PASSWORD);
  const app = await buildApp({ config, db, sql, ai: opts.ai });
  await app.ready();
  return {
    app,
    db,
    sql,
    ids,
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

/** Log in and return a client that sends the session cookie and a valid Origin on every call. */
type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;
export interface TestClient {
  call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers?: Record<string, string>): Promise<Res>;
  cookie: string;
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<TestClient> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password }, headers: { origin: ORIGIN } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const setCookie = res.cookies.find((c) => c.name === "tmp_session");
  if (!setCookie) throw new Error("no session cookie");
  const cookie = `${setCookie.name}=${setCookie.value}`;
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      payload: payload as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });
  return { call, cookie };
}

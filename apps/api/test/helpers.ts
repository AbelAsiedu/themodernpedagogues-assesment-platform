import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { memberships, users } from "../src/db/schema.js";
import { createSession } from "../src/session.js";
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

export async function startTestEnv(opts: { ai?: AiProvider; redis?: Redis; env?: Record<string, string> } = {}): Promise<TestEnv> {
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
  const app = await buildApp({ config, db, sql, ai: opts.ai, redis: opts.redis });
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

/** A client for an existing user, authenticated by minting a session directly (no password hashing), for bulk tests. */
export async function clientFor(env: TestEnv, userId: string): Promise<TestClient> {
  const { token } = await createSession(env.db, userId, 12, {});
  const cookie = `tmp_session=${token}`;
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    env.app.inject({ method, url: `/api/v1${url}`, payload: payload as object | undefined, headers: { cookie, origin: ORIGIN, ...headers } });
  return { call, cookie };
}

/** Create n active students in a school. */
export async function makeStudents(env: TestEnv, institutionId: string, n: number) {
  const tag = randomUUID().slice(0, 8);
  const rows = await env.db
    .insert(users)
    .values(Array.from({ length: n }, (_, i) => ({ email: `bulk.${tag}.${i}@tmp.test`, fullName: `Bulk Student${i} Tester`, passwordHash: "not-a-real-hash" })))
    .returning();
  await env.db.insert(memberships).values(rows.map((u) => ({ userId: u.id, institutionId, role: "student" })));
  return Promise.all(rows.map(async (u) => ({ id: u.id, client: await clientFor(env, u.id) })));
}

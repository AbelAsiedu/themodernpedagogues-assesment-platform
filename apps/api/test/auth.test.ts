import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema.js";
import { hashPassword } from "../src/security/password.js";
import { ORIGIN, PASSWORD, login, startTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => env.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  env.app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers });

describe("authentication", () => {
  it("logs in with correct credentials and sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const res = await post("/auth/login", { email: "teacher.alpha@tmp.test", password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === "tmp_session")!;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe("lax");
    expect(res.body).not.toContain("passwordHash");
  });

  it("returns identical responses for an unknown email and a wrong password", async () => {
    const wrongPw = await post("/auth/login", { email: "teacher.alpha@tmp.test", password: "nope-nope-nope" });
    const unknown = await post("/auth/login", { email: "ghost@tmp.test", password: "nope-nope-nope" });
    expect(wrongPw.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrongPw.json());
  });

  it("rejects malformed input with 400 and field details", async () => {
    const res = await post("/auth/login", { email: "not-an-email" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.length).toBeGreaterThan(0);
  });

  it("locks an account after repeated failures, even with the right password afterwards", async () => {
    const email = "lockout@tmp.test";
    await env.db.insert(users).values({ email, fullName: "Lock Out", passwordHash: await hashPassword(PASSWORD) });
    for (let i = 0; i < 5; i++) {
      expect((await post("/auth/login", { email, password: "wrong-wrong-1" })).statusCode).toBe(401);
    }
    const blocked = await post("/auth/login", { email, password: PASSWORD });
    expect(blocked.statusCode).toBe(429);
  });

  it("refuses login for suspended accounts", async () => {
    const email = "suspended@tmp.test";
    await env.db.insert(users).values({ email, fullName: "Sus", passwordHash: await hashPassword(PASSWORD), status: "suspended" });
    expect((await post("/auth/login", { email, password: PASSWORD })).statusCode).toBe(403);
  });

  it("requires a session for /auth/me and returns no secrets when signed in", async () => {
    expect((await env.app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);
    const { call } = await login(env.app, "super@tmp.test");
    const me = await call("GET", "/auth/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().platformRole).toBe("super_admin");
    expect(me.body).not.toMatch(/password/i);
  });

  it("logout revokes the session server-side (the old cookie stops working)", async () => {
    const { call, cookie } = await login(env.app, "student.alpha@tmp.test");
    expect((await call("GET", "/auth/me")).statusCode).toBe(200);
    expect((await call("POST", "/auth/logout")).statusCode).toBe(200);
    const replay = await env.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(replay.statusCode).toBe(401);
  });

  it("suspending a user kills their live session immediately", async () => {
    const email = "victim@tmp.test";
    await env.db.insert(users).values({ email, fullName: "Victim", passwordHash: await hashPassword(PASSWORD) });
    const victim = await login(env.app, email);
    expect((await victim.call("GET", "/auth/me")).statusCode).toBe(200);

    const admin = await login(env.app, "super@tmp.test");
    const [row] = await env.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect((await admin.call("PATCH", `/users/${row!.id}/status`, { status: "suspended" })).statusCode).toBe(200);

    expect((await victim.call("GET", "/auth/me")).statusCode).toBe(401);
  });

  it("rejects cookie-authenticated mutations from a foreign Origin (CSRF)", async () => {
    const { call } = await login(env.app, "super@tmp.test");
    const res = await call("POST", "/institutions", { name: "Evil Inc", slug: "evil-inc" }, { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
  });

  it("rejects cookie-authenticated mutations with no Origin and no client header", async () => {
    const { cookie } = await login(env.app, "super@tmp.test");
    const res = await env.app.inject({
      method: "POST",
      url: "/api/v1/institutions",
      payload: { name: "No Origin", slug: "no-origin" },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

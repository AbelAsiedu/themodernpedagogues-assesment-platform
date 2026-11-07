import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestEnv, login, PASSWORD, type TestEnv } from "./helpers.js";
import { hashPassword } from "../src/security/password.js";
import { users } from "../src/db/schema.js";

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => env.close());

describe("platform privileges", () => {
  it("non-platform users cannot reach platform endpoints", async () => {
    for (const email of ["student.alpha@tmp.test", "teacher.alpha@tmp.test", "admin.alpha@tmp.test"]) {
      const c = await login(env.app, email);
      for (const url of ["/users", "/audit", "/admin/overview"]) {
        expect((await c.call("GET", url)).statusCode, `${email} ${url}`).toBe(403);
      }
    }
  });

  it("unauthenticated requests get 401 everywhere that needs a user", async () => {
    for (const url of ["/users", "/audit", "/admin/overview", "/institutions", `/classes/${env.ids.alphaClassId}`]) {
      expect((await env.app.inject({ method: "GET", url: `/api/v1${url}` })).statusCode, url).toBe(401);
    }
  });

  it("platform_admin can read users but cannot create, suspend or change roles by default", async () => {
    const pa = await login(env.app, "platform@tmp.test");
    expect((await pa.call("GET", "/users")).statusCode).toBe(200);
    expect((await pa.call("POST", "/users", { email: "n@tmp.test", fullName: "New One", password: "Password-12345" })).statusCode).toBe(403);
    expect((await pa.call("PATCH", `/users/${env.ids.alphaStudentId}/status`, { status: "suspended" })).statusCode).toBe(403);
    expect((await pa.call("PATCH", `/users/${env.ids.alphaStudentId}/platform-role`, { platformRole: "super_admin" })).statusCode).toBe(403);
  });

  it("platform_admin cannot escalate itself or others to super_admin", async () => {
    const pa = await login(env.app, "platform@tmp.test");
    const [me] = await env.sql<{ id: string }[]>`select id from users where email = 'platform@tmp.test'`;
    expect((await pa.call("PATCH", `/users/${me!.id}/platform-role`, { platformRole: "super_admin" })).statusCode).toBe(403);
    expect((await pa.call("POST", `/users/${me!.id}/permissions`, { permission: "users.assign_roles" })).statusCode).toBe(403);
  });

  it("super admin can delegate a permission, and it takes effect on the next request", async () => {
    const sup = await login(env.app, "super@tmp.test");
    const [target] = await env.db
      .insert(users)
      .values({ email: "delegate@tmp.test", fullName: "Del Egate", passwordHash: await hashPassword(PASSWORD), platformRole: "platform_admin" })
      .returning();
    const del = await login(env.app, "delegate@tmp.test");
    expect((await del.call("POST", "/users", { email: "created.by.delegate@tmp.test", fullName: "Made Here", password: "Password-12345" })).statusCode).toBe(403);

    expect((await sup.call("POST", `/users/${target!.id}/permissions`, { permission: "users.create" })).statusCode).toBe(201);
    expect((await del.call("POST", "/users", { email: "created.by.delegate@tmp.test", fullName: "Made Here", password: "Password-12345" })).statusCode).toBe(201);

    expect((await sup.call("DELETE", `/users/${target!.id}/permissions/users.create`)).statusCode).toBe(200);
    expect((await del.call("POST", "/users", { email: "another@tmp.test", fullName: "Another One", password: "Password-12345" })).statusCode).toBe(403);
  });

  it("super-admin-only permissions can never be delegated, even by a super admin", async () => {
    const sup = await login(env.app, "super@tmp.test");
    const [target] = await env.sql<{ id: string }[]>`select id from users where email = 'platform@tmp.test'`;
    expect((await sup.call("POST", `/users/${target!.id}/permissions`, { permission: "settings.update" })).statusCode).toBe(403);
    expect((await sup.call("POST", `/users/${target!.id}/permissions`, { permission: "made.up" })).statusCode).toBe(400);
  });

  it("a delegated suspender still cannot touch a super admin", async () => {
    const sup = await login(env.app, "super@tmp.test");
    const [d] = await env.db
      .insert(users)
      .values({ email: "suspender@tmp.test", fullName: "Sus Pender", passwordHash: await hashPassword(PASSWORD), platformRole: "platform_admin" })
      .returning();
    await sup.call("POST", `/users/${d!.id}/permissions`, { permission: "users.suspend" });
    const del = await login(env.app, "suspender@tmp.test");
    expect((await del.call("PATCH", `/users/${env.ids.superAdmin}/status`, { status: "suspended" })).statusCode).toBe(403);
    expect((await del.call("PATCH", `/users/${env.ids.alphaStudentId}/status`, { status: "suspended" })).statusCode).toBe(200);
    await sup.call("PATCH", `/users/${env.ids.alphaStudentId}/status`, { status: "active" }); // restore for other files
  });

  it("nobody can change their own status or role", async () => {
    const sup = await login(env.app, "super@tmp.test");
    expect((await sup.call("PATCH", `/users/${env.ids.superAdmin}/status`, { status: "suspended" })).statusCode).toBe(400);
    expect((await sup.call("PATCH", `/users/${env.ids.superAdmin}/platform-role`, { platformRole: null })).statusCode).toBe(400);
  });

  it("the admin overview reports real counts, not fabricated ones", async () => {
    const sup = await login(env.app, "super@tmp.test");
    const res = await sup.call("GET", "/admin/overview");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = await env.sql<{ n: number }[]>`select count(*)::int as n from users`;
    expect(body.users.total).toBe(rows[0]!.n);
    expect(body.institutions.total).toBeGreaterThanOrEqual(2);
    expect(body).not.toHaveProperty("examinations"); // modules that don't exist yet are not faked
  });
});

describe("audit trail", () => {
  it("records successful and failed logins, role changes and denied access", async () => {
    await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "super@tmp.test", password: "wrong-password-1" }, headers: { origin: "http://localhost:3000" } });
    const stu = await login(env.app, "student.alpha@tmp.test");
    await stu.call("GET", "/users"); // denied
    await new Promise((r) => setTimeout(r, 150)); // denial audit is fire-and-forget

    const sup = await login(env.app, "super@tmp.test");
    const res = await sup.call("GET", "/audit?limit=200");
    expect(res.statusCode).toBe(200);
    const actions = new Set(res.json().entries.map((e: { action: string }) => e.action));
    for (const a of ["auth.login", "auth.login_failed", "authz.denied", "user.permission_grant"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });

  it("never stores passwords or hashes in audit metadata", async () => {
    const rows = await env.sql<{ metadata: unknown }[]>`select metadata from audit_logs`;
    const all = JSON.stringify(rows);
    expect(all).not.toContain("$argon2");
    expect(all).not.toContain(PASSWORD);
  });

  it("audit records are immutable at the database level (UPDATE, DELETE, TRUNCATE all blocked)", async () => {
    await expect(env.sql`update audit_logs set action = 'tampered'`).rejects.toThrow(/append-only/);
    await expect(env.sql`delete from audit_logs`).rejects.toThrow(/append-only/);
    await expect(env.sql`truncate audit_logs`).rejects.toThrow(/append-only/);
    const rows = await env.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`;
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

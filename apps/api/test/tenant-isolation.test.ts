import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestEnv, login, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => env.close());

/** Alpha and Beta are two separate schools. Nothing in Beta may be reachable from Alpha, ever. */
describe("tenant isolation", () => {
  it("an institution admin can read their own institution's members", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const res = await alpha.call("GET", `/institutions/${env.ids.alphaId}/members`);
    expect(res.statusCode).toBe(200);
    expect(res.json().members.length).toBeGreaterThanOrEqual(3);
  });

  it("…but not another institution's members, overview, classes or record", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const B = env.ids.betaId!;
    for (const url of [`/institutions/${B}`, `/institutions/${B}/members`, `/institutions/${B}/overview`, `/institutions/${B}/classes`]) {
      expect((await alpha.call("GET", url)).statusCode, url).toBe(403);
    }
  });

  it("cannot read another institution's class by id", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    expect((await alpha.call("GET", `/classes/${env.ids.betaClassId}`)).statusCode).toBe(403);
    expect((await alpha.call("GET", `/classes/${env.ids.betaClassId}/members`)).statusCode).toBe(403);
  });

  it("a missing class and another tenant's class are indistinguishable to a non-platform user", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const missing = await alpha.call("GET", "/classes/00000000-0000-0000-0000-000000000000");
    const foreign = await alpha.call("GET", `/classes/${env.ids.betaClassId}`);
    expect(missing.statusCode).toBe(foreign.statusCode);
    expect(missing.json()).toEqual(foreign.json());
  });

  it("cannot create classes, users or members in another institution", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const B = env.ids.betaId!;
    expect((await alpha.call("POST", `/institutions/${B}/classes`, { name: "Sneaky", level: "JHS 1", academicYear: "2026" })).statusCode).toBe(403);
    expect(
      (await alpha.call("POST", `/institutions/${B}/users`, { email: "x@tmp.test", fullName: "X Y", password: "Password-12345", role: "student" })).statusCode,
    ).toBe(403);
  });

  it("cannot touch another tenant's membership by mixing ids (own institution id + foreign membership id)", async () => {
    const [m] = await env.sql<{ id: string }[]>`select id from memberships where institution_id = ${env.ids.betaId!} and role = 'student' limit 1`;
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const res = await alpha.call("PATCH", `/institutions/${env.ids.alphaId}/members/${m!.id}/status`, { status: "suspended" });
    expect(res.statusCode).toBe(404);
    const [after] = await env.sql<{ status: string }[]>`select status from memberships where id = ${m!.id}`;
    expect(after!.status).toBe("active"); // unchanged
  });

  it("cannot add a user from another institution to a local class", async () => {
    const alpha = await login(env.app, "teacher.alpha@tmp.test");
    const res = await alpha.call("POST", `/classes/${env.ids.alphaClassId}/members`, { userId: env.ids.betaStudentId, role: "student" });
    expect(res.statusCode).toBe(400);
    const rows = await env.sql`select 1 from class_members where class_id = ${env.ids.alphaClassId!} and user_id = ${env.ids.betaStudentId!}`;
    expect(rows.length).toBe(0);
  });

  it("a student sees only their own classes and cannot list class members", async () => {
    const student = await login(env.app, "student.alpha@tmp.test");
    const list = await student.call("GET", `/institutions/${env.ids.alphaId}/classes`);
    expect(list.statusCode).toBe(200);
    expect(list.json().classes.every((c: { institutionId: string }) => c.institutionId === env.ids.alphaId)).toBe(true);
    expect((await student.call("GET", `/classes/${env.ids.alphaClassId}/members`)).statusCode).toBe(403);
    expect((await student.call("GET", `/institutions/${env.ids.alphaId}/members`)).statusCode).toBe(403);
  });

  it("a student in the same institution but NOT in a class cannot open it", async () => {
    const admin = await login(env.app, "admin.alpha@tmp.test");
    const created = await admin.call("POST", `/institutions/${env.ids.alphaId}/classes`, { name: "Private 3B", level: "JHS 3", academicYear: "2026/2027" });
    expect(created.statusCode).toBe(201);
    const student = await login(env.app, "student.alpha@tmp.test");
    expect((await student.call("GET", `/classes/${created.json().class.id}`)).statusCode).toBe(403);
  });

  it("only platform staff can create institution administrators; a school admin cannot mint another", async () => {
    const alpha = await login(env.app, "admin.alpha@tmp.test");
    const res = await alpha.call("POST", `/institutions/${env.ids.alphaId}/users`, {
      email: "newadmin@tmp.test",
      fullName: "New Admin",
      password: "Password-12345",
      role: "institution_admin",
    });
    expect(res.statusCode).toBe(403);
  });

  it("the institutions list only returns the caller's own institutions", async () => {
    const alpha = await login(env.app, "teacher.alpha@tmp.test");
    const res = await alpha.call("GET", "/institutions");
    const ids = res.json().institutions.map((i: { id: string }) => i.id);
    expect(ids).toEqual([env.ids.alphaId]);
  });

  it("a suspended institution immediately loses access for its members", async () => {
    const sup = await login(env.app, "super@tmp.test");
    const created = await sup.call("POST", "/institutions", { name: "Gamma JHS", slug: "gamma-jhs" });
    const gid = created.json().institution.id as string;
    expect((await sup.call("PATCH", `/institutions/${gid}/status`, { status: "active" })).statusCode).toBe(200);
    expect(
      (await sup.call("POST", `/institutions/${gid}/users`, { email: "t.gamma@tmp.test", fullName: "Gamma Teacher", password: "Password-12345", role: "teacher" })).statusCode,
    ).toBe(201);

    const teacher = await login(env.app, "t.gamma@tmp.test", "Password-12345");
    expect((await teacher.call("GET", `/institutions/${gid}/classes`)).statusCode).toBe(200);
    expect((await sup.call("PATCH", `/institutions/${gid}/status`, { status: "suspended" })).statusCode).toBe(200);
    expect((await teacher.call("GET", `/institutions/${gid}/classes`)).statusCode).toBe(403);
  });
});

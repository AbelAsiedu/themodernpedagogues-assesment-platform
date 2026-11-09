import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, questions } from "../src/db/schema.js";
import { login, startTestEnv, type TestClient, type TestEnv } from "./helpers.js";

let env: TestEnv;
let teacherA: TestClient, teacherB: TestClient, studentA: TestClient, adminA: TestClient, superAdmin: TestClient, academic: TestClient;
let alpha: string, beta: string, alphaSubject: string, betaSubject: string;

const mcq = (subjectId: string, over: Record<string, unknown> = {}) => ({
  type: "mcq", subjectId, stem: "Which of these is a symbol of national identity in Ghana?",
  difficulty: "easy", marks: 1,
  content: { options: [{ id: "A", text: "Flag of Ghana" }, { id: "B", text: "A football" }, { id: "C", text: "A bus ticket" }, { id: "D", text: "A school bag" }], correctOptionId: "A" },
  ...over,
});

beforeAll(async () => {
  env = await startTestEnv();
  alpha = env.ids.alphaId!; beta = env.ids.betaId!;
  alphaSubject = env.ids.alphaSubjectId!; betaSubject = env.ids.betaSubjectId!;
  teacherA = await login(env.app, "teacher.alpha@tmp.test");
  teacherB = await login(env.app, "teacher.beta@tmp.test");
  studentA = await login(env.app, "student.alpha@tmp.test");
  adminA = await login(env.app, "admin.alpha@tmp.test");
  superAdmin = await login(env.app, "super@tmp.test");
  academic = await login(env.app, "academic@tmp.test");
});
afterAll(async () => env.close());

describe("subjects and topics", () => {
  it("lets a teacher create subjects and topics in their own school", async () => {
    const s = await teacherA.call("POST", `/institutions/${alpha}/subjects`, { name: "Integrated Science", level: "JHS 3" });
    expect(s.statusCode).toBe(201);
    const t = await teacherA.call("POST", `/subjects/${s.json().subject.id}/topics`, { name: "Matter" });
    expect(t.statusCode).toBe(201);
    const dup = await teacherA.call("POST", `/institutions/${alpha}/subjects`, { name: "integrated science", level: "JHS 3" });
    expect(dup.statusCode).toBe(409);
  });
  it("blocks students and other schools' staff", async () => {
    expect((await studentA.call("POST", `/institutions/${alpha}/subjects`, { name: "X", level: "JHS 3" })).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/institutions/${alpha}/subjects`, { name: "X", level: "JHS 3" })).statusCode).toBe(403);
    expect((await teacherB.call("GET", `/institutions/${alpha}/subjects`)).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/subjects/${alphaSubject}/topics`, { name: "Sneaky" })).statusCode).toBe(403);
  });
  it("lists subjects with their topics", async () => {
    const r = await teacherA.call("GET", `/institutions/${alpha}/subjects`);
    const ss = r.json().subjects.find((s: { name: string }) => s.name === "Social Studies");
    expect(ss.topics.map((t: { name: string }) => t.name)).toContain("Peace building");
  });
});

describe("creating and validating questions", () => {
  it("creates a draft with version 1", async () => {
    const r = await teacherA.call("POST", `/institutions/${alpha}/questions`, mcq(alphaSubject));
    expect(r.statusCode).toBe(201);
    expect(r.json().question).toMatchObject({ status: "draft", source: "manual", version: 1 });
    const got = await teacherA.call("GET", `/questions/${r.json().question.id}`);
    expect(got.json().versions).toHaveLength(1);
  });
  it.each([
    ["duplicate option text", { options: [{ id: "A", text: "Same" }, { id: "B", text: "same" }], correctOptionId: "A" }],
    ["correct answer not among options", { options: [{ id: "A", text: "One" }, { id: "B", text: "Two" }], correctOptionId: "D" }],
    ["only one option", { options: [{ id: "A", text: "One" }], correctOptionId: "A" }],
  ])("rejects an MCQ with %s", async (_n, content) => {
    const r = await teacherA.call("POST", `/institutions/${alpha}/questions`, mcq(alphaSubject, { content }));
    expect(r.statusCode).toBe(400);
  });
  it("requires essay marks to equal the rubric total", async () => {
    const body = { type: "essay", subjectId: alphaSubject, stem: "Explain two causes of conflict.", marks: 5, content: { rubric: [{ point: "Cause one", marks: 2 }, { point: "Cause two", marks: 2 }] } };
    expect((await teacherA.call("POST", `/institutions/${alpha}/questions`, body)).statusCode).toBe(400);
    expect((await teacherA.call("POST", `/institutions/${alpha}/questions`, { ...body, marks: 4 })).statusCode).toBe(201);
  });
  it("supports true/false and short answer", async () => {
    expect((await teacherA.call("POST", `/institutions/${alpha}/questions`, { type: "true_false", subjectId: alphaSubject, stem: "Ghana gained independence in 1957.", content: { correct: true } })).statusCode).toBe(201);
    expect((await teacherA.call("POST", `/institutions/${alpha}/questions`, { type: "short_answer", subjectId: alphaSubject, stem: "Name the capital city of Ghana.", content: { acceptedAnswers: ["Accra"] } })).statusCode).toBe(201);
  });
  it("won't attach another school's subject or a topic from a different subject", async () => {
    expect((await teacherB.call("POST", `/institutions/${beta}/questions`, mcq(alphaSubject))).statusCode).toBe(400);
    const topic = (await teacherA.call("GET", `/institutions/${alpha}/subjects`)).json().subjects.flatMap((s: { topics: { id: string }[] }) => s.topics)[0];
    const other = (await teacherA.call("POST", `/institutions/${alpha}/subjects`, { name: "Other", level: "JHS 1" })).json().subject.id;
    expect((await teacherA.call("POST", `/institutions/${alpha}/questions`, mcq(other, { topicId: topic.id }))).statusCode).toBe(400);
  });
});

describe("tenant isolation and access", () => {
  let qid: string;
  beforeAll(async () => { qid = (await teacherA.call("POST", `/institutions/${alpha}/questions`, mcq(alphaSubject, { stem: "Isolation probe question one?" }))).json().question.id; });

  it("students cannot read or list the bank", async () => {
    expect((await studentA.call("GET", `/institutions/${alpha}/questions`)).statusCode).toBe(403);
    expect((await studentA.call("GET", `/questions/${qid}`)).statusCode).toBe(403);
  });
  it("another school's teacher can neither list, read, edit, review nor archive", async () => {
    expect((await teacherB.call("GET", `/institutions/${alpha}/questions`)).statusCode).toBe(403);
    expect((await teacherB.call("GET", `/questions/${qid}`)).statusCode).toBe(403);
    expect((await teacherB.call("PATCH", `/questions/${qid}`, { stem: "hijacked" })).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/questions/${qid}/review`, { decision: "approve" })).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/questions/${qid}/archive`)).statusCode).toBe(403);
    expect((await env.db.select().from(questions).where(eq(questions.id, qid)))[0]!.stem).not.toBe("hijacked");
  });
  it("a missing id looks the same as a foreign one to a school user, but is a 404 for platform staff", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await teacherB.call("GET", `/questions/${ghost}`)).statusCode).toBe(403);
    expect((await superAdmin.call("GET", `/questions/${ghost}`)).statusCode).toBe(404);
  });
  it("the bank list only returns the school's own questions", async () => {
    await teacherB.call("POST", `/institutions/${beta}/questions`, mcq(betaSubject, { stem: "Beta-only question text?" }));
    const r = (await teacherA.call("GET", `/institutions/${alpha}/questions?limit=100`)).json();
    expect(r.questions.every((q: { institutionId: string }) => q.institutionId === alpha)).toBe(true);
    expect(r.questions.some((q: { stem: string }) => q.stem.includes("Beta-only"))).toBe(false);
  });
  it("platform staff with read access can view but not write", async () => {
    expect((await superAdmin.call("GET", `/institutions/${alpha}/questions`)).statusCode).toBe(200);
    expect((await academic.call("GET", `/institutions/${alpha}/questions`)).statusCode).toBe(200);
    expect((await academic.call("POST", `/institutions/${alpha}/questions`, mcq(alphaSubject))).statusCode).toBe(403);
  });
  it("filters and paginates", async () => {
    const r = (await teacherA.call("GET", `/institutions/${alpha}/questions?type=true_false&limit=1`)).json();
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].type).toBe("true_false");
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect((await teacherA.call("GET", `/institutions/${alpha}/questions?status=bogus`)).statusCode).toBe(400);
  });
});

describe("review lifecycle", () => {
  let qid: string;
  beforeAll(async () => { qid = (await adminA.call("POST", `/institutions/${alpha}/questions`, mcq(alphaSubject, { stem: "Lifecycle question: which is the national flag colour at the top?" }))).json().question.id; });

  it("cannot approve a draft that hasn't been submitted", async () => {
    expect((await teacherA.call("POST", `/questions/${qid}/review`, { decision: "approve" })).statusCode).toBe(409);
  });
  it("submit -> approve records the reviewer and writes an audit entry", async () => {
    expect((await teacherA.call("POST", `/questions/${qid}/submit-for-review`)).json().question.status).toBe("needs_review");
    const r = await teacherA.call("POST", `/questions/${qid}/review`, { decision: "approve", note: "Looks right" });
    expect(r.json().question).toMatchObject({ status: "approved", reviewNote: "Looks right" });
    expect(r.json().question.reviewedBy).toBeTruthy();
    const logs = await env.db.select().from(auditLogs).where(eq(auditLogs.targetId, qid));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["question.create", "question.submit_review", "question.approve"]));
  });
  it("editing an approved question sends it back for review and keeps history", async () => {
    const r = await teacherA.call("PATCH", `/questions/${qid}`, { stem: "Lifecycle question (reworded): which colour is at the top of the flag?" });
    expect(r.json().question).toMatchObject({ status: "needs_review", version: 2, reviewedBy: null });
    const got = (await teacherA.call("GET", `/questions/${qid}`)).json();
    expect(got.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });
  it("validates edited content against the question's own type", async () => {
    expect((await teacherA.call("PATCH", `/questions/${qid}`, { content: { correct: true } })).statusCode).toBe(400);
    expect((await teacherA.call("PATCH", `/questions/${qid}`, {})).statusCode).toBe(400);
  });
  it("can reject, and archived questions can't be edited", async () => {
    expect((await teacherA.call("POST", `/questions/${qid}/review`, { decision: "reject", note: "Ambiguous" })).json().question.status).toBe("rejected");
    expect((await teacherA.call("POST", `/questions/${qid}/archive`)).json().question.status).toBe("archived");
    expect((await teacherA.call("PATCH", `/questions/${qid}`, { stem: "nope nope nope" })).statusCode).toBe(409);
  });
  it("the database refuses an AI question marked approved without a human reviewer", async () => {
    await expect(
      env.db.insert(questions).values({
        institutionId: alpha, subjectId: alphaSubject, type: "true_false", stem: "DB guard", content: { correct: true },
        status: "approved", source: "ai", reviewedBy: null,
      }),
    ).rejects.toThrow();
  });
});

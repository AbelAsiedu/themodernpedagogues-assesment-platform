import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { auditLogs, classMembers, classes, examMarks, examResponseVersions, examResponses, examSessions, examSittings, examSubmissions, exams } from "../src/db/schema.js";
import { SAVE_GRACE_MS } from "../src/exam/engine.js";
import { clientFor, login, makeStudents, startTestEnv, type TestClient, type TestEnv } from "./helpers.js";

let env: TestEnv;
let teacherA: TestClient, teacherB: TestClient, studentA: TestClient, studentB: TestClient, superAdmin: TestClient;
let alpha: string, beta: string, alphaSubject: string, alphaClassId: string, betaSubject: string;
const tag = Math.random().toString(36).slice(2, 7);

// Item positions in the exam built below.
const MCQ1 = 0, MCQ2 = 1, TF = 2, SA1 = 3, SA2 = 4, SA3 = 5, ESSAY = 6;
let qIds: Record<string, string> = {};
let examId: string;

const mins = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const win = (openOffset = -10, closeOffset = 180) => ({ opensAt: mins(openOffset), closesAt: mins(closeOffset) });

async function approved(client: TestClient, inst: string, subject: string, body: Record<string, unknown>) {
  const c = await client.call("POST", `/institutions/${inst}/questions`, { subjectId: subject, ...body });
  expect(c.statusCode, JSON.stringify(c.json())).toBe(201);
  const id = c.json().question.id as string;
  await client.call("POST", `/questions/${id}/submit-for-review`);
  expect((await client.call("POST", `/questions/${id}/review`, { decision: "approve" })).statusCode).toBe(200);
  return id;
}

const sections = (ids = qIds) => [
  { title: "Section A", rule: { type: "answer_all" }, questionIds: [ids.mcq1, ids.mcq2, ids.tf] },
  { title: "Section B", rule: { type: "answer_any", count: 2 }, questionIds: [ids.sa1, ids.sa2, ids.sa3] },
  { title: "Section C", rule: { type: "answer_all" }, questionIds: [ids.essay] },
];

async function newSitting(over: Record<string, unknown> = {}, exam = examId) {
  const r = await teacherA.call("POST", `/exams/${exam}/sittings`, { ...win(), ...over });
  expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
  return r.json().sitting as { id: string; opensAt: string; closesAt: string };
}
async function startFor(c: TestClient, sittingId: string) {
  const r = await c.call("POST", `/sittings/${sittingId}/start`);
  expect(r.statusCode, JSON.stringify(r.json())).toBeLessThan(300);
  return r.json().sessionId as string;
}
let seqs = new Map<string, number>();
const put = (c: TestClient, sid: string, pos: number, answer: unknown, seq?: number) => {
  const k = `${sid}:${pos}`;
  const s = seq ?? (seqs.get(k) ?? 0) + 1;
  seqs.set(k, Math.max(s, seqs.get(k) ?? 0));
  return c.call("PUT", `/exam-sessions/${sid}/responses/${pos}`, { seq: s, answer });
};
/** Correct answers for everything auto-markable, essay answered with text. */
async function answerAllCorrect(c: TestClient, sid: string) {
  const answers: [number, unknown][] = [[MCQ1, { optionId: "B" }], [MCQ2, { optionId: "C" }], [TF, { value: true }], [SA1, { text: "Accra" }], [SA2, { text: "Kumasi" }], [ESSAY, { text: "Because communities share resources." }]];
  for (const [pos, a] of answers) expect((await put(c, sid, pos, a)).statusCode).toBe(200);
}
const clockAt = (msFromNow: number) => { env.app.exams.clock = () => new Date(Date.now() + msFromNow); };
afterEach(() => { env.app.exams.clock = () => new Date(); });

beforeAll(async () => {
  env = await startTestEnv();
  alpha = env.ids.alphaId!; beta = env.ids.betaId!; alphaSubject = env.ids.alphaSubjectId!; alphaClassId = env.ids.alphaClassId!; betaSubject = env.ids.betaSubjectId!;
  teacherA = await login(env.app, "teacher.alpha@tmp.test");
  teacherB = await login(env.app, "teacher.beta@tmp.test");
  studentA = await login(env.app, "student.alpha@tmp.test");
  studentB = await login(env.app, "student.beta@tmp.test");
  superAdmin = await login(env.app, "super@tmp.test");
  await env.db.insert(classMembers).values({ classId: alphaClassId, userId: env.ids.alphaStudentId!, role: "student" }).onConflictDoNothing();

  const a = (body: Record<string, unknown>) => approved(teacherA, alpha, alphaSubject, body);
  qIds = {
    mcq1: await a({ type: "mcq", stem: `Which is a national symbol of Ghana? (${tag})`, content: { options: [{ id: "A", text: "A football" }, { id: "B", text: "Flag of Ghana" }, { id: "C", text: "A bus ticket" }, { id: "D", text: "A school bag" }], correctOptionId: "B" }, explanation: "Secret-explanation-mcq" }),
    mcq2: await a({ type: "mcq", stem: `Which is the capital city? (${tag})`, content: { options: [{ id: "A", text: "Tamale" }, { id: "B", text: "Ho" }, { id: "C", text: "Accra" }, { id: "D", text: "Wa" }], correctOptionId: "C" } }),
    tf: await a({ type: "true_false", stem: `Ghana gained independence in 1957. (${tag})`, content: { correct: true } }),
    sa1: await a({ type: "short_answer", stem: `Name the capital of Ghana. (${tag})`, marks: 2, content: { acceptedAnswers: ["Accra"] } }),
    sa2: await a({ type: "short_answer", stem: `Name the capital of the Ashanti Region. (${tag})`, marks: 2, content: { acceptedAnswers: ["Kumasi"] } }),
    sa3: await a({ type: "short_answer", stem: `Name the capital of the Northern Region. (${tag})`, marks: 2, content: { acceptedAnswers: ["Tamale"] } }),
    essay: await a({ type: "essay", stem: `Explain why communities need rules. (${tag})`, marks: 4, content: { rubric: [{ point: "Order", marks: 2 }, { point: "Fairness", marks: 2 }] } }),
  };
  const e = await teacherA.call("POST", `/institutions/${alpha}/exams`, { title: `Term test ${tag}`, durationMinutes: 60, sections: sections() });
  expect(e.statusCode, JSON.stringify(e.json())).toBe(201);
  examId = e.json().exam.id;
});
afterAll(async () => { await env.close(); });

describe("building exams", () => {
  it("accepts only approved questions from the same school, and fair 'answer any' sections", async () => {
    const draft = (await teacherA.call("POST", `/institutions/${alpha}/questions`, { subjectId: alphaSubject, type: "true_false", stem: "An unapproved draft statement.", content: { correct: true } })).json().question.id;
    const r1 = await teacherA.call("POST", `/institutions/${alpha}/exams`, { title: "Bad", durationMinutes: 30, sections: [{ title: "A", questionIds: [draft] }] });
    expect(r1.statusCode).toBe(400);
    expect(JSON.stringify(r1.json())).toMatch(/approved/);
    // unequal marks in an answer_any section
    const r2 = await teacherA.call("POST", `/institutions/${alpha}/exams`, { title: "Unfair", durationMinutes: 30, sections: [{ title: "A", rule: { type: "answer_any", count: 1 }, questionIds: [qIds.mcq1, qIds.sa1] }] });
    expect(r2.statusCode).toBe(400);
    expect(JSON.stringify(r2.json())).toMatch(/same marks/);
    // asking for more than the section holds, and a question used twice
    expect((await teacherA.call("POST", `/institutions/${alpha}/exams`, { title: "Too many", durationMinutes: 30, sections: [{ title: "A", rule: { type: "answer_any", count: 5 }, questionIds: [qIds.mcq1, qIds.mcq2] }] })).statusCode).toBe(400);
    expect((await teacherA.call("POST", `/institutions/${alpha}/exams`, { title: "Dup", durationMinutes: 30, sections: [{ title: "A", questionIds: [qIds.mcq1] }, { title: "B", questionIds: [qIds.mcq1] }] })).statusCode).toBe(400);
    // another school's teacher
    expect((await teacherB.call("POST", `/institutions/${beta}/exams`, { title: "Steal", durationMinutes: 30, sections: [{ title: "A", questionIds: [qIds.mcq1] }] })).statusCode).toBe(400);
    expect((await teacherB.call("POST", `/institutions/${alpha}/exams`, { title: "Steal", durationMinutes: 30, sections: sections() })).statusCode).toBe(403);
    expect((await studentA.call("POST", `/institutions/${alpha}/exams`, { title: "Nope", durationMinutes: 30, sections: sections() })).statusCode).toBe(403);
  });

  it("never lets a structure claim to be official without a recorded source (API and database)", async () => {
    const body = { title: "Official?", durationMinutes: 30, provenance: "official_verified", sections: [{ title: "A", questionIds: [qIds.mcq1] }] };
    const r = await teacherA.call("POST", `/institutions/${alpha}/exams`, body);
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toMatch(/source specification/);
    await expect(env.db.insert(exams).values({ institutionId: alpha, title: "x", durationMinutes: 30, provenance: "official_verified" })).rejects.toThrow();
    expect((await teacherA.call("POST", `/institutions/${alpha}/exams`, { ...body, sourceSpec: "Verified against the published syllabus, 2026" })).statusCode).toBe(201);
  });

  it("keeps exams private to their school", async () => {
    expect((await teacherB.call("GET", `/exams/${examId}`)).statusCode).toBe(403);
    expect((await teacherB.call("GET", `/institutions/${alpha}/exams`)).statusCode).toBe(403);
    expect((await studentA.call("GET", `/exams/${examId}`)).statusCode).toBe(403);
    expect((await teacherB.call("GET", `/exams/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(403); // missing looks identical
    expect((await superAdmin.call("GET", `/exams/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
    expect((await teacherA.call("GET", `/exams/${examId}`)).json().items).toHaveLength(7);
  });
});

describe("scheduling a sitting", () => {
  it("rejects windows shorter than the exam, already-closed windows and foreign classes", async () => {
    expect((await teacherA.call("POST", `/exams/${examId}/sittings`, win(0, 30))).statusCode).toBe(400);
    expect((await teacherA.call("POST", `/exams/${examId}/sittings`, win(-200, -100))).statusCode).toBe(400);
    expect((await teacherA.call("POST", `/exams/${examId}/sittings`, { ...win(), closesAt: mins(-30) })).statusCode).toBe(400);
    const [betaClass] = await env.db.select().from(classes).where(eq(classes.institutionId, beta)).limit(1);
    expect((await teacherA.call("POST", `/exams/${examId}/sittings`, { ...win(), classId: betaClass!.id })).statusCode).toBe(400);
    expect((await teacherB.call("POST", `/exams/${examId}/sittings`, win())).statusCode).toBe(403);
    expect((await studentA.call("POST", `/exams/${examId}/sittings`, win())).statusCode).toBe(403);
  });

  it("freezes the questions, so a later bank edit changes nothing in a scheduled exam", async () => {
    const s = await newSitting();
    const edit = await teacherA.call("PATCH", `/questions/${qIds.tf}`, { stem: "EDITED after scheduling, so it must not appear." });
    expect(edit.statusCode).toBe(200);
    const sid = await startFor(studentA, s.id);
    const view = (await studentA.call("GET", `/exam-sessions/${sid}`)).json();
    expect(JSON.stringify(view)).not.toContain("EDITED after");
    // put the question back to approved for the remaining tests
    await teacherA.call("PATCH", `/questions/${qIds.tf}`, { stem: `Ghana gained independence in 1957. (${tag})` });
    await teacherA.call("POST", `/questions/${qIds.tf}/review`, { decision: "approve" });
  });
});

describe("starting and the server-owned clock", () => {
  it("does not open before the window, and refuses after it closes", async () => {
    const future = await newSitting(win(60, 300));
    const r = await studentA.call("POST", `/sittings/${future.id}/start`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("exam_not_open");

    const s = await newSitting();
    clockAt(4 * 3600_000); // well after closesAt
    const r2 = await studentB.call("POST", `/sittings/${s.id}/start`);
    expect(r2.statusCode).toBe(404); // beta student can't see alpha's sitting at all
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const r3 = await stud.client.call("POST", `/sittings/${s.id}/start`);
    expect(r3.statusCode).toBe(409);
    expect(r3.json().error.code).toBe("exam_closed");
  });

  it("sets the deadline on the server: duration, or the closing time if that comes first; starting twice returns the same attempt", async () => {
    const s = await newSitting();
    const t0 = Date.now();
    const first = await studentA.call("POST", `/sittings/${s.id}/start`);
    expect(first.statusCode).toBe(201);
    const dl = new Date(first.json().deadlineAt).getTime();
    expect(Math.abs(dl - (t0 + 60 * 60_000))).toBeLessThan(5000);
    const again = await studentA.call("POST", `/sittings/${s.id}/start`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ sessionId: first.json().sessionId, resumed: true });
    expect(again.json().deadlineAt).toBe(first.json().deadlineAt);

    // 20 minutes before the window closes: only 20 minutes remain, not 60.
    const late = await newSitting(win(-200, 20 + 1));
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const r = await stud.client.call("POST", `/sittings/${late.id}/start`);
    expect(Math.abs(new Date(r.json().deadlineAt).getTime() - new Date(late.closesAt).getTime())).toBeLessThan(1000);
  });

  it("starts exactly once under a double-click race", async () => {
    const s = await newSitting();
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const rs = await Promise.all(Array.from({ length: 6 }, () => stud.client.call("POST", `/sittings/${s.id}/start`)));
    expect(new Set(rs.map((r) => r.json().sessionId)).size).toBe(1);
    const [n] = await env.db.select({ n: count() }).from(examSessions).where(eq(examSessions.sittingId, s.id));
    expect(n!.n).toBe(1);
  });

  it("honours class restriction and school membership, answering 404 to everyone else", async () => {
    const [cls] = await env.db.insert(classes).values({ institutionId: alpha, name: `Only ${tag}`, level: "JHS 3", academicYear: "2026" }).returning();
    const [inClass, outClass] = await makeStudents(env, alpha, 2);
    await env.db.insert(classMembers).values({ classId: cls!.id, userId: inClass!.id, role: "student" });
    const s = await newSitting({ classId: cls!.id });
    expect((await inClass!.client.call("POST", `/sittings/${s.id}/start`)).statusCode).toBe(201);
    expect((await outClass!.client.call("POST", `/sittings/${s.id}/start`)).statusCode).toBe(404);
    expect((await studentB.call("POST", `/sittings/${s.id}/start`)).statusCode).toBe(404);
    expect((await teacherA.call("POST", `/sittings/${s.id}/start`)).statusCode).toBe(404); // staff don't sit exams
    const mineIn = (await inClass!.client.call("GET", "/my/exams")).json().exams.map((e: { sittingId: string }) => e.sittingId);
    const mineOut = (await outClass!.client.call("GET", "/my/exams")).json().exams.map((e: { sittingId: string }) => e.sittingId);
    expect(mineIn).toContain(s.id);
    expect(mineOut).not.toContain(s.id);
  });
});

describe("the exam room", () => {
  it("never sends the answer key, accepted answers, rubric or explanations", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    const res = await studentA.call("GET", `/exam-sessions/${sid}`);
    expect(res.statusCode).toBe(200);
    const text = JSON.stringify(res.json());
    for (const secret of ["correctOptionId", "acceptedAnswers", "rubric", "Secret-explanation-mcq", "Kumasi", "Order", "Fairness"]) expect(text).not.toContain(secret);
    const view = res.json();
    expect(view.sections.map((x: { ruleText: string }) => x.ruleText)).toEqual(["Answer all 3 questions.", "Answer any 2 of the 3 questions.", "Answer all 1 question."]);
    expect(view.session.remainingMs).toBeGreaterThan(59 * 60_000 - 5000);
    // option order is stable for a candidate between requests
    const again = (await studentA.call("GET", `/exam-sessions/${sid}`)).json();
    expect(again.sections[0].items[0].options).toEqual(view.sections[0].items[0].options);
  });

  it("is private to the candidate: another student, a teacher or another school's user all get 404", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    const other = (await makeStudents(env, alpha, 1))[0]!;
    for (const c of [other.client, teacherA, studentB, superAdmin]) {
      expect((await c.call("GET", `/exam-sessions/${sid}`)).statusCode).toBe(404);
      expect((await put(c, sid, MCQ1, { optionId: "A" })).statusCode).toBe(404);
      expect((await c.call("POST", `/exam-sessions/${sid}/submit`)).statusCode).toBe(404);
    }
  });
});

describe("saving answers", () => {
  it("is idempotent and ignores out-of-order saves (a delayed retry can never overwrite a newer answer)", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    expect((await put(studentA, sid, MCQ1, { optionId: "A" }, 1)).json()).toMatchObject({ applied: true, seq: 1 });
    expect((await put(studentA, sid, MCQ1, { optionId: "B" }, 3)).json()).toMatchObject({ applied: true, seq: 3 });
    const stale = await put(studentA, sid, MCQ1, { optionId: "D" }, 2);
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ applied: false, seq: 3 });
    expect((await put(studentA, sid, MCQ1, { optionId: "C" }, 3)).json().applied).toBe(false); // same seq replayed
    const [row] = await env.db.select().from(examResponses).where(and(eq(examResponses.sessionId, sid), eq(examResponses.itemPosition, MCQ1)));
    expect(row).toMatchObject({ seq: 3, answer: { optionId: "B" } });
    const versions = await env.db.select().from(examResponseVersions).where(eq(examResponseVersions.sessionId, sid));
    expect(versions.map((v) => v.seq).sort()).toEqual([1, 3]); // every accepted change is kept
    // clearing an answer is a normal, newer change
    expect((await put(studentA, sid, MCQ1, null, 4)).json().applied).toBe(true);
    expect((await studentA.call("GET", `/exam-sessions/${sid}`)).json().responses[MCQ1]).toMatchObject({ seq: 4, answer: null });
  });

  it("applies one of many identical concurrent saves, and stores one version", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    const rs = await Promise.all(Array.from({ length: 8 }, () => put(studentA, sid, TF, { value: true }, 5)));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.filter((r) => r.json().applied).length).toBe(1);
    const v = await env.db.select().from(examResponseVersions).where(and(eq(examResponseVersions.sessionId, sid), eq(examResponseVersions.itemPosition, TF)));
    expect(v).toHaveLength(1);
  });

  it("refuses answers of the wrong shape, unknown questions and bad sequence numbers", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    expect((await put(studentA, sid, MCQ1, { value: true }, 1)).statusCode).toBe(400);
    expect((await put(studentA, sid, TF, { text: "yes" }, 1)).statusCode).toBe(400);
    expect((await put(studentA, sid, ESSAY, { optionId: "A" }, 1)).statusCode).toBe(400);
    expect((await put(studentA, sid, 99, { optionId: "A" }, 1)).statusCode).toBe(404);
    expect((await studentA.call("PUT", `/exam-sessions/${sid}/responses/${MCQ1}`, { seq: 0, answer: null })).statusCode).toBe(400);
    expect((await studentA.call("PUT", `/exam-sessions/${sid}/responses/${MCQ1}`, { answer: null })).statusCode).toBe(400);
    expect((await put(studentA, sid, ESSAY, { text: "x".repeat(10_001) }, 1)).statusCode).toBe(400);
  });

  it("accepts a save inside the small grace window and refuses one after it, ending the attempt on time", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    expect((await put(studentA, sid, MCQ1, { optionId: "B" })).statusCode).toBe(200);
    const [sess] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    const msToDeadline = sess!.deadlineAt.getTime() - Date.now();
    clockAt(msToDeadline + 1000); // 1 s past the deadline: inside the grace
    expect((await put(studentA, sid, MCQ2, { optionId: "C" })).statusCode).toBe(200);
    clockAt(msToDeadline + SAVE_GRACE_MS + 500); // past the grace
    const late = await put(studentA, sid, TF, { value: true });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("time_up");
    const [sub] = await env.db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, sid));
    expect(sub).toMatchObject({ kind: "auto", answeredCount: 2 }); // the two answers saved in time are kept
    const [after] = await env.db.select().from(examResponses).where(and(eq(examResponses.sessionId, sid), eq(examResponses.itemPosition, TF)));
    expect(after).toBeUndefined();
  });
});

describe("submitting", () => {
  it("returns a receipt, is idempotent, and closes the attempt to further saves", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    await answerAllCorrect(studentA, sid);
    const r1 = await studentA.call("POST", `/exam-sessions/${sid}/submit`);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ kind: "student", answeredCount: 6, alreadySubmitted: false });
    expect(r1.json().receipt).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const r2 = await studentA.call("POST", `/exam-sessions/${sid}/submit`);
    expect(r2.json()).toMatchObject({ receipt: r1.json().receipt, alreadySubmitted: true });
    const saved = await put(studentA, sid, MCQ1, { optionId: "A" });
    expect(saved.statusCode).toBe(409);
    expect(saved.json().error.code).toBe("exam_submitted");
    const view = (await studentA.call("GET", `/exam-sessions/${sid}`)).json();
    expect(view.session.status).toBe("submitted");
    expect(view.submission.receipt).toBe(r1.json().receipt);
  });

  it("produces exactly one submission under concurrent submits, all returning the same receipt", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    await answerAllCorrect(studentA, sid);
    const rs = await Promise.all(Array.from({ length: 8 }, () => studentA.call("POST", `/exam-sessions/${sid}/submit`)));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.json().receipt)).size).toBe(1);
    expect(rs.filter((r) => !r.json().alreadySubmitted)).toHaveLength(1);
    const [n] = await env.db.select({ n: count() }).from(examSubmissions).where(eq(examSubmissions.sessionId, sid));
    expect(n!.n).toBe(1);
  });

  it("records a student's late press of Submit honestly, as an automatic submission", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    await put(studentA, sid, MCQ1, { optionId: "B" });
    const [sess] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    clockAt(sess!.deadlineAt.getTime() - Date.now() + SAVE_GRACE_MS + 1000);
    expect((await studentA.call("POST", `/exam-sessions/${sid}/submit`)).json().kind).toBe("auto");
  });

  it("records a time-up submission as automatic only when the server's clock agrees", async () => {
    const [early, onTime] = await makeStudents(env, alpha, 2);
    const s = await newSitting();
    const e = await startFor(early!.client, s.id), o = await startFor(onTime!.client, s.id);
    // claiming "time is up" 30 minutes early is just a normal submission
    expect((await early!.client.call("POST", `/exam-sessions/${e}/submit`, { timeUp: true })).json().kind).toBe("student");
    const [sess] = await env.db.select().from(examSessions).where(eq(examSessions.id, o));
    clockAt(sess!.deadlineAt.getTime() - Date.now() - 500); // half a second before the deadline: the page's clock has just hit zero
    expect((await onTime!.client.call("POST", `/exam-sessions/${o}/submit`, { timeUp: true })).json().kind).toBe("auto");
  });

  it("keeps the stored answers identical to the receipt hash even when saves race the submit", async () => {
    const students = await makeStudents(env, alpha, 12);
    const s = await newSitting();
    await Promise.all(students.map(async (st) => {
      const sid = await startFor(st.client, s.id);
      await put(st.client, sid, MCQ1, { optionId: "A" }, 1);
      // 15 rapid saves fired at the same moment as the submit.
      const saves = Array.from({ length: 15 }, (_, i) => put(st.client, sid, MCQ1, { optionId: "B" }, i + 2));
      const submit = st.client.call("POST", `/exam-sessions/${sid}/submit`);
      const out = await Promise.all([...saves, submit]);
      expect(out.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
      const rows = await env.db.select().from(examResponses).where(eq(examResponses.sessionId, sid)).orderBy(examResponses.itemPosition);
      const hash = createHash("sha256").update(JSON.stringify(rows.map((r) => [r.itemPosition, r.seq, r.answer ?? null]))).digest("hex");
      const [sub] = await env.db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, sid));
      expect(sub!.contentHash).toBe(hash); // nothing changed after the submission was sealed
    }));
  });
});

describe("submit versus save ordering (deterministic)", () => {
  it("makes a save wait for an in-flight submit and then be refused, so nothing changes after the submission is sealed", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    await put(stud.client, sid, MCQ1, { optionId: "A" }, 1);

    // A second connection plays the part of a submit that has locked the attempt and not yet committed.
    let locked!: () => void, release!: () => void;
    const hasLock = new Promise<void>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    const inFlightSubmit = env.sql.begin(async (q) => {
      await q`select id from exam_sessions where id = ${sid} for update`;
      locked();
      await gate;
      await q`update exam_sessions set status = 'submitted', marking_status = 'pending' where id = ${sid}`;
    });
    await hasLock;
    let settled = false;
    const racing = put(stud.client, sid, MCQ1, { optionId: "B" }, 2).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // it is waiting, not racing past the submit
    release();
    await inFlightSubmit;
    const res = await racing;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("exam_submitted");
    const [row] = await env.db.select().from(examResponses).where(and(eq(examResponses.sessionId, sid), eq(examResponses.itemPosition, MCQ1)));
    expect(row).toMatchObject({ seq: 1, answer: { optionId: "A" } });
  });
});

describe("marking and results", () => {
  it("marks deterministically after submission, applies 'answer any' selection, and leaves essays pending", async () => {
    const s = await newSitting();
    const sid = await startFor(studentA, s.id);
    await answerAllCorrect(studentA, sid); // mcq1, mcq2, tf right; sa1, sa2 right; essay answered; sa3 left blank
    await studentA.call("POST", `/exam-sessions/${sid}/submit`);
    await env.app.exams.idle();
    const r = await env.app.exams.result(sid);
    expect(r.markingStatus).toBe("marked");
    expect(r.totalMax).toBe(3 + 4 + 4);
    expect(r.totalAwarded).toBe(3 + 4); // essay not counted yet
    expect(r.pendingItems).toBe(1);
    expect(r.sections[2]!.items[0]).toMatchObject({ status: "pending", awarded: null });
    expect(r.sections[1]!.items.find((i) => i.position === SA3)!.status).toBe("unanswered");
  });

  it("counts only the best n of an 'answer any n' section, and wrong answers score zero", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    for (const [pos, a] of [[MCQ1, { optionId: "A" }], [MCQ2, { optionId: "C" }], [TF, { value: false }], [SA1, { text: "  accra " }], [SA2, { text: "Kumasi" }], [SA3, { text: "Tamale" }]] as [number, unknown][]) await put(stud.client, sid, pos, a);
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    await env.app.exams.idle();
    const r = await env.app.exams.result(sid);
    // Section A: 0 + 1 + 0. Section B: three right but only two count (4 of max 4), one shown as not counted. Essay: unanswered.
    expect(r.sections[0]!.awarded).toBe(1);
    expect(r.sections[1]).toMatchObject({ awarded: 4, max: 4 });
    expect(r.sections[1]!.items.filter((i) => i.status === "not_counted")).toHaveLength(1);
    expect(r.sections[2]!.items[0]!.status).toBe("unanswered");
    expect(r.pendingItems).toBe(0);
  });

  it("never marks anything for a student who submitted nothing", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    await env.app.exams.idle();
    const r = await env.app.exams.result(sid);
    expect(r.totalAwarded).toBe(0);
    expect(r.totalMax).toBe(11);
  });
});

describe("the sweeper (automatic submission and marking)", () => {
  it("submits attempts after the deadline, but not before the grace has passed", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    await put(stud.client, sid, MCQ1, { optionId: "B" });
    const [sess] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    const toDeadline = sess!.deadlineAt.getTime() - Date.now();

    clockAt(toDeadline + 500); // past deadline, inside grace
    await env.app.exams.sweep();
    expect((await env.db.select().from(examSessions).where(eq(examSessions.id, sid)))[0]!.status).toBe("in_progress");
    clockAt(toDeadline + SAVE_GRACE_MS + 500);
    const out = await env.app.exams.sweep();
    expect(out.autoSubmitted).toBeGreaterThanOrEqual(1);
    await env.app.exams.idle();
    const [after] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    expect(after).toMatchObject({ status: "submitted", markingStatus: "marked" });
    const [sub] = await env.db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, sid));
    expect(sub).toMatchObject({ kind: "auto", answeredCount: 1 });
    expect((await env.db.select().from(examMarks).where(eq(examMarks.sessionId, sid))).find((m) => m.itemPosition === MCQ1)!.awarded).toBe(1);
    // a second sweep leaves it alone: still one submission
    await env.app.exams.sweep();
    expect(await env.db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, sid))).toHaveLength(1);
  });

  it("finishes marking that was left pending, without duplicating marks", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    await put(stud.client, sid, TF, { value: true });
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    await env.app.exams.idle();
    await env.db.delete(examMarks).where(eq(examMarks.sessionId, sid)); // simulate marking that never completed
    await env.db.update(examSessions).set({ markingStatus: "pending" }).where(eq(examSessions.id, sid));
    expect((await env.app.exams.sweep()).marked).toBeGreaterThanOrEqual(1);
    const marks = await env.db.select().from(examMarks).where(eq(examMarks.sessionId, sid));
    expect(marks).toHaveLength(6); // every auto-markable item, once
    await env.app.exams.markSession(sid); // running it again changes nothing
    expect(await env.db.select().from(examMarks).where(eq(examMarks.sessionId, sid))).toHaveLength(6);
  });

  it("auto-submits a timed-out attempt the moment the candidate looks at it, without waiting for the sweeper", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    const [sess] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    clockAt(sess!.deadlineAt.getTime() - Date.now() + SAVE_GRACE_MS + 1000);
    const view = (await stud.client.call("GET", `/exam-sessions/${sid}`)).json();
    expect(view.session.status).toBe("submitted");
    expect(view.submission.kind).toBe("auto");
  });
});

describe("results visibility (formal-exam isolation)", () => {
  it("shows candidates only a receipt until a teacher releases results after the exam closes, and never reveals keys", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    expect((await stud.client.call("GET", `/exam-sessions/${sid}/result`)).statusCode).toBe(409); // not submitted yet
    await put(stud.client, sid, MCQ1, { optionId: "B" });
    await put(stud.client, sid, ESSAY, { text: "Rules keep order and make things fair." }); // an essay waits for a person
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    await env.app.exams.idle();

    const hidden = (await stud.client.call("GET", `/exam-sessions/${sid}/result`)).json();
    expect(hidden.released).toBe(false);
    expect(hidden).not.toHaveProperty("totalAwarded");

    expect((await teacherA.call("POST", `/sittings/${s.id}/release-results`)).statusCode).toBe(409); // still open
    expect((await stud.client.call("POST", `/sittings/${s.id}/release-results`)).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/sittings/${s.id}/release-results`)).statusCode).toBe(403);
    clockAt(4 * 3600_000);
    expect((await teacherA.call("POST", `/sittings/${s.id}/release-results`)).statusCode).toBe(200);
    const shown = (await stud.client.call("GET", `/exam-sessions/${sid}/result`)).json();
    expect(shown).toMatchObject({ released: true, totalAwarded: 1, totalMax: 11, markingComplete: false });
    const text = JSON.stringify(shown);
    for (const secret of ["correctOptionId", "acceptedAnswers", "Secret-explanation-mcq", "explanation"]) expect(text).not.toContain(secret);
    // someone else's result is invisible
    expect((await studentA.call("GET", `/exam-sessions/${sid}/result`)).statusCode).toBe(404);
  });
});

describe("the control room", () => {
  it("shows who has not started, who is working and who has submitted, to the school's staff only", async () => {
    const [a, b, c] = await makeStudents(env, alpha, 3);
    const [cls] = await env.db.insert(classes).values({ institutionId: alpha, name: `Control ${tag}`, level: "JHS 3", academicYear: "2026" }).returning();
    await env.db.insert(classMembers).values([a!, b!, c!].map((x) => ({ classId: cls!.id, userId: x.id, role: "student" })));
    const s = await newSitting({ classId: cls!.id });
    const sa = await startFor(a!.client, s.id);
    const sb = await startFor(b!.client, s.id);
    await put(a!.client, sa, MCQ1, { optionId: "B" });
    await b!.client.call("POST", `/exam-sessions/${sb}/submit`);
    const room = (await teacherA.call("GET", `/sittings/${s.id}`)).json();
    expect(room.counts).toEqual({ expected: 3, notStarted: 1, inProgress: 1, submitted: 1 });
    const byId = new Map(room.students.map((x: { userId: string }) => [x.userId, x]));
    expect(byId.get(a!.id)).toMatchObject({ status: "in_progress", answered: 1 });
    expect(byId.get(b!.id)).toMatchObject({ status: "submitted", submitKind: "student" });
    expect(byId.get(c!.id)).toMatchObject({ status: "not_started", sessionId: null });
    expect(room.sitting.phase).toBe("open");
    for (const x of [teacherB, studentA, a!.client]) expect((await x.call("GET", `/sittings/${s.id}`)).statusCode).toBe(403);
    const results = (await teacherA.call("GET", `/sittings/${s.id}/results`)).json();
    expect(results.results).toHaveLength(1);
  });

  it("grants extra time only to the right people, with a recorded reason, and never reopens an ended attempt", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    const [before] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    expect((await stud.client.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 10, reason: "Give me more time please" })).statusCode).toBe(403);
    expect((await teacherB.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 10, reason: "Not my school at all" })).statusCode).toBe(403);
    expect((await teacherA.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 10 })).statusCode).toBe(400); // reason required
    expect((await teacherA.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 500, reason: "Way too long" })).statusCode).toBe(400);
    const ok = await teacherA.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 15, reason: "Approved accommodation: extra time" });
    expect(ok.statusCode).toBe(200);
    const [after] = await env.db.select().from(examSessions).where(eq(examSessions.id, sid));
    expect(after!.deadlineAt.getTime() - before!.deadlineAt.getTime()).toBe(15 * 60_000);
    expect(after!.extensionMinutes).toBe(15);
    const [audit] = await env.db.select().from(auditLogs).where(and(eq(auditLogs.action, "exam.extend"), eq(auditLogs.targetId, sid)));
    expect(JSON.stringify(audit!.metadata)).toContain("Approved accommodation");
    // after submission the attempt can't be extended or reopened
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    expect((await teacherA.call("POST", `/exam-sessions/${sid}/extend`, { minutes: 5, reason: "Too late for this one" })).statusCode).toBe(409);
    expect((await teacherA.call("POST", `/exam-sessions/00000000-0000-4000-8000-000000000000/extend`, { minutes: 5, reason: "No such attempt" })).statusCode).toBe(403);
  });

  it("can cancel a sitting only before anyone has started", async () => {
    const s1 = await newSitting();
    expect((await teacherB.call("POST", `/sittings/${s1.id}/cancel`)).statusCode).toBe(403);
    expect((await teacherA.call("POST", `/sittings/${s1.id}/cancel`)).statusCode).toBe(200);
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    expect((await stud.client.call("POST", `/sittings/${s1.id}/start`)).json().error.code).toBe("exam_cancelled");
    expect((await stud.client.call("GET", "/my/exams")).json().exams.map((e: { sittingId: string }) => e.sittingId)).not.toContain(s1.id);

    const s2 = await newSitting();
    await startFor(stud.client, s2.id);
    expect((await teacherA.call("POST", `/sittings/${s2.id}/cancel`)).statusCode).toBe(409);
  });
});

describe("audit trail", () => {
  it("records building, scheduling, starting and submitting", async () => {
    const stud = (await makeStudents(env, alpha, 1))[0]!;
    const s = await newSitting();
    const sid = await startFor(stud.client, s.id);
    await stud.client.call("POST", `/exam-sessions/${sid}/submit`);
    const actions = (await env.db.select({ a: auditLogs.action, t: auditLogs.targetId }).from(auditLogs)).filter((r) => [s.id, sid, examId].includes(r.t ?? ""));
    for (const want of ["exam.create", "sitting.create", "exam.start", "exam.submit"]) expect(actions.map((x) => x.a)).toContain(want);
  });
});

describe("the student's exam list", () => {
  it("shows open, upcoming and closed exams with the server's clock, and only for the student's school", async () => {
    const s = await newSitting(win(-10, 180));
    const f = await newSitting(win(60, 300));
    const mine = (await studentA.call("GET", "/my/exams")).json();
    const find = (id: string) => mine.exams.find((e: { sittingId: string }) => e.sittingId === id);
    expect(find(s.id).phase).toBe("open");
    expect(find(f.id).phase).toBe("upcoming");
    expect(typeof mine.serverNow).toBe("string");
    const theirs = (await studentB.call("GET", "/my/exams")).json();
    expect(theirs.exams.map((e: { sittingId: string }) => e.sittingId)).not.toContain(s.id);
    expect((await teacherA.call("GET", "/my/exams")).json().exams).toEqual([]);
  });
});

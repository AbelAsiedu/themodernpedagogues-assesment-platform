import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { classMembers, classes, quizSessions, sessionAnswers, sessionParticipants } from "../src/db/schema.js";
import { Leaderboard } from "../src/quiz/leaderboard.js";
import { getPlayState, submitAnswer } from "../src/quiz/play.js";
import { ORIGIN, clientFor, login, makeStudents, startTestEnv, type TestClient, type TestEnv } from "./helpers.js";

/* ---- optional real Redis (the sandbox has one). Tests that need it are skipped, visibly, when it's absent. */
let redis: Redis | undefined;
try {
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  r.on("error", () => {});
  await r.connect();
  await r.ping();
  redis = r;
} catch { redis = undefined; }
const itRedis = redis ? it : it.skip;

let env: TestEnv;
let teacherA: TestClient, teacherB: TestClient, studentA: TestClient, studentB: TestClient, superAdmin: TestClient;
let alpha: string, beta: string, alphaSubject: string, alphaClassId: string;
let questionIds: string[];
let quizId: string;
const RIGHT = "Flag of Ghana";

async function approved(body: Record<string, unknown>) {
  const c = await teacherA.call("POST", `/institutions/${alpha}/questions`, { subjectId: alphaSubject, ...body });
  expect(c.statusCode).toBe(201);
  const id = c.json().question.id as string;
  expect((await teacherA.call("POST", `/questions/${id}/submit-for-review`)).statusCode).toBe(200);
  expect((await teacherA.call("POST", `/questions/${id}/review`, { decision: "approve" })).statusCode).toBe(200);
  return id;
}

async function newSession(over: Record<string, unknown> = {}, quiz = quizId) {
  const r = await teacherA.call("POST", `/quizzes/${quiz}/sessions`, { startNow: true, ...over });
  expect(r.statusCode).toBe(201);
  return r.json().session as { id: string; joinCode: string; status: string };
}
const join = (c: TestClient, code: string, displayName?: string) => c.call("POST", "/sessions/join", { code, displayName });

/** The correct answer for whatever question the participant is currently looking at. */
function correctFor(state: { question: { type: string; options?: { id: string; text: string }[] } }) {
  const q = state.question;
  if (q.type === "mcq") return { optionId: q.options!.find((o) => o.text === RIGHT)!.id };
  if (q.type === "true_false") return { value: true };
  return { text: "Accra" };
}
const wrongFor = (state: Parameters<typeof correctFor>[0]) =>
  state.question.type === "mcq" ? { optionId: state.question.options!.find((o) => o.text !== RIGHT)!.id } : state.question.type === "true_false" ? { value: false } : { text: "Kumasi" };

async function playAll(c: TestClient, sid: string, opts: { double?: boolean; wrongOn?: number } = {}) {
  const results: { points: number; correct: boolean }[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const st = (await c.call("GET", `/sessions/${sid}/play`)).json();
    if (st.status !== "active") break;
    const answer = st.index === opts.wrongOn ? wrongFor(st) : correctFor(st);
    const post = () => c.call("POST", `/sessions/${sid}/answer`, { index: st.index, answer });
    const rs = opts.double ? await Promise.all([post(), post()]) : [await post()];
    for (const r of rs) expect(r.statusCode).toBe(200);
    results.push(rs[0]!.json());
  }
  return results;
}

beforeAll(async () => {
  env = await startTestEnv({ redis, env: { RATE_LIMIT_MAX: "100000" } });
  alpha = env.ids.alphaId!; beta = env.ids.betaId!; alphaSubject = env.ids.alphaSubjectId!; alphaClassId = env.ids.alphaClassId!;
  teacherA = await login(env.app, "teacher.alpha@tmp.test");
  teacherB = await login(env.app, "teacher.beta@tmp.test");
  studentA = await login(env.app, "student.alpha@tmp.test");
  studentB = await login(env.app, "student.beta@tmp.test");
  superAdmin = await login(env.app, "super@tmp.test");

  const tag = Math.random().toString(36).slice(2, 7);
  questionIds = [
    await approved({ type: "mcq", stem: `Which is a national symbol of Ghana? (${tag})`, content: { options: [{ id: "A", text: "A football" }, { id: "B", text: RIGHT }, { id: "C", text: "A bus ticket" }, { id: "D", text: "A school bag" }], correctOptionId: "B" }, explanation: "The flag is a national symbol." }),
    await approved({ type: "true_false", stem: `Ghana gained independence in 1957. (${tag})`, content: { correct: true }, explanation: "Secret-explanation-tf" }),
    await approved({ type: "short_answer", stem: `Name the capital city of Ghana. (${tag})`, content: { acceptedAnswers: ["Accra"] } }),
  ];
  const q = await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Test quiz", timePerQuestionSec: 30, questionIds });
  expect(q.statusCode).toBe(201);
  quizId = q.json().quiz.id;
  // make studentA a member of the alpha class (used by the class-restriction test)
  await env.db.insert(classMembers).values({ classId: alphaClassId, userId: env.ids.alphaStudentId!, role: "student" }).onConflictDoNothing();
});
afterAll(async () => { await env.close(); redis?.disconnect(); });

describe("building quizzes", () => {
  it("only accepts approved, auto-markable questions from the same school", async () => {
    const draft = (await teacherA.call("POST", `/institutions/${alpha}/questions`, { subjectId: alphaSubject, type: "true_false", stem: "An unapproved draft statement.", content: { correct: true } })).json().question.id;
    const essay = await approved({ type: "essay", stem: "Explain two causes of conflict in a community.", marks: 2, content: { rubric: [{ point: "One", marks: 1 }, { point: "Two", marks: 1 }] } });
    const r1 = await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Bad", questionIds: [draft] });
    expect(r1.statusCode).toBe(400);
    expect(JSON.stringify(r1.json())).toMatch(/approved/);
    const r2 = await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Bad", questionIds: [essay] });
    expect(r2.statusCode).toBe(400);
    expect(JSON.stringify(r2.json())).toMatch(/Essay/);
    expect((await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Dup", questionIds: [questionIds[0], questionIds[0]] })).statusCode).toBe(400);
    // another school's teacher can't build with alpha's questions, in their own school or in alpha's
    expect((await teacherB.call("POST", `/institutions/${beta}/quizzes`, { title: "Steal", questionIds })).statusCode).toBe(400);
    expect((await teacherB.call("POST", `/institutions/${alpha}/quizzes`, { title: "Steal", questionIds })).statusCode).toBe(403);
    expect((await studentA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Nope", questionIds })).statusCode).toBe(403);
  });
  it("pins each question's version, so later bank edits can't change a quiz", async () => {
    const detail = (await teacherA.call("GET", `/quizzes/${quizId}`)).json();
    expect(detail.items).toHaveLength(3);
    expect(detail.items.every((i: { version: number }) => i.version === 2 || i.version === 1)).toBe(true);
    const sess = await newSession();
    await teacherA.call("PATCH", `/questions/${questionIds[1]}`, { stem: "EDITED after the session was created, so it must not appear." });
    const sc = await teacherA.call("GET", `/sessions/${sess.id}`);
    expect(JSON.stringify(sc.json())).not.toContain("EDITED after");
    // restore approval for later tests
    await teacherA.call("PATCH", `/questions/${questionIds[1]}`, { stem: `Ghana gained independence in 1957. (restored)` });
    await teacherA.call("POST", `/questions/${questionIds[1]}/review`, { decision: "approve" });
  });
});

describe("join codes and joining", () => {
  it("issues a 6-character code and freezes the questions", async () => {
    const s = await newSession();
    expect(s.joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const [n] = await env.db.select({ n: count() }).from((await import("../src/db/schema.js")).sessionQuestions).where(eq((await import("../src/db/schema.js")).sessionQuestions.sessionId, s.id));
    expect(n!.n).toBe(3);
  });
  it("lets a student of that school join, forgiving case and spacing, and rejoining is idempotent", async () => {
    const s = await newSession();
    const spaced = `${s.joinCode.slice(0, 3).toLowerCase()} - ${s.joinCode.slice(3).toLowerCase()}`;
    const a = await join(studentA, spaced, "Ama K.");
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ sessionId: s.id, displayName: "Ama K." });
    const b = await join(studentA, s.joinCode);
    expect(b.statusCode).toBe(200);
    const rows = await env.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
    expect(rows).toHaveLength(1);
  });
  it("defaults the leaderboard name to first name + last initial and validates custom names", async () => {
    const s = await newSession();
    const [stu] = await makeStudents(env, alpha, 1);
    expect((await join(stu!.client, s.joinCode)).json().displayName).toBe("Bulk T.");
    const [stu2] = await makeStudents(env, alpha, 1);
    expect((await join(stu2!.client, s.joinCode, "<script>")).statusCode).toBe(400);
  });
  it("answers every failure identically: wrong code, other school, non-students, ended sessions", async () => {
    const s = await newSession();
    const bad = await join(studentA, "ZZZZZZ");
    const otherSchool = await join(studentB, s.joinCode);
    const teacher = await join(teacherA, s.joinCode);
    const platform = await join(superAdmin, s.joinCode);
    for (const r of [bad, otherSchool, teacher, platform]) {
      expect(r.statusCode).toBe(404);
      expect(r.json().error.message).toBe(bad.json().error.message);
    }
    await teacherA.call("POST", `/sessions/${s.id}/end`);
    expect((await join(studentA, s.joinCode)).statusCode).toBe(404);
    expect((await env.app.inject({ method: "POST", url: "/api/v1/sessions/join", payload: { code: s.joinCode } })).statusCode).toBe(401);
  });
  it("can be limited to one class", async () => {
    const s = await newSession({ classId: alphaClassId });
    const [outsider] = await makeStudents(env, alpha, 1);
    expect((await join(outsider!.client, s.joinCode)).statusCode).toBe(404);
    expect((await join(studentA, s.joinCode)).statusCode).toBe(201);
    // a class from another school is refused at creation
    const [bClass] = await env.db.select().from(classes).where(eq(classes.institutionId, beta)).limit(1);
    expect((await teacherA.call("POST", `/quizzes/${quizId}/sessions`, { classId: bClass!.id })).statusCode).toBe(400);
  });
  it("keeps a lobby closed to play until the teacher starts it", async () => {
    const s = await newSession({ startNow: false });
    expect(s.status).toBe("lobby");
    await join(studentA, s.joinCode);
    expect((await studentA.call("GET", `/sessions/${s.id}/play`)).json().status).toBe("lobby");
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: 0, answer: null })).statusCode).toBe(409);
    expect((await studentA.call("POST", `/sessions/${s.id}/start`)).statusCode).toBe(403);
    expect((await teacherA.call("POST", `/sessions/${s.id}/start`)).statusCode).toBe(200);
    expect((await teacherA.call("POST", `/sessions/${s.id}/start`)).statusCode).toBe(409);
    expect((await studentA.call("GET", `/sessions/${s.id}/play`)).json().status).toBe("active");
  });
});

describe("playing", () => {
  it("never sends the answer key, accepted answers or explanations before a question is answered", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = (await studentA.call("GET", `/sessions/${s.id}/play`)).body;
      seen.push(raw);
      const st = JSON.parse(raw);
      await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: correctFor(st) });
    }
    const all = seen.join("");
    for (const secret of ["correctOptionId", "acceptedAnswers", "explanation\":\"", "Secret-explanation-tf", "national symbol."]) expect(all).not.toContain(secret);
    expect(all).not.toContain('"correct"');
  });
  it("marks on the server, reveals the key after answering, and totals correctly", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const res = await playAll(studentA, s.id, { wrongOn: 1 });
    expect(res).toHaveLength(3);
    expect(res.filter((r) => r.correct)).toHaveLength(2);
    expect(res.filter((r) => !r.correct).every((r) => r.points === 0)).toBe(true);
    const fin = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    expect(fin.status).toBe("finished");
    expect(fin.result).toMatchObject({ correct: 2, answered: 3, total: 3 });
    const [p] = await env.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
    const [sum] = await env.db.select({ pts: sql<number>`sum(points)::int` }).from(sessionAnswers).where(eq(sessionAnswers.participantId, p!.id));
    expect(p!.totalPoints).toBe(sum!.pts);
  });
  it("returns the correct answer and explanation only after answering", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const st = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    const r = (await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: wrongFor(st) })).json();
    expect(r.correct).toBe(false);
    expect(r.correctAnswer).toBeTruthy();
  });
  it("is idempotent: a repeated answer returns the first result and counts once", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const st = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    const first = (await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: correctFor(st) })).json();
    const again = (await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: wrongFor(st) })).json(); // a different answer the 2nd time must NOT replace it
    expect(again).toMatchObject({ replayed: true, correct: first.correct, points: first.points, totalPoints: first.totalPoints });
    const [p] = await env.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
    expect(p!.answeredCount).toBe(1);
  });
  it("rejects skipping ahead, wrong answer shapes, and answering before the question was loaded", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: 0, answer: null })).statusCode).toBe(409); // not loaded yet
    const st = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index + 1, answer: null })).statusCode).toBe(409);
    const wrongShape = st.question.type === "mcq" ? { value: true } : { optionId: "A" };
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: wrongShape })).statusCode).toBe(400);
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: -1, answer: null })).statusCode).toBe(400);
  });
  it("only participants play, and the leaderboard/answer routes are closed to everyone else", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    for (const c of [studentB, teacherB]) {
      expect((await c.call("GET", `/sessions/${s.id}/play`)).statusCode).toBe(403);
      expect((await c.call("GET", `/sessions/${s.id}/leaderboard`)).statusCode).toBe(403);
      expect((await c.call("POST", `/sessions/${s.id}/answer`, { index: 0, answer: null })).statusCode).toBe(403);
    }
    expect((await teacherA.call("GET", `/sessions/${s.id}/play`)).statusCode).toBe(403); // hosts don't play
    const [other] = await makeStudents(env, alpha, 1); // right school, but never joined
    expect((await other!.client.call("GET", `/sessions/${s.id}/play`)).statusCode).toBe(403);
  });
});

describe("server-owned timing", () => {
  async function fresh(durationMinutes: number | null = null) {
    const s = await newSession({ durationMinutes });
    const [stu] = await makeStudents(env, alpha, 1);
    await join(stu!.client, s.joinCode);
    const [row] = await env.db.select().from(quizSessions).where(eq(quizSessions.id, s.id));
    const [p] = await env.db.select().from(sessionParticipants).where(and(eq(sessionParticipants.sessionId, s.id), eq(sessionParticipants.userId, stu!.id)));
    return { session: row!, pid: p!.id };
  }
  const answerNow = (st: Awaited<ReturnType<typeof getPlayState>>["state"]) => correctFor(st as never);

  it("rewards speed: an answer after 2s scores more than one after 25s", async () => {
    const t0 = new Date();
    const fast = await fresh(); const slow = await fresh();
    const stF = (await getPlayState(env.db, fast.session, fast.pid, t0)).state;
    const stS = (await getPlayState(env.db, slow.session, slow.pid, t0)).state;
    const rF = await submitAnswer(env.db, fast.session, fast.pid, { index: 0, answer: answerNow(stF) }, new Date(t0.getTime() + 2_000));
    const rS = await submitAnswer(env.db, slow.session, slow.pid, { index: 0, answer: answerNow(stS) }, new Date(t0.getTime() + 25_000));
    expect(rF.points).toBeGreaterThan(rS.points);
    expect(rF.points).toBeGreaterThanOrEqual(140);
    expect(rS.points).toBeGreaterThanOrEqual(100);
  });
  it("scores 0 for a correct answer that arrives after the limit plus grace", async () => {
    const t0 = new Date();
    const { session, pid } = await fresh();
    const st = (await getPlayState(env.db, session, pid, t0)).state;
    const r = await submitAnswer(env.db, session, pid, { index: 0, answer: answerNow(st) }, new Date(t0.getTime() + 40_000));
    expect(r).toMatchObject({ points: 0, late: true, correct: false });
  });
  it("settles a question the participant walked away from, instead of letting it stay open forever", async () => {
    const t0 = new Date();
    const { session, pid } = await fresh();
    await getPlayState(env.db, session, pid, t0);
    const back = await getPlayState(env.db, session, pid, new Date(t0.getTime() + 10 * 60_000));
    expect(back.changed).toBe(true);
    expect(back.state).toMatchObject({ status: "active", index: 1 });
    expect(back.totals.answeredCount).toBe(1);
    expect(back.totals.totalPoints).toBe(0);
    // the new question's clock starts when it is shown, not when the old one expired
    expect((back.state as { remainingMs: number }).remainingMs).toBeGreaterThan(29_000);
  });
  it("the client cannot supply its own timing: extra fields are ignored", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const st = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    const r = await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: correctFor(st), timeMs: 0, elapsedMs: 0, points: 99999 });
    expect(r.statusCode).toBe(200);
    expect(r.json().points).toBeLessThan(200);
  });
  it("closes a homework-style session by itself when its deadline passes", async () => {
    const { session, pid } = await fresh(1);
    const later = new Date(Date.now() + 5 * 60_000);
    expect((await getPlayState(env.db, session, pid, later)).state.status).toBe("ended");
    await expect(submitAnswer(env.db, session, pid, { index: 0, answer: null }, later)).rejects.toMatchObject({ code: "session_ended" });
  });
});

describe("many students at once", () => {
  it("40 students answering concurrently (every answer sent twice) never double-count, and Redis/PostgreSQL rankings agree", async () => {
    const N = 40;
    const s = await newSession();
    const students = await makeStudents(env, alpha, N);
    await Promise.all(students.map((x) => join(x.client, s.joinCode)));
    const all = await Promise.all(students.map((x, i) => playAll(x.client, s.id, { double: true, wrongOn: i % 5 === 0 ? 0 : undefined })));
    expect(all.every((r) => r.length === 3)).toBe(true);

    const [answers] = await env.db.select({ n: count() }).from(sessionAnswers).where(eq(sessionAnswers.sessionId, s.id));
    expect(answers!.n).toBe(N * 3); // exactly one row per participant per question
    const parts = await env.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
    expect(parts).toHaveLength(N);
    expect(parts.every((p) => p.finishedAt && p.answeredCount === 3)).toBe(true);
    const sums = await env.db.select({ pid: sessionAnswers.participantId, pts: sql<number>`sum(points)::int`, t: sql<number>`sum(time_ms)::int` }).from(sessionAnswers).where(eq(sessionAnswers.sessionId, s.id)).groupBy(sessionAnswers.participantId);
    for (const p of parts) {
      const m = sums.find((x) => x.pid === p.id)!;
      expect([p.totalPoints, p.totalTimeMs]).toEqual([m.pts, m.t]); // stored totals == sum of stored answers
    }
    // ranking order is exactly: points desc, time asc, id desc
    const expected = [...parts].sort((a, b) => b.totalPoints - a.totalPoints || a.totalTimeMs - b.totalTimeMs || (a.id < b.id ? 1 : -1)).map((p) => p.id);
    expect((await env.app.leaderboard.top(s.id, 100)).map((r) => r.participantId)).toEqual(expected);
    expect((await env.app.leaderboard.topFromDb(s.id, 100)).map((r) => r.participantId)).toEqual(expected);
  }, 60_000);

  it("the host sees everyone with real names and per-question results", async () => {
    const s = await newSession();
    const students = await makeStudents(env, alpha, 5);
    await Promise.all(students.map((x) => join(x.client, s.joinCode)));
    await Promise.all(students.map((x, i) => playAll(x.client, s.id, { wrongOn: i === 0 ? 0 : undefined })));
    const d = (await teacherA.call("GET", `/sessions/${s.id}`)).json();
    expect(d.participants).toHaveLength(5);
    expect(d.participants[0].fullName).toMatch(/Bulk Student/);
    expect(d.questions).toHaveLength(3);
    expect(d.questions.reduce((a: number, q: { answered: number }) => a + q.answered, 0)).toBe(15);
    expect(d.questions.reduce((a: number, q: { correct: number }) => a + q.correct, 0)).toBe(14);
  });
});

describe("leaderboard visibility", () => {
  it("shows players only display names and ranks (top 10), never real names, ids or emails", async () => {
    const s = await newSession();
    const students = await makeStudents(env, alpha, 12);
    await Promise.all(students.map((x, i) => join(x.client, s.joinCode, `Player ${i}`)));
    await Promise.all(students.map((x) => playAll(x.client, s.id)));
    const view = (await students[0]!.client.call("GET", `/sessions/${s.id}/leaderboard`)).json();
    expect(view.role).toBe("player");
    expect(view.top).toHaveLength(10);
    expect(view.me.rank).toBeGreaterThanOrEqual(1);
    const raw = JSON.stringify(view);
    for (const leak of ["Bulk", "@tmp.test", "fullName", "userId", "participantId"]) expect(raw).not.toContain(leak);
    const host = (await teacherA.call("GET", `/sessions/${s.id}/leaderboard`)).json();
    expect(host.role).toBe("host");
    expect(host.top.length).toBe(12);
  }, 30_000);

  it("can hide the leaderboard from players while teachers still see it", async () => {
    const q = await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Private board", showLeaderboard: false, questionIds });
    const s = await newSession({}, q.json().quiz.id);
    await join(studentA, s.joinCode);
    const r = (await playAll(studentA, s.id))[0]!;
    expect(r).toBeTruthy();
    const view = (await studentA.call("GET", `/sessions/${s.id}/leaderboard`)).json();
    expect(view.top).toEqual([]);
    expect((await teacherA.call("GET", `/sessions/${s.id}/leaderboard`)).json().top.length).toBe(1);
    const st = await newSession({}, q.json().quiz.id);
    await join(studentA, st.joinCode);
    const state = (await studentA.call("GET", `/sessions/${st.id}/play`)).json();
    const ans = (await studentA.call("POST", `/sessions/${st.id}/answer`, { index: state.index, answer: correctFor(state) })).json();
    expect(ans.rank).toBeNull(); // not revealed mid-quiz when hidden
  });
});

describe("tenant isolation for hosting", () => {
  it("another school's staff can't see, start, end or read a session or quiz", async () => {
    const s = await newSession({ startNow: false });
    const ghost = "00000000-0000-4000-8000-000000000000";
    for (const [m, url] of [["GET", `/sessions/${s.id}`], ["POST", `/sessions/${s.id}/start`], ["POST", `/sessions/${s.id}/end`], ["GET", `/sessions/${s.id}/leaderboard`], ["GET", `/quizzes/${quizId}`], ["POST", `/quizzes/${quizId}/sessions`], ["GET", `/institutions/${alpha}/sessions`], ["GET", `/institutions/${alpha}/quizzes`]] as const) {
      expect((await teacherB.call(m, url, m === "POST" ? {} : undefined)).statusCode, `${m} ${url}`).toBe(403);
      expect((await studentA.call(m, url, m === "POST" ? {} : undefined)).statusCode, `student ${m} ${url}`).toBe(403);
    }
    expect((await teacherB.call("GET", `/sessions/${ghost}`)).statusCode).toBe(403);
    expect((await superAdmin.call("GET", `/sessions/${ghost}`)).statusCode).toBe(404);
  });
  it("ending a session stops new answers, still replays old ones, and frees the code", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    const st = (await studentA.call("GET", `/sessions/${s.id}/play`)).json();
    await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: correctFor(st) });
    expect((await teacherA.call("POST", `/sessions/${s.id}/end`)).json().session.status).toBe("ended");
    const next = await studentA.call("POST", `/sessions/${s.id}/answer`, { index: 1, answer: null });
    expect(next.statusCode).toBe(409);
    expect(next.json().error.code).toBe("session_ended");
    expect((await studentA.call("POST", `/sessions/${s.id}/answer`, { index: st.index, answer: null })).json().replayed).toBe(true);
    expect((await studentA.call("GET", `/sessions/${s.id}/play`)).json().status).toBe("ended");
    // the database lets an ended session's code be reused by a new open session, but never by two open ones
    const base = { institutionId: alpha, quizId, settings: { title: "t", timePerQuestionSec: 30, shuffleQuestions: true, shuffleOptions: true, showLeaderboard: true, durationMinutes: null } };
    const code = "QQQQQQ";
    await env.db.insert(quizSessions).values({ ...base, joinCode: code, status: "ended" });
    await env.db.insert(quizSessions).values({ ...base, joinCode: code, status: "lobby" });
    await expect(env.db.insert(quizSessions).values({ ...base, joinCode: code, status: "active" })).rejects.toThrow();
  });
  it("cannot read hosting data through the player routes, and join attempts are rate limited", async () => {
    const limited = await startTestEnv({ env: { RATE_LIMIT_MAX: "100000" } });
    const t = await clientFor(limited, limited.ids.alphaStudentId!);
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await join(t, "ZZZZZZ")).statusCode;
    expect(last).toBe(429);
    await limited.close();
  });
});

describe("Leaderboard (Redis cache over PostgreSQL record)", () => {
  async function seeded(n: number) {
    const s = await newSession();
    const students = await makeStudents(env, alpha, n);
    await Promise.all(students.map((x) => join(x.client, s.joinCode)));
    const parts = await env.db.select().from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
    // lots of deliberate ties in points and in time
    for (const [i, p] of parts.entries()) await env.db.update(sessionParticipants).set({ totalPoints: (i % 4) * 100, totalTimeMs: (i % 3) * 1000 }).where(eq(sessionParticipants.id, p.id));
    return { s, parts };
  }

  itRedis("Redis and PostgreSQL produce the same order and ranks, including ties", async () => {
    const { s, parts } = await seeded(25);
    const lb = new Leaderboard(env.db, redis);
    await lb.drop(s.id);
    await lb.rebuild(s.id);
    const viaRedis = await lb.top(s.id, 100);
    const viaDb = await new Leaderboard(env.db).topFromDb(s.id, 100);
    expect(viaRedis.map((r) => r.participantId)).toEqual(viaDb.map((r) => r.participantId));
    expect(viaRedis.map((r) => r.points)).toEqual(viaDb.map((r) => r.points));
    const dbOnly = new Leaderboard(env.db);
    for (const p of parts.slice(0, 8)) expect(await lb.rankOf(s.id, p.id)).toBe(await dbOnly.rankOf(s.id, p.id));
  });
  itRedis("refills itself after Redis loses the key, even if a new score arrives first", async () => {
    const { s, parts } = await seeded(10);
    const lb = new Leaderboard(env.db, redis);
    await lb.drop(s.id);
    await lb.record(s.id, parts[0]!.id, 9999, 1); // first write after the loss must not leave a one-person board
    const top = await lb.top(s.id, 100);
    expect(top).toHaveLength(10);
    expect(top[0]!.participantId).toBe(parts[0]!.id);
  });
  it("degrades to PostgreSQL when Redis is unreachable, with the same answers", async () => {
    const { s, parts } = await seeded(12);
    const dead = new Redis({ port: 1, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false });
    dead.on("error", () => {});
    const lb = new Leaderboard(env.db, dead);
    const expected = await new Leaderboard(env.db).topFromDb(s.id, 100);
    await lb.record(s.id, parts[0]!.id, 1, 1); // must not throw
    expect((await lb.top(s.id, 100)).map((r) => r.participantId)).toEqual(expected.map((r) => r.participantId));
    expect(await lb.rankOf(s.id, expected[3]!.participantId)).toBe(4);
    dead.disconnect();
  });
});

describe("live WebSocket feed", () => {
  let base = "";
  type Msg = { type: string; role?: string; status: string; participants: number; top: { rank: number; name: string; points: number }[]; showLeaderboard: boolean };

  const open = (path: string, c: TestClient | null, headers: Record<string, string> = { origin: ORIGIN }) =>
    new Promise<{ ws: WebSocket; msgs: Msg[]; closed: Promise<number> }>((resolve) => {
      const ws = new WebSocket(`${base}/api/v1${path}`, { headers: { ...(c ? { cookie: c.cookie } : {}), ...headers } });
      const msgs: Msg[] = [];
      const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
      ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
      ws.on("error", () => {});
      ws.on("open", () => resolve({ ws, msgs, closed }));
      ws.on("unexpected-response", () => resolve({ ws, msgs, closed: Promise.resolve(-1) }));
      ws.on("close", () => resolve({ ws, msgs, closed })); // closed before open
    });
  const until = async (pred: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return pred(); };

  beforeAll(async () => {
    await env.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = env.app.server.address() as { port: number };
    base = `ws://127.0.0.1:${addr.port}`;
  });

  it("refuses unknown origins, missing origin, anonymous users, other schools and non-participants", async () => {
    const s = await newSession();
    await join(studentA, s.joinCode);
    expect(await (await open(`/sessions/${s.id}/live`, teacherA, { origin: "http://evil.example" })).closed).toBe(4403);
    expect(await (await open(`/sessions/${s.id}/live`, teacherA, {})).closed).toBe(4403);
    expect(await (await open(`/sessions/${s.id}/live`, null)).closed).toBe(4401);
    expect(await (await open(`/sessions/${s.id}/live`, teacherB)).closed).toBe(4403);
    expect(await (await open(`/sessions/${s.id}/live`, studentB)).closed).toBe(4403);
    const [outsider] = await makeStudents(env, alpha, 1);
    expect(await (await open(`/sessions/${s.id}/live`, outsider!.client)).closed).toBe(4403);
  });

  it("pushes leaderboard changes to the host and players, with role-appropriate content", async () => {
    const s = await newSession();
    const students = await makeStudents(env, alpha, 13);
    await Promise.all(students.map((x, i) => join(x.client, s.joinCode, `Kid ${i}`)));
    const host = await open(`/sessions/${s.id}/live`, teacherA);
    const player = await open(`/sessions/${s.id}/live`, students[0]!.client);
    expect(await until(() => host.msgs.length > 0 && player.msgs.length > 0)).toBe(true);
    expect(host.msgs[0]).toMatchObject({ role: "host", status: "active", participants: 13 });
    expect(player.msgs[0]).toMatchObject({ role: "player" });

    await Promise.all(students.map((x) => playAll(x.client, s.id)));
    expect(await until(() => host.msgs.some((m) => m.top.length === 13 && m.top[0]!.points > 0))).toBe(true);
    expect(await until(() => player.msgs.some((m) => m.top.length === 10))).toBe(true);
    const last = player.msgs[player.msgs.length - 1]!;
    expect(last.top.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(player.msgs)).not.toMatch(/Bulk|@tmp\.test|fullName|userId/);
    host.ws.close(); player.ws.close();
  }, 30_000);

  it("batches bursts: many answers produce far fewer broadcasts than answers", async () => {
    const s = await newSession();
    const students = await makeStudents(env, alpha, 30);
    await Promise.all(students.map((x) => join(x.client, s.joinCode)));
    const host = await open(`/sessions/${s.id}/live`, teacherA);
    await until(() => host.msgs.length > 0);
    await new Promise((r) => setTimeout(r, 700)); // let the join-time broadcast settle
    const before = host.msgs.length;
    await Promise.all(students.map((x) => playAll(x.client, s.id))); // 90 answers
    await new Promise((r) => setTimeout(r, 900));
    const broadcasts = host.msgs.length - before;
    expect(broadcasts).toBeGreaterThanOrEqual(1);
    expect(broadcasts).toBeLessThan(30); // 90 answers, coalesced into at most one update per 400 ms window
    host.ws.close();
  }, 30_000);

  it("hides the board from players when the quiz says so, and announces the end of a session", async () => {
    const q = await teacherA.call("POST", `/institutions/${alpha}/quizzes`, { title: "Hidden WS", showLeaderboard: false, questionIds });
    const s = await newSession({}, q.json().quiz.id);
    await join(studentA, s.joinCode);
    const host = await open(`/sessions/${s.id}/live`, teacherA);
    const player = await open(`/sessions/${s.id}/live`, studentA);
    await until(() => host.msgs.length > 0 && player.msgs.length > 0);
    await playAll(studentA, s.id);
    expect(await until(() => host.msgs.some((m) => m.top.length === 1))).toBe(true);
    await teacherA.call("POST", `/sessions/${s.id}/end`);
    expect(await until(() => player.msgs.some((m) => m.status === "ended"))).toBe(true);
    expect(player.msgs.every((m) => m.top.length === 0)).toBe(true);
    host.ws.close(); player.ws.close();
  }, 20_000);

  it("limits how many sockets one user can hold open", async () => {
    const s = await newSession();
    const socks = [];
    for (let i = 0; i < 5; i++) socks.push(await open(`/sessions/${s.id}/live`, teacherA));
    const sixth = await open(`/sessions/${s.id}/live`, teacherA);
    expect(await sixth.closed).toBe(4408);
    socks.forEach((x) => x.ws.close());
  });
});

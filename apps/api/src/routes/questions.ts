import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createQuestionSchema,
  createSubjectSchema,
  createTopicSchema,
  listQuestionsQuery,
  parseContent,
  reviewDecisionSchema,
  updateQuestionSchema,
  type Permission,
  type QuestionType,
} from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import type { Db } from "../db/client.js";
import { questionVersions, questions, subjects, topics, type Question } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });

/** What gets frozen into question_versions each time content changes. */
export function snapshotOf(q: Question) {
  return {
    type: q.type, stem: q.stem, explanation: q.explanation, difficulty: q.difficulty, marks: q.marks,
    content: q.content, subjectId: q.subjectId, topicId: q.topicId, status: q.status, source: q.source,
  };
}

/** A subject (and optional topic) must belong to the SAME institution as the question being written. */
export async function assertSubjectTopic(db: Db, institutionId: string, subjectId: string, topicId: string | null) {
  const [s] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.id, subjectId), eq(subjects.institutionId, institutionId))).limit(1);
  if (!s) throw badRequest("That subject doesn't exist in this school");
  if (topicId) {
    const [t] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.id, topicId), eq(topics.subjectId, subjectId), eq(topics.institutionId, institutionId)))
      .limit(1);
    if (!t) throw badRequest("That topic doesn't belong to the chosen subject");
  }
}

export async function questionRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /* ----------------------------------------------------- subjects & topics */

  app.get("/institutions/:id/subjects", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "questions.read", { institutionId: id });
    const subs = await db.select().from(subjects).where(eq(subjects.institutionId, id)).orderBy(asc(subjects.name));
    const tops = await db.select().from(topics).where(eq(topics.institutionId, id)).orderBy(asc(topics.name));
    return { subjects: subs.map((s) => ({ ...s, topics: tops.filter((t) => t.subjectId === s.id) })) };
  });

  app.post("/institutions/:id/subjects", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "subjects.manage", { institutionId: id });
    const input = parse(createSubjectSchema, req.body);
    const [dup] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.institutionId, id), ilike(subjects.name, input.name), eq(subjects.level, input.level)))
      .limit(1);
    if (dup) throw conflict("That subject already exists for this level");
    const [row] = await db.insert(subjects).values({ ...input, institutionId: id, createdBy: actor.id }).returning();
    await audit(db, { action: "subject.create", actorUserId: actor.id, institutionId: id, targetType: "subject", targetId: row!.id, ip: req.ip });
    return reply.status(201).send({ subject: { ...row!, topics: [] } });
  });

  app.post("/subjects/:id/topics", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = req.actor;
    const [sub] = await db.select().from(subjects).where(eq(subjects.id, id)).limit(1);
    // Same non-disclosure rule as classes: don't reveal whether a foreign id exists.
    if (!sub) {
      if (actor && can(actor, "subjects.manage")) throw notFound("Subject not found");
      app.requireActor(req);
      throw forbidden();
    }
    const who = app.authorize(req, "subjects.manage", { institutionId: sub.institutionId });
    const input = parse(createTopicSchema, req.body);
    const [dup] = await db.select({ id: topics.id }).from(topics).where(and(eq(topics.subjectId, id), ilike(topics.name, input.name))).limit(1);
    if (dup) throw conflict("That topic already exists in this subject");
    const [row] = await db.insert(topics).values({ name: input.name, subjectId: id, institutionId: sub.institutionId }).returning();
    await audit(db, { action: "topic.create", actorUserId: who.id, institutionId: sub.institutionId, targetType: "topic", targetId: row!.id, ip: req.ip });
    return reply.status(201).send({ topic: row });
  });

  /* ---------------------------------------------------------------- questions */

  app.get("/institutions/:id/questions", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "questions.read", { institutionId: id });
    const q = parse(listQuestionsQuery, req.query);
    const where = and(
      eq(questions.institutionId, id),
      q.subjectId ? eq(questions.subjectId, q.subjectId) : undefined,
      q.topicId ? eq(questions.topicId, q.topicId) : undefined,
      q.status ? eq(questions.status, q.status) : undefined,
      q.type ? eq(questions.type, q.type) : undefined,
      q.source ? eq(questions.source, q.source) : undefined,
      q.q ? ilike(questions.stem, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
    );
    const [rows, total] = await Promise.all([
      db.select().from(questions).where(where).orderBy(desc(questions.updatedAt)).limit(q.limit).offset(q.offset),
      db.select({ n: sql<number>`count(*)::int` }).from(questions).where(where),
    ]);
    return { questions: rows, total: total[0]?.n ?? 0, limit: q.limit, offset: q.offset };
  });

  app.post("/institutions/:id/questions", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "questions.write", { institutionId: id });
    const input = parse(createQuestionSchema, req.body);
    await assertSubjectTopic(db, id, input.subjectId, input.topicId);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(questions)
        .values({
          institutionId: id, subjectId: input.subjectId, topicId: input.topicId, type: input.type, stem: input.stem,
          explanation: input.explanation, difficulty: input.difficulty, marks: input.marks, content: input.content,
          status: "draft", source: "manual", createdBy: actor.id,
        })
        .returning();
      await tx.insert(questionVersions).values({ questionId: row!.id, version: 1, snapshot: snapshotOf(row!), changedBy: actor.id });
      return row!;
    });
    await audit(db, { action: "question.create", actorUserId: actor.id, institutionId: id, targetType: "question", targetId: created.id, ip: req.ip, metadata: { type: created.type } });
    return reply.status(201).send({ question: created });
  });

  /** Load a question, then authorise against ITS institution (never one supplied by the client). */
  async function questionFor(req: FastifyRequest, questionId: string, permission: Permission) {
    const actor = app.requireActor(req);
    const [q] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!q) {
      if (can(actor, permission)) throw notFound("Question not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: q.institutionId });
    return { actor, q };
  }

  app.get("/questions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { q } = await questionFor(req, id, "questions.read");
    const versions = await db
      .select({ version: questionVersions.version, changedBy: questionVersions.changedBy, createdAt: questionVersions.createdAt })
      .from(questionVersions)
      .where(eq(questionVersions.questionId, id))
      .orderBy(desc(questionVersions.version));
    return { question: q, versions };
  });

  app.patch("/questions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, q } = await questionFor(req, id, "questions.write");
    if (q.status === "archived") throw conflict("Archived questions can't be edited");
    const patch = parse(updateQuestionSchema, req.body);

    let content = q.content;
    if (patch.content !== undefined) {
      const parsed = parseContent(q.type as QuestionType, patch.content);
      if (!parsed.success) throw badRequest("Invalid answer data for this question type", parsed.error.issues.map((i) => ({ path: ["content", ...i.path].join("."), message: i.message })));
      content = parsed.data as Record<string, unknown>;
    }
    const marks = patch.marks ?? q.marks;
    if (q.type === "essay") {
      const total = (content as { rubric: { marks: number }[] }).rubric.reduce((a, r) => a + r.marks, 0);
      if (Math.abs(total - marks) > 1e-9) throw badRequest(`Marks (${marks}) must equal the rubric total (${total})`);
    }
    const topicId = patch.topicId !== undefined ? patch.topicId : q.topicId;
    if (patch.topicId !== undefined) await assertSubjectTopic(db, q.institutionId, q.subjectId, topicId);

    // Any change to an approved/rejected question sends it back for review. An approved question
    // can never be silently altered under a quiz or exam that already uses it.
    const nextStatus = q.status === "draft" ? "draft" : "needs_review";
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(questions)
        .set({
          stem: patch.stem ?? q.stem,
          explanation: patch.explanation !== undefined ? patch.explanation : q.explanation,
          difficulty: patch.difficulty ?? q.difficulty,
          marks, content, topicId,
          status: nextStatus,
          version: q.version + 1,
          reviewedBy: null, reviewedAt: null, reviewNote: null,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, id))
        .returning();
      await tx.insert(questionVersions).values({ questionId: id, version: row!.version, snapshot: snapshotOf(row!), changedBy: actor.id });
      return row!;
    });
    await audit(db, { action: "question.update", actorUserId: actor.id, institutionId: q.institutionId, targetType: "question", targetId: id, ip: req.ip, metadata: { fromStatus: q.status, toStatus: nextStatus, version: updated.version } });
    return { question: updated };
  });

  app.post("/questions/:id/submit-for-review", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, q } = await questionFor(req, id, "questions.write");
    if (q.status !== "draft" && q.status !== "rejected") throw conflict(`A ${q.status} question can't be submitted for review`);
    const [row] = await db.update(questions).set({ status: "needs_review", updatedAt: new Date() }).where(eq(questions.id, id)).returning();
    await audit(db, { action: "question.submit_review", actorUserId: actor.id, institutionId: q.institutionId, targetType: "question", targetId: id, ip: req.ip });
    return { question: row };
  });

  /** Human approval. This is the only route that can make a question usable in assessments. */
  app.post("/questions/:id/review", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, q } = await questionFor(req, id, "questions.review");
    const { decision, note } = parse(reviewDecisionSchema, req.body);
    if (q.status !== "needs_review") throw conflict("Only questions waiting for review can be reviewed");
    // Re-validate at the moment of approval, so nothing malformed can become 'approved'.
    const check = createQuestionSchema.safeParse({
      type: q.type, subjectId: q.subjectId, topicId: q.topicId, stem: q.stem, explanation: q.explanation,
      difficulty: q.difficulty, marks: q.marks, content: q.content,
    });
    if (decision === "approve" && !check.success) throw badRequest("This question is incomplete or inconsistent, so it can't be approved", check.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    const status = decision === "approve" ? "approved" : "rejected";
    const [row] = await db
      .update(questions)
      .set({ status, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note ?? null, updatedAt: new Date() })
      .where(eq(questions.id, id))
      .returning();
    await audit(db, { action: `question.${decision}`, actorUserId: actor.id, institutionId: q.institutionId, targetType: "question", targetId: id, ip: req.ip, metadata: { source: q.source, version: q.version } });
    return { question: row };
  });

  app.post("/questions/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, q } = await questionFor(req, id, "questions.write");
    if (q.status === "archived") return { question: q };
    const [row] = await db.update(questions).set({ status: "archived", updatedAt: new Date() }).where(eq(questions.id, id)).returning();
    await audit(db, { action: "question.archive", actorUserId: actor.id, institutionId: q.institutionId, targetType: "question", targetId: id, ip: req.ip });
    return { question: row };
  });
}

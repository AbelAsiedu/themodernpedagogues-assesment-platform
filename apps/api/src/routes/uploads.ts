import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AUTO_MARKED_TYPES, MAX_QUIZ_QUESTIONS, MAX_UPLOAD_BYTES, UPLOAD_KINDS, createQuestionSchema, importQuestionsSchema,
  type Permission, type UploadSectionSummary,
} from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import { normaliseStem } from "../ai/questionGen.js";
import { questionVersions, questions, quizItems, quizzes, uploads, type StoredParsedQuestion, type Upload } from "../db/schema.js";
import { HttpError, badRequest, conflict, forbidden, notFound, parse } from "../errors.js";
import { UploadError } from "../uploads/errors.js";
import { extractUpload } from "../uploads/extract.js";
import { ocrAvailable } from "../uploads/ocr.js";
import { assertSubjectTopic, snapshotOf } from "./questions.js";

const idParam = z.object({ id: z.string().uuid() });
const OPTION_IDS = ["A", "B", "C", "D", "E", "F"] as const;

const sectionSummary = (u: Upload): UploadSectionSummary[] =>
  u.sections.map((s) => ({ id: s.id, label: s.label, chars: s.text.length, preview: s.text.replace(/\s+/g, " ").slice(0, 160), ocr: s.ocr }));

/** What the browser sees: never the original file, and section text only as a short preview. */
function summary(u: Upload, full = false, dupes?: Set<string>) {
  const t = u.questionTable;
  const ready = t ? t.items.filter((i) => !i.problems.length).length : 0;
  return {
    id: u.id, filename: u.filename, kind: u.kind, sizeBytes: u.sizeBytes, charCount: u.charCount, warnings: u.warnings, createdAt: u.createdAt, uploadedBy: u.uploadedBy,
    sections: sectionSummary(u),
    questionTable: t ? {
      layout: t.layout, total: t.items.length, ready, suggestedTimeSec: t.suggestedTimeSec, truncated: t.truncated,
      ...(full ? { items: t.items.map((i) => ({ ...i, duplicate: !!dupes?.has(normaliseStem(i.stem)) })) } : {}),
    } : null,
  };
}

export async function uploadRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const ocrOpts = { enabled: config.OCR_ENABLED, lang: config.OCR_LANG };

  /** Load an upload, then authorise against ITS institution (never one the client names). Same non-disclosure rule as questions. */
  async function uploadFor(req: FastifyRequest, uploadId: string, permission: Permission) {
    const actor = app.requireActor(req);
    const [u] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
    if (!u) {
      if (can(actor, permission)) throw notFound("File not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: u.institutionId });
    return { actor, u };
  }

  app.get("/institutions/:id/uploads/capabilities", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "questions.write", { institutionId: id });
    return { maxBytes: MAX_UPLOAD_BYTES, kinds: UPLOAD_KINDS, ocr: await ocrAvailable(ocrOpts) };
  });

  app.get("/institutions/:id/uploads", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "questions.write", { institutionId: id });
    const rows = await db.select().from(uploads).where(eq(uploads.institutionId, id)).orderBy(desc(uploads.createdAt)).limit(100);
    return { uploads: rows.map((r) => summary(r)) };
  });

  app.post(
    "/institutions/:id/uploads",
    { config: { rateLimit: { max: config.UPLOAD_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const actor = app.authorize(req, "questions.write", { institutionId: id });
      if (!req.isMultipart()) throw badRequest("Send the file as a form upload");

      let file: { name: string; bytes: Buffer } | undefined;
      let rights = false;
      try {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (file) throw badRequest("Upload one file at a time");
            file = { name: (part.filename || "upload").slice(0, 200), bytes: await part.toBuffer() };
          } else if (part.fieldname === "confirmRights") rights = String(part.value) === "true";
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const code = (e as { code?: string }).code;
        if (code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, "too_large", `This file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
        if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") throw badRequest("Upload one file at a time");
        throw badRequest("The upload could not be read. Try again.");
      }
      if (!file) throw badRequest("Choose a file to upload");
      if (!rights) throw badRequest("Please confirm that you wrote this material or have permission to use it");

      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      const [dup] = await db.select().from(uploads).where(and(eq(uploads.institutionId, id), eq(uploads.sha256, sha256))).limit(1);
      if (dup) return reply.status(200).send({ upload: summary(dup), reused: true });

      let ex;
      try { ex = await extractUpload(new Uint8Array(file.bytes), file.name, ocrOpts); }
      catch (e) {
        if (e instanceof UploadError) {
          await audit(db, { action: "upload.create", actorUserId: actor.id, institutionId: id, outcome: "failure", ip: req.ip, metadata: { reason: e.code, size: file.bytes.length } });
          throw new HttpError(e.status === 413 ? 413 : 422, `upload_${e.code}`, e.message);
        }
        req.log.error({ err: e }, "upload extraction crashed");
        throw new HttpError(422, "upload_unreadable", "This file couldn't be read. It may be damaged or in an unusual format.");
      }

      const charCount = ex.sections.reduce((n, s) => n + s.text.length, 0);
      const [row] = await db
        .insert(uploads)
        .values({
          institutionId: id, uploadedBy: actor.id, filename: file.name, kind: ex.kind, sizeBytes: file.bytes.length, sha256,
          sections: ex.sections, charCount, questionTable: ex.questionTable, warnings: ex.warnings, rightsConfirmedAt: new Date(),
        })
        .onConflictDoNothing({ target: [uploads.institutionId, uploads.sha256] })
        .returning();
      if (!row) {
        // Lost a race with an identical upload: return that one.
        const [again] = await db.select().from(uploads).where(and(eq(uploads.institutionId, id), eq(uploads.sha256, sha256))).limit(1);
        return reply.status(200).send({ upload: summary(again!), reused: true });
      }
      await audit(db, {
        action: "upload.create", actorUserId: actor.id, institutionId: id, targetType: "upload", targetId: row.id, ip: req.ip,
        metadata: { kind: ex.kind, size: file.bytes.length, sections: ex.sections.length, chars: charCount, questionRows: ex.questionTable?.items.length ?? 0, ocr: ex.sections.some((s) => s.ocr), rightsConfirmed: true },
      });
      return reply.status(201).send({ upload: summary(row), reused: false });
    },
  );

  app.get("/uploads/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { u } = await uploadFor(req, id, "questions.write");
    const { subjectId } = parse(z.object({ subjectId: z.string().uuid().optional() }), req.query);
    let dupes: Set<string> | undefined;
    if (subjectId) {
      const ex = await db.select({ stem: questions.stem }).from(questions).where(and(eq(questions.institutionId, u.institutionId), eq(questions.subjectId, subjectId)));
      dupes = new Set(ex.map((e) => normaliseStem(e.stem)));
    }
    return { upload: summary(u, true, dupes) };
  });

  app.delete("/uploads/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { actor, u } = await uploadFor(req, id, "questions.write");
    await db.delete(uploads).where(eq(uploads.id, id));
    await audit(db, { action: "upload.delete", actorUserId: actor.id, institutionId: u.institutionId, targetType: "upload", targetId: id, ip: req.ip });
    return reply.status(204).send();
  });

  /**
   * Turn the parsed question table into real questions. No AI is involved: every question is validated with the same schema as
   * manual entry. Imports land in the review queue unless the teacher holds `questions.review` and chooses to approve in one step.
   */
  app.post("/uploads/:id/import-questions", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { actor, u } = await uploadFor(req, id, "questions.write");
    const input = parse(importQuestionsSchema, req.body);
    const scope = { institutionId: u.institutionId };
    if (input.approve) app.authorize(req, "questions.review", scope);
    if (input.quiz) app.authorize(req, "quizzes.manage", scope);
    if (!u.questionTable) throw badRequest("This file has no table of ready-made questions. Use \"Generate with AI\" on its text instead.");
    await assertSubjectTopic(db, u.institutionId, input.subjectId, input.topicId);

    const wanted = input.rows ? new Set(input.rows) : null;
    const chosen = u.questionTable.items.filter((i) => (wanted ? wanted.has(i.row) : true));
    if (!chosen.length) throw badRequest("No questions were selected");

    const existing = await db.select({ stem: questions.stem }).from(questions).where(and(eq(questions.institutionId, u.institutionId), eq(questions.subjectId, input.subjectId)));
    const seen = new Set(existing.map((e) => normaliseStem(e.stem)));

    const skipped: { row: number; stem: string; reason: string }[] = [];
    const ready: { item: StoredParsedQuestion; q: ReturnType<typeof buildQuestion> & object }[] = [];
    for (const item of chosen) {
      const skip = (reason: string) => skipped.push({ row: item.row, stem: item.stem.slice(0, 120), reason });
      if (item.problems.length) { skip(item.problems[0]!); continue; }
      const key = normaliseStem(item.stem);
      if (seen.has(key)) { skip("Already in your question bank"); continue; }
      const q = buildQuestion(item, input);
      const ok = createQuestionSchema.safeParse(q);
      if (!ok.success) { skip(ok.error.issues[0]?.message ?? "Invalid question"); continue; }
      seen.add(key);
      ready.push({ item, q: ok.data as never });
    }
    if (!ready.length) throw conflict(skipped.length ? `Nothing could be imported. ${skipped[0]!.reason}.` : "Nothing to import");
    if (input.quiz) {
      if (ready.length > MAX_QUIZ_QUESTIONS) throw badRequest(`A quiz can hold up to ${MAX_QUIZ_QUESTIONS} questions. Choose fewer rows.`);
      if (ready.some((r) => !AUTO_MARKED_TYPES.includes(r.q.type as never))) throw badRequest("Only automatically marked questions can go in a live quiz");
    }

    const status = input.approve ? "approved" : "needs_review";
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(questions)
        .values(ready.map(({ q }) => ({
          institutionId: u.institutionId, subjectId: q.subjectId, topicId: q.topicId, type: q.type, stem: q.stem, explanation: q.explanation,
          difficulty: q.difficulty, marks: q.marks, content: q.content as Record<string, unknown>, status, source: "import" as const,
          uploadId: u.id, createdBy: actor.id, ...(input.approve ? { reviewedBy: actor.id, reviewedAt: now } : {}),
        })))
        .returning();
      await tx.insert(questionVersions).values(rows.map((r) => ({ questionId: r.id, version: 1, snapshot: snapshotOf(r), changedBy: actor.id })));
      let quiz;
      if (input.quiz) {
        const [qz] = await tx
          .insert(quizzes)
          .values({
            institutionId: u.institutionId, title: input.quiz.title, description: null,
            timePerQuestionSec: input.quiz.timePerQuestionSec ?? u.questionTable!.suggestedTimeSec ?? 30,
            shuffleQuestions: input.quiz.shuffleQuestions, shuffleOptions: input.quiz.shuffleOptions, showLeaderboard: input.quiz.showLeaderboard, createdBy: actor.id,
          })
          .returning();
        // Keep the file's order.
        await tx.insert(quizItems).values(rows.map((r, position) => ({ quizId: qz!.id, position, questionId: r.id, questionVersion: r.version })));
        quiz = qz!;
      }
      return { rows, quiz };
    });

    await audit(db, {
      action: "upload.import", actorUserId: actor.id, institutionId: u.institutionId, targetType: "upload", targetId: u.id, ip: req.ip,
      metadata: { imported: result.rows.length, skipped: skipped.length, status, quizId: result.quiz?.id ?? null },
    });
    if (result.quiz) await audit(db, { action: "quiz.create", actorUserId: actor.id, institutionId: u.institutionId, targetType: "quiz", targetId: result.quiz.id, ip: req.ip, metadata: { questions: result.rows.length, fromUpload: u.id } });
    return reply.status(201).send({ imported: result.rows.length, status, skipped, quiz: result.quiz ?? null });
  });
}

function buildQuestion(item: StoredParsedQuestion, input: z.infer<typeof importQuestionsSchema>) {
  const base = {
    subjectId: input.subjectId, topicId: input.topicId, stem: item.stem, explanation: item.explanation,
    difficulty: (item.difficulty as "easy" | "medium" | "hard" | null) ?? input.difficulty, marks: item.marks ?? 1,
  };
  if (item.type === "mcq") return { ...base, type: "mcq" as const, content: { options: item.options.map((text, i) => ({ id: OPTION_IDS[i]!, text })), correctOptionId: OPTION_IDS[item.correctIndex ?? 0]! } };
  if (item.type === "true_false") return { ...base, type: "true_false" as const, content: { correct: item.correctBool === true } };
  return { ...base, type: "short_answer" as const, content: { acceptedAnswers: item.accepted } };
}

import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_SOURCE_TEXT, generateQuestionsSchema } from "@tmp/shared";
import { PROMPT_VERSION, generateQuestions, normaliseStem } from "../ai/questionGen.js";
import { AiProviderError } from "../ai/provider.js";
import { audit } from "../audit.js";
import { aiGenerations, questionVersions, questions, subjects, topics, uploads } from "../db/schema.js";
import { HttpError, badRequest, parse } from "../errors.js";
import { assertSubjectTopic, snapshotOf } from "./questions.js";

const idParam = z.object({ id: z.string().uuid() });

export async function aiRoutes(app: FastifyInstance) {
  const { db, config, ai } = app.deps;

  /** Tells the UI whether AI is available. Never returns the key. */
  app.get("/institutions/:id/ai/status", async (req) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "ai.generate", { institutionId: id });
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiGenerations)
      .where(and(eq(aiGenerations.requestedBy, actor.id), gt(aiGenerations.createdAt, since)));
    return {
      configured: !!ai,
      provider: ai?.name ?? null,
      model: ai?.model ?? null,
      dailyLimitPerUser: config.AI_DAILY_LIMIT_PER_USER,
      usedLast24h: used?.n ?? 0,
    };
  });

  app.get("/institutions/:id/ai/generations", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "ai.generate", { institutionId: id });
    const rows = await db
      .select()
      .from(aiGenerations)
      .where(eq(aiGenerations.institutionId, id))
      .orderBy(desc(aiGenerations.createdAt))
      .limit(50);
    return { generations: rows };
  });

  /**
   * Generate DRAFT questions. Output is validated with the same schemas as manual entry and saved as
   * `needs_review`; nothing here can make a question usable without a human approving it.
   * This runs inline (bounded by AI_TIMEOUT_MS and at most 10 questions); a job queue comes with bulk generation.
   */
  app.post(
    "/institutions/:id/ai/generate-questions",
    { config: { rateLimit: { max: config.AI_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const actor = app.authorize(req, "ai.generate", { institutionId: id });
      const parsedInput = parse(generateQuestionsSchema, req.body);
      if (!ai) throw new HttpError(503, "ai_not_configured", "AI generation isn't set up on this server yet");
      await assertSubjectTopic(db, id, parsedInput.subjectId, parsedInput.topicId);

      // Grounding from an uploaded file: the SERVER reads the chosen sections (the browser only names them), and only from a file
      // that belongs to this school. Selection is capped at the same 12,000 characters as pasted notes; nothing is silently cut.
      let input = parsedInput;
      let uploadId: string | null = null;
      if (parsedInput.uploadId) {
        app.authorize(req, "questions.write", { institutionId: id });
        const [up] = await db.select().from(uploads).where(and(eq(uploads.id, parsedInput.uploadId), eq(uploads.institutionId, id))).limit(1);
        if (!up) throw badRequest("That file isn't in this school");
        const wanted = new Set(parsedInput.sectionIds ?? []);
        if (!wanted.size) throw badRequest("Choose at least one part of the file to use");
        const picked = up.sections.filter((sec) => wanted.has(sec.id));
        if (picked.length !== wanted.size) throw badRequest("One of the chosen parts of the file no longer exists");
        const text = [...picked.map((sec) => sec.text), ...(parsedInput.sourceText ? [parsedInput.sourceText] : [])].join("\n\n");
        if (text.length > MAX_SOURCE_TEXT) throw badRequest(`The chosen parts total ${text.length.toLocaleString("en-GH")} characters. Choose fewer parts (the limit is ${MAX_SOURCE_TEXT.toLocaleString("en-GH")}).`);
        input = { ...parsedInput, sourceText: text };
        uploadId = up.id;
      }

      // Per-user daily quota, counted from the generation log (failed attempts count too, so errors can't be spammed).
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiGenerations)
        .where(and(eq(aiGenerations.requestedBy, actor.id), gt(aiGenerations.createdAt, since)));
      if ((used?.n ?? 0) >= config.AI_DAILY_LIMIT_PER_USER) {
        throw new HttpError(429, "ai_quota", `Daily AI limit reached (${config.AI_DAILY_LIMIT_PER_USER} requests per 24 hours)`);
      }

      const [subject] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, input.subjectId)).limit(1);
      const topic = input.topicId ? (await db.select({ name: topics.name }).from(topics).where(eq(topics.id, input.topicId)).limit(1))[0] : undefined;

      // Existing stems in this subject, so we don't save near-verbatim duplicates.
      const existing = await db
        .select({ stem: questions.stem })
        .from(questions)
        .where(and(eq(questions.institutionId, id), eq(questions.subjectId, input.subjectId)));
      const existingStems = new Set(existing.map((e) => normaliseStem(e.stem)));

      const params = {
        type: input.type, count: input.count, difficulty: input.difficulty, level: input.level,
        subjectId: input.subjectId, topicId: input.topicId,
        sourceTextChars: input.sourceText?.length ?? 0, hasFocus: !!input.focus,
        ...(uploadId ? { uploadId, sectionIds: parsedInput.sectionIds } : {}),
      };
      const started = Date.now();
      let outcome;
      try {
        outcome = await generateQuestions(ai, input, { subjectName: subject!.name, topicName: topic?.name ?? null }, { existingStems });
      } catch (e) {
        const err = e instanceof AiProviderError ? e : null;
        await db.insert(aiGenerations).values({
          institutionId: id, requestedBy: actor.id, provider: ai.name, model: ai.model, promptVersion: PROMPT_VERSION,
          params, status: "failed", requestedCount: input.count, latencyMs: Date.now() - started,
          error: err ? `${err.kind}: ${err.message}` : "unexpected_error",
        });
        await audit(db, { action: "ai.generate", actorUserId: actor.id, institutionId: id, outcome: "failure", ip: req.ip, metadata: { kind: err?.kind ?? "unexpected" } });
        if (!err) throw e;
        const status = err.kind === "rate_limit" ? 429 : err.kind === "timeout" ? 504 : 502;
        throw new HttpError(status, `ai_${err.kind}`, err.message);
      }

      const saved = await db.transaction(async (tx) => {
        const [gen] = await tx
          .insert(aiGenerations)
          .values({
            institutionId: id, requestedBy: actor.id, provider: ai.name, model: outcome.model, promptVersion: PROMPT_VERSION,
            params, status: "succeeded", requestedCount: input.count, savedCount: outcome.accepted.length,
            rejectedCount: outcome.rejected.length, tokensIn: outcome.inputTokens, tokensOut: outcome.outputTokens,
            latencyMs: Date.now() - started,
          })
          .returning();
        const rows = [];
        for (const q of outcome.accepted) {
          const [row] = await tx
            .insert(questions)
            .values({
              institutionId: id, subjectId: q.subjectId, topicId: q.topicId, type: q.type, stem: q.stem,
              explanation: q.explanation, difficulty: q.difficulty, marks: q.marks, content: q.content,
              status: "needs_review", source: "ai", aiGenerationId: gen!.id, uploadId, createdBy: actor.id,
            })
            .returning();
          await tx.insert(questionVersions).values({ questionId: row!.id, version: 1, snapshot: snapshotOf(row!), changedBy: actor.id });
          rows.push(row!);
        }
        return { gen: gen!, rows };
      });

      await audit(db, {
        action: "ai.generate", actorUserId: actor.id, institutionId: id, targetType: "ai_generation", targetId: saved.gen.id, ip: req.ip,
        metadata: { saved: saved.rows.length, rejected: outcome.rejected.length, model: outcome.model },
      });
      if (saved.rows.length === 0) throw badRequest("The AI didn't return any usable questions. Try again, or adjust your request.", outcome.rejected.slice(0, 5).map((r) => ({ path: "", message: r.reason })));
      return reply.status(201).send({ generation: saved.gen, questions: saved.rows, rejected: outcome.rejected });
    },
  );
}

import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Permission } from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import { examMarks, examResponses, examSessions, examSittings, examSubmissions, sittingItems } from "../db/schema.js";
import { isAnswered } from "../exam/answers.js";
import { facility, summariseScores } from "../exam/analytics.js";
import { csvRow, safeFileName } from "../exam/csv.js";
import { expectedStudents } from "../exam/people.js";
import { forbidden, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });

/** Results for teachers: statistics for a sitting and a spreadsheet export. Both read marks that are final (a person's or deterministic), never AI suggestions. */
export async function resultsRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function sittingFor(req: FastifyRequest, id: string, permission: Permission = "exams.manage") {
    const actor = app.requireActor(req);
    const [row] = await db.select().from(examSittings).where(eq(examSittings.id, id)).limit(1);
    if (!row) {
      if (can(actor, permission)) throw notFound("Not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: row.institutionId });
    return { actor, row };
  }

  /** Scored results of every submitted attempt, with the selection rules applied. */
  async function scored(sittingId: string) {
    const rows = await db.select().from(examSessions).where(and(eq(examSessions.sittingId, sittingId), eq(examSessions.status, "submitted")));
    return Promise.all(rows.map(async (s) => ({ session: s, result: await app.exams.result(s.id) })));
  }

  app.get("/sittings/:id/analytics", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: sitting } = await sittingFor(req, id);
    const [people, allSessions, items, done] = await Promise.all([
      expectedStudents(db, sitting),
      db.select().from(examSessions).where(eq(examSessions.sittingId, id)),
      db.select().from(sittingItems).where(eq(sittingItems.sittingId, id)).orderBy(asc(sittingItems.position)),
      scored(id),
    ]);
    const ids = done.map((d) => d.session.id);
    const [responses, marks] = ids.length ? await Promise.all([
      db.select().from(examResponses).where(inArray(examResponses.sessionId, ids)),
      db.select().from(examMarks).where(inArray(examMarks.sessionId, ids)),
    ]) : [[], []];

    const complete = done.filter((d) => d.result.pendingItems === 0 && d.result.totalMax > 0);
    const scores = summariseScores(complete.map((d) => (d.result.totalAwarded / d.result.totalMax) * 100));

    const questions = items.map((it) => {
      const answered = responses.filter((r) => r.itemPosition === it.position && isAnswered(r.answer));
      const answeredIds = new Set(answered.map((r) => r.sessionId));
      const marked = marks.filter((m) => m.itemPosition === it.position && answeredIds.has(m.sessionId));
      const sum = marked.reduce((a, m) => a + m.awarded, 0);
      const base = {
        position: it.position, stem: it.stem, type: it.type, marks: it.marks, answered: answered.length, unanswered: ids.length - answered.length,
        marked: marked.length, waitingForMarker: answered.length - marked.length,
        averageAwarded: marked.length ? Math.round((sum / marked.length) * 100) / 100 : null, facility: facility(sum, marked.length, it.marks),
      };
      if (it.type === "mcq") {
        const c = it.content as { options: { id: string; text: string }[]; correctOptionId: string };
        const counts = new Map<string, number>();
        for (const r of answered) { const o = (r.answer as { optionId?: string }).optionId; if (o) counts.set(o, (counts.get(o) ?? 0) + 1); }
        return { ...base, options: c.options.map((o) => ({ id: o.id, text: o.text, count: counts.get(o.id) ?? 0, correct: o.id === c.correctOptionId })) };
      }
      return base;
    });

    return {
      sitting: { id, title: sitting.title },
      participation: {
        expected: people.length, started: allSessions.length, submitted: done.length, fullyMarked: complete.length, awaitingMarking: done.length - complete.length,
      },
      /** Percent scores of attempts that are completely marked. Attempts still waiting on a marker are left out, not guessed. */
      scores: scores ? { ...scores, outOf: 100 } : null,
      questions,
    };
  });

  /** A spreadsheet of results. Cells that spreadsheets would run as formulas are neutralised. */
  app.get("/sittings/:id/results.csv", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { actor, row: sitting } = await sittingFor(req, id);
    const [people, allSessions, done, subs] = await Promise.all([
      expectedStudents(db, sitting),
      db.select().from(examSessions).where(eq(examSessions.sittingId, id)),
      scored(id),
      db.select({ sessionId: examSubmissions.sessionId, submittedAt: examSubmissions.submittedAt, kind: examSubmissions.kind }).from(examSubmissions).innerJoin(examSessions, eq(examSessions.id, examSubmissions.sessionId)).where(eq(examSessions.sittingId, id)),
    ]);
    const sessOf = new Map(allSessions.map((s) => [s.userId, s]));
    const resOf = new Map(done.map((d) => [d.session.id, d.result]));
    const subOf = new Map(subs.map((s) => [s.sessionId, s]));
    const sectionTitles = done[0]?.result.sections.map((s) => s.title) ?? [];
    const lines = [csvRow(["Name", "Status", "Submitted at", "Marks", "Out of", "Percent", "Written answers not yet marked", ...sectionTitles.map((t) => `${t} (marks)`)])];
    for (const p of people) {
      const s = sessOf.get(p.id);
      const r = s ? resOf.get(s.id) : undefined;
      const sub = s ? subOf.get(s.id) : undefined;
      if (!s) { lines.push(csvRow([p.fullName, "Did not start"])); continue; }
      if (!r) { lines.push(csvRow([p.fullName, "Not submitted"])); continue; }
      lines.push(csvRow([
        p.fullName, sub?.kind === "auto" ? "Submitted (time ran out)" : "Submitted", sub?.submittedAt.toISOString() ?? "",
        r.totalAwarded, r.totalMax, r.totalMax ? Math.round((r.totalAwarded / r.totalMax) * 1000) / 10 : "", r.pendingItems,
        ...r.sections.map((x) => x.awarded),
      ]));
    }
    await audit(db, { action: "sitting.export_results", actorUserId: actor.id, institutionId: sitting.institutionId, targetType: "exam_sitting", targetId: id, ip: req.ip, metadata: { rows: lines.length - 1 } });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${safeFileName(sitting.title)}-results.csv"`)
      .header("cache-control", "no-store")
      .send("﻿" + lines.join("\r\n") + "\r\n");
  });
}

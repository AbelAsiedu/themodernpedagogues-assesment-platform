import { and, count, desc, eq, gt, ilike, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditLogs, classes, institutions, memberships, sessions, users } from "../db/schema.js";
import { parse } from "../errors.js";

export async function adminRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /**
   * Platform overview. Every number is a live query; nothing is fabricated.
   * Exams, questions, AI usage etc. are deliberately absent until those modules exist.
   */
  app.get("/admin/overview", async (req) => {
    app.authorize(req, "users.read");
    const [u, inst, cls, act] = await Promise.all([
      db.select({ status: users.status, n: count() }).from(users).groupBy(users.status),
      db.select({ status: institutions.status, n: count() }).from(institutions).groupBy(institutions.status),
      db.select({ n: count() }).from(classes),
      db
        .select({ n: sql<number>`count(distinct ${sessions.userId})::int` })
        .from(sessions)
        .where(and(sql`${sessions.revokedAt} is null`, gt(sessions.expiresAt, new Date()))),
    ]);
    const roleCounts = await db
      .select({ role: memberships.role, n: sql<number>`count(distinct ${memberships.userId})::int` })
      .from(memberships)
      .where(eq(memberships.status, "active"))
      .groupBy(memberships.role);

    const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
    const role = (r: string) => roleCounts.find((x) => x.role === r)?.n ?? 0;
    return {
      users: { total: sum(u), byStatus: Object.fromEntries(u.map((r) => [r.status, r.n])) },
      students: role("student"),
      teachers: role("teacher"),
      institutions: { total: sum(inst), byStatus: Object.fromEntries(inst.map((r) => [r.status, r.n])) },
      classes: cls[0]?.n ?? 0,
      usersWithActiveSession: act[0]?.n ?? 0,
      asOf: new Date().toISOString(),
    };
  });

  const auditQuery = z.object({
    action: z.string().trim().max(80).optional(),
    outcome: z.enum(["success", "denied", "failure"]).optional(),
    actorUserId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/audit", async (req) => {
    app.authorize(req, "audit.read");
    const q = parse(auditQuery, req.query);
    const filters = [
      q.action ? ilike(auditLogs.action, `${q.action}%`) : undefined,
      q.outcome ? eq(auditLogs.outcome, q.outcome) : undefined,
      q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];
    const rows = await db
      .select()
      .from(auditLogs)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLogs.at))
      .limit(q.limit)
      .offset(q.offset);
    return { entries: rows, limit: q.limit, offset: q.offset };
  });
}

import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";
import { sessionParticipants } from "../db/schema.js";

/**
 * Live leaderboard.
 *
 * PostgreSQL is the record: every answer is stored there first. Redis is a fast ranking cache built on a sorted set,
 * and can be rebuilt from PostgreSQL at any time. If Redis is absent or down, rankings are computed from PostgreSQL
 * instead (slower, same order), so a Redis outage degrades the leaderboard but never loses or changes a score.
 *
 * Ordering (best first): more points, then LESS total answering time, then participant id (so ties are stable).
 * Encoded into a single sorted-set score so Redis can do all of it:
 *     score = points * TIME_SCALE + (TIME_SCALE - 1 - min(totalTimeMs, TIME_SCALE - 1))
 * With TIME_SCALE = 1e8 (about 27 hours) and points < 1e5 the score stays below 1e13, well inside the 2^53 range
 * where doubles are exact.
 */
export const TIME_SCALE = 1e8;

export const encodeScore = (points: number, totalTimeMs: number) =>
  points * TIME_SCALE + (TIME_SCALE - 1 - Math.min(Math.max(0, totalTimeMs), TIME_SCALE - 1));
export const decodePoints = (score: number) => Math.floor(score / TIME_SCALE);

export interface Ranked { participantId: string; rank: number; points: number }

const key = (sessionId: string) => `tmp:lb:${sessionId}`;
const TTL_SECONDS = 7 * 24 * 3600;

export class Leaderboard {
  constructor(private db: Db, private redis?: Redis) {}

  /** Record a participant's new totals. Idempotent: it sets, it doesn't add. */
  async record(sessionId: string, participantId: string, points: number, totalTimeMs: number) {
    if (!this.redis) return;
    try {
      await this.ensure(sessionId); // a restarted Redis must be refilled BEFORE the first new score lands in it
      await this.redis.multi().zadd(key(sessionId), encodeScore(points, totalTimeMs), participantId).expire(key(sessionId), TTL_SECONDS).exec();
    } catch { /* cache only: the answer is already safe in PostgreSQL */ }
  }

  async top(sessionId: string, n: number): Promise<Ranked[]> {
    if (this.redis) {
      try {
        await this.ensure(sessionId);
        const raw = await this.redis.zrevrange(key(sessionId), 0, n - 1, "WITHSCORES");
        const out: Ranked[] = [];
        for (let i = 0; i < raw.length; i += 2) out.push({ participantId: raw[i]!, rank: i / 2 + 1, points: decodePoints(Number(raw[i + 1])) });
        return out;
      } catch { /* fall through to PostgreSQL */ }
    }
    return this.topFromDb(sessionId, n);
  }

  async rankOf(sessionId: string, participantId: string): Promise<number | null> {
    if (this.redis) {
      try {
        await this.ensure(sessionId);
        const r = await this.redis.zrevrank(key(sessionId), participantId);
        if (r !== null) return r + 1;
      } catch { /* fall through */ }
    }
    const [me] = await this.db.select().from(sessionParticipants).where(eq(sessionParticipants.id, participantId)).limit(1);
    if (!me) return null;
    const sp = sessionParticipants;
    // "Ahead of me" = more points, or equal points and less time, or equal on both and a larger id (the documented order).
    const [ahead] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sp)
      .where(and(eq(sp.sessionId, sessionId), or(
        gt(sp.totalPoints, me.totalPoints),
        and(eq(sp.totalPoints, me.totalPoints), lt(sp.totalTimeMs, me.totalTimeMs)),
        and(eq(sp.totalPoints, me.totalPoints), eq(sp.totalTimeMs, me.totalTimeMs), gt(sp.id, me.id)),
      )));
    return (ahead?.n ?? 0) + 1;
  }

  async topFromDb(sessionId: string, n: number): Promise<Ranked[]> {
    const rows = await this.db
      .select({ id: sessionParticipants.id, points: sessionParticipants.totalPoints })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId))
      .orderBy(desc(sessionParticipants.totalPoints), asc(sessionParticipants.totalTimeMs), desc(sessionParticipants.id))
      .limit(n);
    return rows.map((r, i) => ({ participantId: r.id, rank: i + 1, points: r.points }));
  }

  /** Rebuild the sorted set from PostgreSQL if Redis lost it (restart, eviction). */
  private async ensure(sessionId: string) {
    if (!this.redis) return;
    if ((await this.redis.exists(key(sessionId))) === 1) return;
    await this.rebuild(sessionId);
  }

  async rebuild(sessionId: string) {
    if (!this.redis) return;
    const rows = await this.db
      .select({ id: sessionParticipants.id, points: sessionParticipants.totalPoints, t: sessionParticipants.totalTimeMs })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId));
    if (!rows.length) return;
    const m = this.redis.multi();
    // NX: never overwrite a score that a concurrent answer has already written.
    for (const r of rows) m.zadd(key(sessionId), "NX", encodeScore(r.points, r.t), r.id);
    m.expire(key(sessionId), TTL_SECONDS);
    await m.exec();
  }

  async drop(sessionId: string) {
    try { await this.redis?.del(key(sessionId)); } catch { /* ignore */ }
  }
}

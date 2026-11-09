import { eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";
import { quizSessions, sessionParticipants } from "../db/schema.js";
import type { Leaderboard } from "./leaderboard.js";

export type Role = "host" | "player";
export interface LiveClient { userId: string; role: Role; send(json: string): void }

export interface BoardEntry { rank: number; name: string; points: number }
export interface LiveEvent {
  type: "leaderboard" | "status";
  status: string;
  participants: number;
  showLeaderboard: boolean;
  /** Up to 50 entries. Players only ever receive the first 10, and none if the quiz hides its leaderboard. */
  top: BoardEntry[];
  at: string;
}

const CHANNEL = "tmp:live";
const PLAYER_TOP = 10;
const BATCH_MS = 400;
const MAX_PER_SESSION = 3000;
const MAX_PER_USER = 5;

/**
 * Real-time fan-out of leaderboard and status changes.
 *  - Each API process keeps the sockets connected to IT.
 *  - With Redis, an event published by any process is delivered to the sockets of every process (pub/sub).
 *    Without Redis, delivery is local to this process (fine for one instance).
 *  - Leaderboard updates are coalesced: however many answers arrive, a session gets at most one broadcast
 *    per BATCH_MS, built from the latest state.
 */
export class LiveHub {
  private rooms = new Map<string, Set<LiveClient>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private sub?: Redis;

  constructor(private db: Db, private lb: Leaderboard, private redis?: Redis) {}

  async start() {
    if (!this.redis) return;
    this.sub = this.redis.duplicate();
    this.sub.on("error", () => { /* the hub keeps working locally if pub/sub drops */ });
    await this.sub.subscribe(CHANNEL);
    this.sub.on("message", (_ch, msg) => {
      try {
        const { sessionId, event } = JSON.parse(msg) as { sessionId: string; event: LiveEvent };
        this.deliverLocal(sessionId, event);
      } catch { /* ignore malformed */ }
    });
  }

  async stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const room of this.rooms.values()) for (const c of room) { try { c.send(JSON.stringify({ type: "bye" })); } catch { /* ignore */ } }
    this.rooms.clear();
    await this.sub?.quit().catch(() => {});
  }

  /** Returns an unregister function, or null if a connection limit was hit. */
  register(sessionId: string, client: LiveClient): (() => void) | null {
    const room = this.rooms.get(sessionId) ?? new Set<LiveClient>();
    if (room.size >= MAX_PER_SESSION) return null;
    if ([...room].filter((c) => c.userId === client.userId).length >= MAX_PER_USER) return null;
    room.add(client);
    this.rooms.set(sessionId, room);
    return () => {
      room.delete(client);
      if (!room.size) this.rooms.delete(sessionId);
    };
  }

  socketCount(sessionId: string) { return this.rooms.get(sessionId)?.size ?? 0; }

  /** Build the current picture of a session from the leaderboard and the database. */
  async snapshot(sessionId: string, type: LiveEvent["type"] = "leaderboard"): Promise<LiveEvent | null> {
    const [s] = await this.db.select({ status: quizSessions.status, settings: quizSessions.settings, endsAt: quizSessions.endsAt }).from(quizSessions).where(eq(quizSessions.id, sessionId)).limit(1);
    if (!s) return null;
    const status = s.status === "active" && s.endsAt && s.endsAt.getTime() < Date.now() ? "ended" : s.status;
    const [count] = await this.db.select({ n: sql<number>`count(*)::int` }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, sessionId));
    const ranked = await this.lb.top(sessionId, 50);
    const names = ranked.length
      ? await this.db.select({ id: sessionParticipants.id, name: sessionParticipants.displayName }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, sessionId))
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return {
      type, status, participants: count?.n ?? 0, showLeaderboard: s.settings.showLeaderboard, at: new Date().toISOString(),
      top: ranked.map((r) => ({ rank: r.rank, name: nameOf.get(r.participantId) ?? "—", points: r.points })),
    };
  }

  /** Ask for a leaderboard broadcast. Many calls inside one window produce one broadcast. */
  schedule(sessionId: string) {
    if (this.timers.has(sessionId)) return;
    this.timers.set(sessionId, setTimeout(() => {
      this.timers.delete(sessionId);
      void this.broadcastNow(sessionId, "leaderboard");
    }, BATCH_MS));
  }

  async broadcastNow(sessionId: string, type: LiveEvent["type"]) {
    const event = await this.snapshot(sessionId, type).catch(() => null);
    if (!event) return;
    if (this.redis) {
      try { await this.redis.publish(CHANNEL, JSON.stringify({ sessionId, event })); return; } catch { /* fall back to local */ }
    }
    this.deliverLocal(sessionId, event);
  }

  /** Per-role view of an event. Players never see more than the top 10, and nothing if the quiz hides its leaderboard. */
  static view(event: LiveEvent, role: Role): LiveEvent {
    if (role === "host") return event;
    return { ...event, top: event.showLeaderboard ? event.top.slice(0, PLAYER_TOP) : [] };
  }

  private deliverLocal(sessionId: string, event: LiveEvent) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const cache: Partial<Record<Role, string>> = {};
    for (const c of room) {
      const msg = (cache[c.role] ??= JSON.stringify(LiveHub.view(event, c.role)));
      try { c.send(msg); } catch { /* a dead socket is cleaned up by its close handler */ }
    }
  }
}

import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { can } from "../authz/can.js";
import { quizSessions, sessionParticipants } from "../db/schema.js";
import { LiveHub, type Role } from "../quiz/hub.js";

const idParam = z.object({ id: z.string().uuid() });
const PING_MS = 25_000;

/**
 * WebSocket feed of one session. Read-only: anything the client sends is ignored (answers go through the HTTP API).
 * Close codes: 4401 not signed in, 4403 not allowed (also used for "no such session"), 4408 too many connections.
 */
export async function liveRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  app.get("/sessions/:id/live", { websocket: true }, async (socket: WebSocket, req) => {
    const close = (code: number, reason: string) => { try { socket.close(code, reason); } catch { /* already closed */ } };
    // Browsers always send Origin on WebSocket upgrades. Requiring a known one blocks cross-site hijacking of the cookie session.
    const origin = req.headers.origin;
    if (!origin || !config.webOrigins.includes(origin)) return close(4403, "origin");
    const actor = req.actor;
    if (!actor) return close(4401, "auth");
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return close(4403, "forbidden");

    const [s] = await db.select().from(quizSessions).where(eq(quizSessions.id, parsed.data.id)).limit(1);
    if (!s) return close(4403, "forbidden");
    let role: Role | null = null;
    if (can(actor, "sessions.host", { institutionId: s.institutionId })) role = "host";
    else {
      const isStudent = actor.memberships.some((m) => m.institutionId === s.institutionId && m.role === "student" && m.membershipStatus === "active" && m.institutionStatus === "active");
      const [p] = isStudent ? await db.select({ id: sessionParticipants.id }).from(sessionParticipants).where(and(eq(sessionParticipants.sessionId, s.id), eq(sessionParticipants.userId, actor.id))).limit(1) : [];
      if (p) role = "player";
    }
    if (!role) return close(4403, "forbidden");

    const unregister = app.hub.register(s.id, { userId: actor.id, role, send: (m) => socket.send(m) });
    if (!unregister) return close(4408, "too many connections");

    const first = await app.hub.snapshot(s.id, "status");
    if (first) socket.send(JSON.stringify({ ...LiveHub.view(first, role), role }));

    // Heartbeat: drop connections that stop answering pings, so dead sockets don't pile up.
    let alive = true;
    socket.on("pong", () => { alive = true; });
    const timer = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      try { socket.ping(); } catch { /* ignore */ }
    }, PING_MS);
    socket.on("close", () => { clearInterval(timer); unregister(); });
    socket.on("error", () => { clearInterval(timer); unregister(); });
    socket.on("message", () => { /* read-only channel */ });
  });
}

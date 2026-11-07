import { and, eq, gt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { loginSchema, PERMISSIONS } from "@tmp/shared";
import { audit } from "../audit.js";
import { can, describeRoles } from "../authz/can.js";
import { auditLogs, institutions, memberships, users } from "../db/schema.js";
import { HttpError, parse } from "../errors.js";
import { burnPasswordCheck, verifyPassword } from "../security/password.js";
import { createSession, revokeSession } from "../session.js";

const MAX_FAILED_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

export async function authRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const { email, password } = parse(loginSchema, req.body);

      // Per-account lockout, independent of IP, so distributed guessing is also slowed.
      const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
      const [{ failed = 0 } = {}] = await db
        .select({ failed: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "auth.login_failed"),
            gt(auditLogs.at, since),
            sql`${auditLogs.metadata}->>'email' = ${email}`,
          ),
        );
      if (failed >= MAX_FAILED_PER_WINDOW) {
        throw new HttpError(429, "too_many_attempts", "Too many failed attempts. Try again later.");
      }

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);

      if (!user || !ok) {
        await audit(db, { action: "auth.login_failed", outcome: "failure", ip: req.ip, metadata: { email } }, { log: (m) => req.log.error(m) });
        // Same message for unknown email and wrong password.
        throw new HttpError(401, "invalid_credentials", "Incorrect email or password");
      }
      if (user.status !== "active") {
        await audit(db, { action: "auth.login_blocked", actorUserId: user.id, outcome: "denied", ip: req.ip, metadata: { status: user.status } });
        throw new HttpError(403, "account_inactive", "This account is not active. Contact your administrator.");
      }

      const { token, expiresAt } = await createSession(db, user.id, config.SESSION_TTL_HOURS, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(db, { action: "auth.login", actorUserId: user.id, ip: req.ip }, { log: (m) => req.log.error(m) });

      reply.setCookie(config.SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
        ...(config.SESSION_COOKIE_DOMAIN ? { domain: config.SESSION_COOKIE_DOMAIN } : {}),
      });
      return { user: { id: user.id, email: user.email, fullName: user.fullName } };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    if (req.sessionToken) await revokeSession(db, req.sessionToken);
    if (req.actor) await audit(db, { action: "auth.logout", actorUserId: req.actor.id, ip: req.ip });
    reply.clearCookie(config.SESSION_COOKIE_NAME, {
      path: "/",
      ...(config.SESSION_COOKIE_DOMAIN ? { domain: config.SESSION_COOKIE_DOMAIN } : {}),
    });
    return { ok: true };
  });

  /**
   * Current user, roles, and the effective platform-level permission list.
   * The web app uses this to decide what navigation to SHOW; the API re-checks everything.
   */
  app.get("/auth/me", async (req) => {
    const actor = app.requireActor(req);
    const inst = await db
      .select({ institutionId: memberships.institutionId, name: institutions.name, slug: institutions.slug, role: memberships.role, status: institutions.status })
      .from(memberships)
      .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
      .where(and(eq(memberships.userId, actor.id), eq(memberships.status, "active")));
    return {
      user: { id: actor.id, email: actor.email, fullName: actor.fullName },
      platformRole: actor.platformRole,
      roles: describeRoles(actor),
      platformPermissions: PERMISSIONS.filter((p) => can(actor, p)),
      institutions: inst,
    };
  });
}

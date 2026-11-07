import { and, eq, gt, isNull } from "drizzle-orm";
import { isPlatformRole } from "@tmp/shared";
import type { Actor } from "./authz/can.js";
import type { Db } from "./db/client.js";
import { institutions, memberships, sessions, userPermissions, users } from "./db/schema.js";
import { hashToken, newSessionToken } from "./security/tokens.js";

export async function createSession(
  db: Db,
  userId: string,
  ttlHours: number,
  meta: { ip?: string; userAgent?: string },
) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  return { token, expiresAt };
}

export async function revokeSession(db: Db, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllUserSessions(db: Db, userId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Resolves a session token to an Actor, or null if the session is unknown, expired,
 * revoked, or the user is no longer active. Status is re-read from the database on
 * every request, so suspending a user takes effect immediately.
 */
export async function loadActor(db: Db, token: string): Promise<Actor | null> {
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user;
  if (!user || user.status !== "active") return null;

  const [mem, grants] = await Promise.all([
    db
      .select({
        institutionId: memberships.institutionId,
        role: memberships.role,
        membershipStatus: memberships.status,
        institutionStatus: institutions.status,
      })
      .from(memberships)
      .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
      .where(eq(memberships.userId, user.id)),
    db.select({ permission: userPermissions.permission }).from(userPermissions).where(eq(userPermissions.userId, user.id)),
  ]);

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    platformRole: user.platformRole && isPlatformRole(user.platformRole) ? user.platformRole : null,
    grants: new Set(grants.map((g) => g.permission)),
    memberships: mem,
  };
}

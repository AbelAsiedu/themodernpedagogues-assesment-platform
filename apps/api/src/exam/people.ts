import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { memberships, users } from "../db/schema.js";

/** Who is expected at a sitting: the class's students, or every active student in the school. */
export function expectedStudents(db: Db, sitting: { institutionId: string; classId: string | null }) {
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, sitting.institutionId), eq(memberships.role, "student"), eq(memberships.status, "active"),
        sitting.classId ? sql`${users.id} in (select user_id from class_members where class_id = ${sitting.classId})` : undefined,
      ),
    )
    .orderBy(users.fullName);
}

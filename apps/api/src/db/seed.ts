/**
 * DEVELOPMENT / TEST SEED ONLY. Refuses to run in production.
 * Creates two schools so tenant isolation can be exercised by hand and by tests.
 * Password comes from SEED_PASSWORD, so no credentials are hardcoded in the repo.
 */
import { createDb, type Db } from "./client.js";
import { classMembers, classes, institutions, memberships, users } from "./schema.js";
import { hashPassword } from "../security/password.js";
import { and, eq } from "drizzle-orm";

export async function seed(db: Db, password: string) {
  const passwordHash = await hashPassword(password);
  const mkUser = async (email: string, fullName: string, platformRole: string | null = null) => {
    const [u] = await db.insert(users).values({ email, fullName, passwordHash, platformRole }).onConflictDoNothing().returning();
    if (u) return u;
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    return existing!;
  };
  const mkInst = async (name: string, slug: string) => {
    const [i] = await db.insert(institutions).values({ name, slug, status: "active" }).onConflictDoNothing().returning();
    if (i) return i;
    const [existing] = await db.select().from(institutions).where(eq(institutions.slug, slug));
    return existing!;
  };

  const superAdmin = await mkUser("super@tmp.test", "Super Admin", "super_admin");
  await mkUser("platform@tmp.test", "Platform Admin", "platform_admin");
  await mkUser("academic@tmp.test", "Academic Admin", "academic_admin");

  const a = await mkInst("Alpha JHS", "alpha-jhs");
  const b = await mkInst("Beta JHS", "beta-jhs");

  const out: Record<string, string> = { superAdmin: superAdmin.id, alphaId: a.id, betaId: b.id };
  for (const [inst, tag] of [[a, "alpha"], [b, "beta"]] as const) {
    const Tag = tag[0]!.toUpperCase() + tag.slice(1);
    const admin = await mkUser(`admin.${tag}@tmp.test`, `${Tag} Admin`);
    const teacher = await mkUser(`teacher.${tag}@tmp.test`, `${Tag} Teacher`);
    const student = await mkUser(`student.${tag}@tmp.test`, `${Tag} Student`);
    for (const [u, role] of [[admin, "institution_admin"], [teacher, "teacher"], [student, "student"]] as const) {
      await db.insert(memberships).values({ userId: u.id, institutionId: inst.id, role }).onConflictDoNothing();
    }
    await db
      .insert(classes)
      .values({ institutionId: inst.id, name: "JHS 3A", level: "JHS 3", academicYear: "2026/2027", createdBy: teacher.id })
      .onConflictDoNothing();
    const [cls] = await db.select().from(classes).where(and(eq(classes.institutionId, inst.id), eq(classes.name, "JHS 3A")));
    await db.insert(classMembers).values([
      { classId: cls!.id, userId: teacher.id, role: "teacher" },
      { classId: cls!.id, userId: student.id, role: "student" },
    ]).onConflictDoNothing();
    out[`${tag}ClassId`] = cls!.id;
    out[`${tag}TeacherId`] = teacher.id;
    out[`${tag}StudentId`] = student.id;
  }
  return out;
}

const isMain = process.argv[1]?.endsWith("seed.ts");
if (isMain) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const url = process.env.DATABASE_URL;
  const pw = process.env.SEED_PASSWORD;
  if (!url || !pw) throw new Error("DATABASE_URL and SEED_PASSWORD are required");
  const { db, sql } = createDb(url, { max: 1 });
  seed(db, pw)
    .then(() => console.log("Seeded dev data (accounts: *@tmp.test)."))
    .finally(() => sql.end());
}

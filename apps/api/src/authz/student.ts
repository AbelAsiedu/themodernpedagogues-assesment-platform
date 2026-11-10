import type { Actor } from "./can.js";

/** Students are people with an ACTIVE student membership in an ACTIVE school. Platform staff don't take quizzes or exams. */
export const isStudentOf = (actor: Actor, institutionId: string) =>
  actor.memberships.some((m) => m.institutionId === institutionId && m.role === "student" && m.membershipStatus === "active" && m.institutionStatus === "active");

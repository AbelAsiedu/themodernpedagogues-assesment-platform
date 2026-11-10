import type { Me } from "./session";
import { hasPerm } from "./session";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Navigation lists ONLY pages that exist and work today.
 * Planned modules (question bank, exams, marking…) live on the Roadmap page with an honest status,
 * rather than as links that go nowhere.
 */
/** True if the person holds the permission platform-wide or in at least one active school. */
function hasQuestionAccess(me: Me, permission: "questions.read" | "questions.write" | "ai.generate" | "quizzes.manage" | "sessions.play" | "exams.manage" | "exams.take"): boolean {
  if (me.platformPermissions.includes(permission)) return true;
  return me.institutions.some((i) => i.status === "active" && hasPerm(me, permission, i.institutionId));
}

export function navFor(me: Me): NavItem[] {
  const items: NavItem[] = [{ href: "/overview", label: "Overview" }];
  const platformStaff = me.platformRole !== null;

  if (hasPerm(me, "institutions.read")) items.push({ href: "/institutions", label: "Institutions" });
  if (hasPerm(me, "users.read")) items.push({ href: "/users", label: "Users" });

  if (hasQuestionAccess(me, "questions.read")) items.push({ href: "/questions", label: "Question bank" });
  if (hasQuestionAccess(me, "questions.write")) items.push({ href: "/uploads", label: "Import files" });
  if (hasQuestionAccess(me, "ai.generate")) items.push({ href: "/studio", label: "AI Studio" });
  if (hasQuestionAccess(me, "quizzes.manage")) items.push({ href: "/quizzes", label: "Quizzes" });
  if (hasQuestionAccess(me, "exams.manage")) items.push({ href: "/exams", label: "Exams" });
  if (!platformStaff && hasQuestionAccess(me, "sessions.play")) items.push({ href: "/join", label: "Join a quiz" });
  if (!platformStaff && hasQuestionAccess(me, "exams.take")) items.push({ href: "/my-exams", label: "My exams" });

  if (!platformStaff) {
    for (const inst of me.institutions.filter((i) => i.status === "active")) {
      const label = me.institutions.length > 1 ? inst.name : inst.role === "student" ? "My classes" : "My school";
      items.push({ href: `/institutions/${inst.institutionId}`, label });
    }
  }

  if (hasPerm(me, "audit.read")) items.push({ href: "/audit", label: "Audit log" });
  if (platformStaff) items.push({ href: "/roadmap", label: "Roadmap" });
  return items;
}

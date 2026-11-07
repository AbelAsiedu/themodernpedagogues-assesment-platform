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
export function navFor(me: Me): NavItem[] {
  const items: NavItem[] = [{ href: "/overview", label: "Overview" }];
  const platformStaff = me.platformRole !== null;

  if (hasPerm(me, "institutions.read")) items.push({ href: "/institutions", label: "Institutions" });
  if (hasPerm(me, "users.read")) items.push({ href: "/users", label: "Users" });

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

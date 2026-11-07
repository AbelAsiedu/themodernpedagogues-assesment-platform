import { describe, expect, it } from "vitest";
import { can, type Actor } from "../src/authz/can.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const base = (over: Partial<Actor>): Actor => ({
  id: "u",
  email: "u@x.test",
  fullName: "U",
  platformRole: null,
  grants: new Set(),
  memberships: [],
  ...over,
});
const member = (institutionId: string, role: string, over = {}) => ({
  institutionId,
  role,
  membershipStatus: "active",
  institutionStatus: "active",
  ...over,
});

describe("can()", () => {
  it("super_admin holds every permission, with or without scope", () => {
    const a = base({ platformRole: "super_admin" });
    expect(can(a, "settings.update")).toBe(true);
    expect(can(a, "users.assign_roles", { institutionId: A })).toBe(true);
  });

  it("institution roles apply only inside their own institution", () => {
    const a = base({ memberships: [member(A, "teacher")] });
    expect(can(a, "classes.manage", { institutionId: A })).toBe(true);
    expect(can(a, "classes.manage", { institutionId: B })).toBe(false);
  });

  it("institution roles never satisfy an unscoped (platform-level) check", () => {
    const a = base({ memberships: [member(A, "institution_admin")] });
    expect(can(a, "members.manage")).toBe(false);
    expect(can(a, "users.read")).toBe(false);
  });

  it("a student cannot manage classes or members", () => {
    const a = base({ memberships: [member(A, "student")] });
    expect(can(a, "classes.read", { institutionId: A })).toBe(true);
    expect(can(a, "classes.manage", { institutionId: A })).toBe(false);
    expect(can(a, "members.read", { institutionId: A })).toBe(false);
  });

  it("suspended memberships and suspended/pending institutions confer nothing", () => {
    expect(can(base({ memberships: [member(A, "teacher", { membershipStatus: "suspended" })] }), "classes.read", { institutionId: A })).toBe(false);
    expect(can(base({ memberships: [member(A, "teacher", { institutionStatus: "suspended" })] }), "classes.read", { institutionId: A })).toBe(false);
    expect(can(base({ memberships: [member(A, "teacher", { institutionStatus: "pending" })] }), "classes.read", { institutionId: A })).toBe(false);
  });

  it("platform_admin gets delegated grants, but never super-admin-only permissions", () => {
    const a = base({ platformRole: "platform_admin", grants: new Set(["users.suspend", "users.assign_roles", "settings.update"]) });
    expect(can(a, "users.suspend")).toBe(true);
    expect(can(a, "users.assign_roles")).toBe(false);
    expect(can(a, "settings.update")).toBe(false);
  });

  it("grants are ignored for actors with no platform role", () => {
    const a = base({ platformRole: null, grants: new Set(["users.suspend"]) });
    expect(can(a, "users.suspend")).toBe(false);
  });

  it("a user holding two roles gets the union only within the right institution", () => {
    const a = base({ memberships: [member(A, "student"), member(B, "teacher")] });
    expect(can(a, "classes.manage", { institutionId: A })).toBe(false);
    expect(can(a, "classes.manage", { institutionId: B })).toBe(true);
  });
});

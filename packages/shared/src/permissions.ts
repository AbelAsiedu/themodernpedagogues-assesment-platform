/**
 * Single source of truth for roles and permissions.
 * The API enforces these; the web app only uses them to decide what to *show*.
 *
 * Two kinds of role:
 *  - Platform roles live on `users.platform_role` and apply across all institutions.
 *  - Institution roles live on `memberships` and apply ONLY inside that institution.
 */

export const PLATFORM_ROLES = ["super_admin", "platform_admin", "academic_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const INSTITUTION_ROLES = ["institution_admin", "teacher", "student"] as const;
export type InstitutionRole = (typeof INSTITUTION_ROLES)[number];

export type AnyRole = PlatformRole | InstitutionRole;

export const PERMISSIONS = [
  // users
  "users.read",
  "users.create",
  "users.update",
  "users.suspend",
  "users.assign_roles",
  // institutions
  "institutions.read",
  "institutions.create",
  "institutions.update",
  "institutions.suspend",
  // institution members
  "members.read",
  "members.manage",
  // classes
  "classes.read",
  "classes.manage",
  // question bank
  "questions.read",
  "questions.write",
  "questions.review",
  "subjects.manage",
  // AI
  "ai.generate",
  // quizzes and live sessions
  "quizzes.manage",
  "sessions.host",
  "sessions.play",
  // audit & settings
  "audit.read",
  "settings.read",
  "settings.update",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/** Permissions a platform role holds by default. super_admin holds everything and cannot be narrowed. */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  super_admin: ALL,
  // platform_admin starts with operational read access; the super admin grants more per user.
  platform_admin: ["users.read", "institutions.read", "members.read", "classes.read", "questions.read", "audit.read", "settings.read"],
  academic_admin: ["institutions.read", "members.read", "classes.read", "questions.read", "questions.review", "settings.read"],
};

/** Permissions an institution role holds, always scoped to its own institution. */
export const INSTITUTION_ROLE_PERMISSIONS: Record<InstitutionRole, readonly Permission[]> = {
  institution_admin: [
    "members.read", "members.manage", "classes.read", "classes.manage", "institutions.read", "institutions.update",
    "questions.read", "questions.write", "questions.review", "subjects.manage", "ai.generate",
    "quizzes.manage", "sessions.host",
  ],
  teacher: [
    "members.read", "classes.read", "classes.manage",
    "questions.read", "questions.write", "questions.review", "subjects.manage", "ai.generate",
    "quizzes.manage", "sessions.host",
  ],
  student: ["classes.read", "sessions.play"],
};

/**
 * Permissions that may never be delegated to anyone but a super_admin,
 * even through per-user grants. Prevents privilege escalation via delegation.
 */
export const SUPER_ADMIN_ONLY: readonly Permission[] = ["users.assign_roles", "settings.update"];

export function isPlatformRole(v: string): v is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(v);
}
export function isInstitutionRole(v: string): v is InstitutionRole {
  return (INSTITUTION_ROLES as readonly string[]).includes(v);
}

import {
  INSTITUTION_ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  SUPER_ADMIN_ONLY,
  isInstitutionRole,
  isPlatformRole,
  type InstitutionRole,
  type Permission,
  type PlatformRole,
} from "@tmp/shared";

export interface ActorMembership {
  institutionId: string;
  role: string;
  membershipStatus: string;
  institutionStatus: string;
}

export interface Actor {
  id: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole | null;
  /** Permissions delegated individually by a super admin. */
  grants: ReadonlySet<string>;
  memberships: readonly ActorMembership[];
}

export interface Scope {
  institutionId?: string;
}

/** True when the actor holds the permission through a PLATFORM role or a delegated grant. */
export function hasPlatformPermission(actor: Actor, permission: Permission): boolean {
  if (!actor.platformRole) return false;
  if (PLATFORM_ROLE_PERMISSIONS[actor.platformRole].includes(permission)) return true;
  // Delegated grants never include super-admin-only permissions.
  return actor.grants.has(permission) && !SUPER_ADMIN_ONLY.includes(permission);
}

/** Roles the actor holds inside one institution. Suspended memberships/institutions confer nothing. */
export function institutionRoles(actor: Actor, institutionId: string): InstitutionRole[] {
  return actor.memberships
    .filter(
      (m) =>
        m.institutionId === institutionId &&
        m.membershipStatus === "active" &&
        m.institutionStatus === "active" &&
        isInstitutionRole(m.role),
    )
    .map((m) => m.role as InstitutionRole);
}

/**
 * The one authorization decision function. Pure and side-effect free so it is easy to test.
 *
 * - Platform permissions apply everywhere.
 * - Institution permissions apply ONLY to the institution named in `scope`.
 * - With no scope, only platform permissions can satisfy the check.
 */
export function can(actor: Actor, permission: Permission, scope: Scope = {}): boolean {
  if (hasPlatformPermission(actor, permission)) return true;
  if (!scope.institutionId) return false;
  return institutionRoles(actor, scope.institutionId).some((r) =>
    INSTITUTION_ROLE_PERMISSIONS[r].includes(permission),
  );
}

export function isSuperAdmin(actor: Actor): boolean {
  return actor.platformRole === "super_admin";
}

/** Every role name the actor effectively holds, for display/navigation only. */
export function describeRoles(actor: Actor): string[] {
  const roles = new Set<string>();
  if (actor.platformRole && isPlatformRole(actor.platformRole)) roles.add(actor.platformRole);
  for (const m of actor.memberships) {
    if (m.membershipStatus === "active" && m.institutionStatus === "active") roles.add(m.role);
  }
  return [...roles];
}

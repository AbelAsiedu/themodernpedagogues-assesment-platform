# Authentication and permissions

## Authentication

- `POST /api/v1/auth/login` → verifies Argon2id hash → creates a session → sets an `HttpOnly`, `SameSite=Lax`
  cookie (`Secure` in production). Only a SHA-256 hash of the token is stored.
- Unknown email and wrong password return the **same** response, and the unknown-email path burns an equivalent
  password check so timing doesn't reveal which accounts exist.
- **Lockout:** 5 failed attempts per email in 15 minutes → HTTP 429, regardless of IP (counted from the audit log).
  Trade-off: someone can deliberately lock another person's account for 15 minutes. Per-IP rate limiting (Redis-backed
  when `REDIS_URL` is set) also applies.
- Sessions last `SESSION_TTL_HOURS` (default 12), fixed, not sliding. Logout revokes server-side.
- Suspending/deactivating a user, or changing their role, revokes all their sessions. Status is re-read on **every**
  request, so it takes effect immediately.
- **Not built:** password reset, password change, MFA, email verification, account self-service.

## Roles

Platform roles (on `users.platform_role`, apply everywhere): `super_admin`, `platform_admin`, `academic_admin`.
Institution roles (on `memberships`, apply **only inside that institution**): `institution_admin`, `teacher`, `student`.
A user may hold roles in several institutions.

## The decision function

`apps/api/src/authz/can.ts` — `can(actor, permission, { institutionId? })`:

1. Platform role (or a delegated grant) holding the permission → allowed anywhere.
2. Otherwise, if an `institutionId` is given: allowed only if the actor has an **active** membership in that
   institution, the institution is **active**, and that role includes the permission.
3. With no scope, institution roles never satisfy the check.

Suspended memberships and suspended or pending institutions confer nothing.

## Default permissions

Source of truth: `packages/shared/src/permissions.ts`.

| Role | Holds |
|---|---|
| super_admin | everything |
| platform_admin | users.read, institutions.read, members.read, classes.read, audit.read, settings.read (more only by delegation) |
| academic_admin | institutions.read, members.read, classes.read, settings.read |
| institution_admin | members.read/manage, classes.read/manage, institutions.read/update — own institution only |
| teacher | members.read, classes.read/manage — own institution only |
| student | classes.read — and the API narrows this to classes they belong to |

## Delegation and escalation guards

- A super admin can grant individual permissions to a **platform-level** user (`POST /users/:id/permissions`).
- `users.assign_roles` and `settings.update` are **super-admin-only** and can never be delegated (enforced in `can()`
  *and* at the grant endpoint).
- Nobody can change their own status or platform role. Only a super admin can change another platform-level account.
- A school admin cannot create another institution administrator; only platform staff can.

## Object-level rules

- Authorization happens **before** existence is revealed: a missing class and another school's class return the same
  403 to a non-platform user, so ids can't be probed.
- Memberships are always filtered by `(membership id AND institution id)`; mixing your institution id with another
  school's membership id returns 404 and changes nothing.
- Adding an existing user to a school by id is restricted to platform staff, so schools can't probe each other's users.
- Class members must already be active members of the class's own institution.

## Known gaps

- Teachers hold `members.read` for their whole institution (they can list all members' names and emails). That is
  broader than strictly necessary and should probably be narrowed to their own classes.
- Permission changes take effect on the next request, but there is no per-permission audit of *reads*.

# Security

## Implemented and tested

| Control | How | Test |
|---|---|---|
| Password storage | Argon2id | login tests |
| Sessions | random 256-bit token, hash stored, HttpOnly + SameSite=Lax (+Secure in prod), revocable | logout/suspend tests |
| Immediate revocation | status re-read each request; suspend/role change revokes sessions | `auth.test.ts` |
| Brute force | per-email lockout (DB) + per-IP rate limit (Redis when configured) | lockout test |
| User enumeration | identical responses, equalised timing | `auth.test.ts` |
| CSRF | SameSite=Lax + Origin allow-list on cookie-authenticated mutations | 2 tests |
| Authorization | server-side `can()`; web hides UI only | unit + integration |
| Tenant isolation | scope on every query/object; same 403 for missing vs foreign | `tenant-isolation.test.ts` |
| Privilege escalation | super-admin-only permissions, no self-change, platform accounts protected | `privileges-and-audit.test.ts` |
| Audit | append-only trigger; no passwords/hashes stored | audit tests |
| Input validation | Zod on every body/query/param | 400 tests |
| Headers | `@fastify/helmet` | smoke test |
| Error handling | generic 500s; request log redacts cookies | by design |
| Secrets | none in the repo or the client bundle (grepped) | build check |

## Mutation testing
Two deliberate breaks of `can()` (ignore institution scope; allow delegating super-admin-only permissions) made
6 and 1 tests fail respectively, then were reverted. The tests do detect these regressions.

## NOT done — do before real student data

- **Separate DB roles.** The app currently connects as the table owner, who can drop the audit trigger. Use a
  migration-owner role and a restricted app role.
- **`trustProxy: true`** trusts any `X-Forwarded-For`. Safe only behind a proxy you control that overwrites it;
  otherwise per-IP limits can be spoofed. Restrict to your proxy's address.
- **No password reset / change / MFA.** Seed passwords must never be used outside development.
- **No fixed Content-Security-Policy tuning for the web app**; helmet defaults apply to the API only. The Next.js app needs its own CSP.
- **No dependency or malware scanning, no pen test, no file-upload handling (no uploads exist yet).**
- **Session cache:** three queries per request; fine now, a bottleneck at scale.
- **Data protection:** no consent flow, retention or deletion policy, no Ghana Data Protection Act review.
  The platform will hold minors' data — this needs legal review before launch.
- **Audit denial writes are fire-and-forget** and can be lost if the process dies at that instant.

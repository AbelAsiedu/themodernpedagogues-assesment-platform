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

## Live quizzes (Phase 4) — what is protected and tested

| Concern | Control | Evidence |
|---|---|---|
| Answer key leaking to players | player views are built by `publicQuestion`, which strips the key; the key is returned only with feedback after that student has answered | unit + route tests; mutation check (leaking the key fails 2 tests) |
| Guessing join codes | 6 chars from a 31-symbol alphabet (~887 million combinations), `crypto.randomInt`, 30 attempts/min per user, **identical** 404 for unknown/ended/other-school codes, codes released when a session ends | tests; this limits guessing but is not a substitute for school/class membership checks, which also apply |
| Joining another school's quiz | join requires membership of the session's school (and class, if restricted) | tenant tests |
| Double-submit / replay / racing taps | PK `(participant_id, idx)` + row lock; replays return the first result | concurrency test; mutation check (removing the lock fails it) |
| Cheating the clock | server owns `question_served_at`; late answers score 0 | tests |
| WebSocket abuse | Origin allow-list (cross-site hijacking), session cookie auth, 1 KB max message, 5 sockets/user, 3000/session, role-filtered payloads (players: top 10 + display names only; nothing if the board is hidden) | real-socket tests |
| Student privacy | classmates see only display names; real names go to the teacher view only | tests |

**Not covered:** no load/abuse test of the hub; display names are student-chosen (regex-limited, no profanity filter); a student can share the
code with someone in the same school; there is no proctoring and none is claimed.

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

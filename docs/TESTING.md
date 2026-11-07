# Testing

```bash
pnpm test        # builds shared, rebuilds the test database from the real migrations, runs vitest
pnpm typecheck
```

Integration tests run **against real PostgreSQL** (database name must contain `test` or setup refuses to run), using the
real migrations (including the audit triggers), the real Fastify app (`inject`), real Argon2 hashing and real sessions.

## What exists — 42 tests, all passing

| File | Count | Proves |
|---|---|---|
| `authz.unit.test.ts` | 8 | `can()` scope, suspended memberships/institutions, delegation limits |
| `auth.test.ts` | 10 | cookie flags, no enumeration, lockout, suspension kills live session, logout revokes, CSRF |
| `tenant-isolation.test.ts` | 12 | school A cannot read/modify school B by any route or by mixing ids; student scoping; suspended school loses access |
| `privileges-and-audit.test.ts` | 12 | platform endpoints closed to school roles, no self-escalation, delegation works and is revocable, real overview counts, audit completeness and immutability |

## What does NOT exist

- Web/UI tests and automated browser end-to-end tests (the UI was checked manually with screenshots in headless Chrome).
- Load, concurrency and performance tests — **no capacity figure exists or is claimed.**
- Tests for features not built (exams, marking, AI, leaderboard).
- CI pipeline.

## Notes

- Test files run serially and share one database; destructive tests create their own users.
- Rate limits are raised in tests via `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX`; the real limiter was checked by hand against Redis.

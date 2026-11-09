# Testing

```bash
pnpm test        # builds shared, rebuilds the test database from the real migrations, runs vitest
pnpm typecheck
```

Integration tests run **against real PostgreSQL** (database name must contain `test` or setup refuses to run), using the
real migrations (including the audit triggers), the real Fastify app (`inject`), real Argon2 hashing and real sessions.

## What exists — 132 tests, all passing

| File | Count | Proves |
|---|---|---|
| `authz.unit.test.ts` | 8 | `can()` scope, suspended memberships/institutions, delegation limits |
| `auth.test.ts` | 10 | cookie flags, no enumeration, lockout, suspension kills live session, logout revokes, CSRF |
| `tenant-isolation.test.ts` | 12 | school A cannot read/modify school B by any route or by mixing ids; student scoping; suspended school loses access |
| `question-bank.test.ts` | 22 | subject/topic rules, per-type validation (MCQ duplicates, essay marks = rubric total), cross-school subject/topic refusal, tenant isolation on list/read/edit/review/archive, non-disclosure of ids, read-only platform staff, lifecycle (submit/approve/reject/archive), edit-after-approval returns to review with version history, DB constraint blocking unreviewed approved AI questions |
| `ai-studio.test.ts` | 19 | AI output saved only as `needs_review`; invalid/duplicate items dropped; options re-shuffled with key preserved; one bounded retry on bad shape; grounding text fenced and not stored; provider failures mapped and logged with nothing saved; per-user daily quota; access control and 503 when unconfigured; **real OpenAI client over mocked HTTP** (strict json_schema, Bearer key, status mapping, key never leaked) |
| `quiz-engine.unit.test.ts` | 15 | marking per type, answer key never in a player-facing question, scoring (speed bonus, grace, late = 0), join-code alphabet/normalisation, seeded shuffle, leaderboard score encoding and tie-break |
| `quiz-sessions.test.ts` | 34 | quiz build rules (approved questions only, tenant isolation), join-code lifecycle (unique among open sessions, case/space-insensitive, identical failure for unknown/ended/foreign, rate limited), class restriction, players cannot see keys or other students' data, idempotent answers, concurrent duplicate submits, late answers, homework auto-end, **real WebSocket**: origin/auth/close codes, role-filtered views, 400 ms batching, per-user socket cap, **real Redis** leaderboard parity with the DB fallback and rebuild after key loss |
| `privileges-and-audit.test.ts` | 12 | platform endpoints closed to school roles, no self-escalation, delegation works and is revocable, real overview counts, audit completeness and immutability |

## What does NOT exist

- Web/UI tests and automated browser end-to-end tests (the UI was checked manually with screenshots in headless Chrome).
- Load, concurrency and performance tests — **no capacity figure exists or is claimed.** (Quiz tests cover correctness under a handful of concurrent writers, not scale.)
- Tests for features not built (exams, essay/AI marking). AI is tested against simulations only — **never against the real OpenAI service**.
- CI pipeline.

## Notes

- Test files run serially and share one database; destructive tests create their own users.
- Rate limits are raised in tests via `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX`; the real limiter was checked by hand against Redis.

- Mutation checks were run by hand: removing the participant row lock fails the concurrency test; leaking the answer key in the player view fails two tests.
- The WebSocket and leaderboard tests need Redis (`REDIS_URL`, defaults to local).
- A throwaway puppeteer script drove 1 teacher + 3 students through build → code → join → play → end in a real browser; it is not part of the suite.

# Testing

```bash
pnpm test        # builds shared, rebuilds the test database from the real migrations, runs vitest
pnpm typecheck
```

Integration tests run **against real PostgreSQL** (database name must contain `test` or setup refuses to run), using the
real migrations (including the audit triggers), the real Fastify app (`inject`), real Argon2 hashing and real sessions.

## What exists — 236 tests, all passing

| File | Count | Proves |
|---|---|---|
| `authz.unit.test.ts` | 8 | `can()` scope, suspended memberships/institutions, delegation limits |
| `auth.test.ts` | 10 | cookie flags, no enumeration, lockout, suspension kills live session, logout revokes, CSRF |
| `tenant-isolation.test.ts` | 12 | school A cannot read/modify school B by any route or by mixing ids; student scoping; suspended school loses access |
| `question-bank.test.ts` | 22 | subject/topic rules, per-type validation (MCQ duplicates, essay marks = rubric total), cross-school subject/topic refusal, tenant isolation on list/read/edit/review/archive, non-disclosure of ids, read-only platform staff, lifecycle (submit/approve/reject/archive), edit-after-approval returns to review with version history, DB constraint blocking unreviewed approved AI questions |
| `ai-studio.test.ts` | 19 | AI output saved only as `needs_review`; invalid/duplicate items dropped; options re-shuffled with key preserved; one bounded retry on bad shape; grounding text fenced and not stored; provider failures mapped and logged with nothing saved; per-user daily quota; access control and 503 when unconfigured; **real OpenAI client over mocked HTTP** (strict json_schema, Bearer key, status mapping, key never leaked) |
| `quiz-engine.unit.test.ts` | 15 | marking per type, answer key never in a player-facing question, scoring (speed bonus, grace, late = 0), join-code alphabet/normalisation, seeded shuffle, leaderboard score encoding and tie-break |
| `quiz-sessions.test.ts` | 34 | quiz build rules (approved questions only, tenant isolation), join-code lifecycle (unique among open sessions, case/space-insensitive, identical failure for unknown/ended/foreign, rate limited), class restriction, players cannot see keys or other students' data, idempotent answers, concurrent duplicate submits, late answers, homework auto-end, **real WebSocket**: origin/auth/close codes, role-filtered views, 400 ms batching, per-user socket cap, **real Redis** leaderboard parity with the DB fallback and rebuild after key loss |
| `exams.test.ts` | 33 | exam build rules (approved only, equal marks in answer-any, official needs a source, DB constraint), privacy and tenant isolation, scheduling checks and frozen questions, window and class/school visibility (non-disclosing 404), server-set deadline = min(duration, close) and idempotent start (incl. double-click race), answer key never in the candidate view, ordered/idempotent saves with sequence numbers and version history, concurrent identical saves, shape validation, grace window then `time_up`, idempotent and concurrent submits with one receipt, honest `auto` labelling, **receipt hash equals stored answers even when saves race the submit**, **deterministic lock-ordering test (a save waits for an in-flight submit and is then refused)**, marking, best-n selection, essays pending, sweeper (grace, auto-submit, re-marking without duplicates), result release only after close and never revealing keys, control room, extra time (permissions, reason, audit, no reopening), cancel rules, audit trail, student exam list |
| `uploads.test.ts` | 48 | Wayground-layout parsing (types, positional answers with blank option cells, flagged open-ended/multi-answer/duplicate/out-of-range rows, median time), CSV edge cases, Word headings, PowerPoint slide order, section sizing, text PDF, Windows-1252, the garbled-text quality gate, detection by content (renamed files), legacy/binary/damaged files, **zip bombs (one huge part and many parts adding up)**, **malformed XML that would make backtracking parsers crawl**, oversize-image refusal, OCR on/off (**real tesseract when installed**), upload API (rights confirmation, any field order, duplicates, size/count limits, rate limit, school isolation, non-disclosure, audit without file name), import (review queue by default, provenance, idempotence, row selection, approve + quiz in one transaction, separate review/quiz permissions, cross-school refusal), AI grounding (only chosen sections sent, foreign upload never reaches the vendor, 12,000-char limit, prompt-injection text still ends in review). Mutation-checked: removing the school check, zip budget, row-problem skip, review/quiz permission checks, rights check, duplicate check or content detection each fails a test |
| `marking.test.ts` | 23 | marking queue (only submitted, answered essays; counts), per-point marks checked against the frozen rubric (too many/few, over limit, negative, non-numeric, non-essay, blank, unsubmitted, unknown position), server-computed total feeding results, reason required to change a mark, stale `basedOn` and "unmarked" are conflicts, identical re-save writes no history, **two simultaneous first marks → exactly one wins**, history append-only at the database, school isolation with non-disclosure (other school's teacher, own student, other school's student, unauthenticated), permission checks (by narrowing the teacher role), `answer_any` stays pending until all marked, release guard and student view (comment shown, no rubric/AI fields), AI suggestions (stored apart, never counted, never shown to the student, prompt fenced and without the student's name/email, invalid output rejected after one retry, strict validator unit tests, quota and provider-failure mapping, starting a mark from a suggestion, 503 without AI), analytics (only completely marked attempts, bands, per-question stats, MCQ option counts, school isolation), CSV (formula neutralising, quoting, safe file name, BOM, audited, lists non-starters), helper unit tests. Mutation-checked: removing the reason rule, the `basedOn` check, the permission on session lookup, formula neutralising, the answer fence or the "completely marked only" filter each fails a test |
| `privileges-and-audit.test.ts` | 12 | platform endpoints closed to school roles, no self-escalation, delegation works and is revocable, real overview counts, audit completeness and immutability |

## What does NOT exist

- Web/UI tests and automated browser end-to-end tests (the UI was checked manually with screenshots in headless Chrome).
- Load, concurrency and performance tests — **no capacity figure exists or is claimed.** (Quiz tests cover correctness under a handful of concurrent writers, not scale.)
- Tests for features not built (grade boundaries, batch AI marking, official templates, pause/invigilation). AI (question drafts and mark suggestions) is tested against simulations only — **never against the real OpenAI service**.
- CI pipeline.

## Notes

- Test files run serially and share one database; destructive tests create their own users.
- Rate limits are raised in tests via `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX`; the real limiter was checked by hand against Redis.

- Mutation checks were run by hand (quizzes):  removing the participant row lock fails the concurrency test; leaking the answer key in the player view fails two tests.
- The WebSocket and leaderboard tests need Redis (`REDIS_URL`, defaults to local).
- A throwaway puppeteer script drove 1 teacher + 3 students through build → code → join → play → end in a real browser; it is not part of the suite.
- Exam mutation checks (by hand, then restored): removing the sequence guard fails 2 tests; removing the exclusive lock in submit fails the concurrent-submit test; removing the shared lock in save fails the deterministic lock-ordering test (the random race test alone did **not** catch this, which is why the deterministic one exists).
- Exam tests move time with `app.exams.clock` instead of sleeping.
- A throwaway puppeteer script drove a teacher and three students through build → schedule → start → answer → offline → reload → submit → timed-out auto-submit in a real browser; it is not part of the suite.

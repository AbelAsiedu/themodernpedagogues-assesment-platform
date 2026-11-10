# Architecture

Describes what is **implemented**. Planned parts are marked and live in their own documents.

## Shape

```
Browser ──► Next.js (apps/web) ──/api/v1/* rewrite──► Fastify API (apps/api) ──► PostgreSQL
                                                              └──────────────► Redis (rate limiting only, today)
```

- **Independent application.** Separate repo layout, API, database and deployment from the main TMP website.
  Integration (a link plus shared sign-in) is **designed but not built**; see Single sign-on below.
- **Monorepo** (pnpm workspaces): `apps/api`, `apps/web`, `packages/shared`.
- **The browser only talks to the web origin.** Next.js proxies `/api/v1/*` to the API, so the session cookie is
  same-origin and no CORS is needed for the web app. The API still allows the configured `WEB_ORIGINS` with credentials.

## Decisions and reasons

| Decision | Reason |
|---|---|
| Fastify + TypeScript | Fast, schema-friendly, small surface; fits the high-concurrency goal later |
| PostgreSQL + Drizzle (SQL migrations) | Relational integrity for exams/results; migrations are plain SQL you can review |
| Opaque server-side sessions (not JWT) | Suspending a user or logging out must take effect immediately; JWTs can't be revoked cheaply |
| Argon2id password hashing | OWASP-recommended; parameters in `src/security/password.ts` |
| One `can(actor, permission, scope)` function | Single, pure, unit-tested authorization decision point |
| Shared permission catalogue (`packages/shared`) | API enforces; web only uses it to decide what to *show* |
| Self-hosted fonts via npm | No third-party requests from students' browsers (minors' privacy) |

## Multi-tenancy

Tenant boundary = `institution_id`. Institution roles live on `memberships` and apply **only** inside that
institution. Every route that takes an object id loads the object first and authorizes against *its* institution —
never against a client-supplied one. Details and tests: [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md).

## Request lifecycle

1. `onRequest`: read session cookie → hash → look up session → load user, memberships, grants (status re-read every request).
2. `preHandler`: for cookie-authenticated mutations, require an allowed `Origin` (or `x-tmp-client: web`).
3. Route: validate input with Zod → `app.authorize(req, permission, scope)` → business logic → audit record.
4. Errors are mapped centrally; unknown errors return a generic 500 (no internals leaked).

## Live quizzes (Phase 4)

- A teacher builds a **quiz** from approved questions; each item pins a `question_version`. Opening it creates a **session** with a
  6-character **join code** (alphabet without look-alikes `0/O/1/I/L`, drawn with `crypto.randomInt`; unique among open sessions only).
  Starting a session freezes the pinned questions into `session_questions`, so later edits never change a game in progress.
- Students sign in, enter the code and play at their own pace through a per-student shuffled order. The server holds the
  per-question clock and marks deterministically. **No AI is involved anywhere in play or marking.**
- `LiveHub` (WebSocket at `/api/v1/sessions/:id/live`) pushes role-filtered leaderboard/status events, batched every 400 ms, using Redis
  pub/sub across instances. The leaderboard is a Redis sorted set rebuilt from PostgreSQL if lost.

## Timed exams (Phase 5)

Teachers build an exam (sections with `answer_all`/`answer_any n` rules, pinned question versions) and **schedule a sitting**, which freezes
the questions. Candidates start within the window; the **server sets and owns the deadline**, saves answers with sequence numbers, and
submits idempotently with a receipt. `ExamEngine` (`apps/api/src/exam/engine.ts`) holds all of it; a sweeper auto-submits expired attempts and
finishes marking. See [EXAMINATION_ENGINE.md](EXAMINATION_ENGINE.md).

## Not yet built (design intent only)

Essay/AI marking, analytics, notifications, reports, file uploads, official-style templates. (Question bank, AI layer, quizzes, the live leaderboard and the exam engine are built.)
Their intended designs are in [AI_SYSTEM_DESIGN.md](AI_SYSTEM_DESIGN.md), [EXAMINATION_ENGINE.md](EXAMINATION_ENGINE.md),
[MARKING_AND_GRADING.md](MARKING_AND_GRADING.md) and [SCALABILITY_AND_PERFORMANCE.md](SCALABILITY_AND_PERFORMANCE.md).

## Single sign-on (not built)

Intended: the web app and API on sibling subdomains of `themodernpedagogues.com` share a session cookie
(`SESSION_COOKIE_DOMAIN=.themodernpedagogues.com`), with the main site redirecting to the platform. The cookie-domain
setting exists; the main-site side and the cross-site flow are **not implemented or tested**.
